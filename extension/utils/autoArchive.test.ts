import { beforeEach, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

// createQuest fires off registerQuest's RPC call without awaiting it — needs
// a resolved stub or that unawaited call rejects with "rpc is not a
// function". archiveQuest/updateQuest themselves never touch supabase.
const rpc = vi.fn().mockResolvedValue({ error: null });
vi.mock("./supabase", () => ({ supabase: { rpc } }));

const { runAutoArchiveCheck } = await import("./autoArchive");
const { createQuest, getQuests, updateQuest } = await import("./quests");
const { updateSettings } = await import("./settings");

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  fakeBrowser.reset();
});

async function questById(id: string) {
  return (await getQuests()).find((q) => q.id === id)!;
}

it("archives a done quest inactive past the configured threshold", async () => {
  const quest = await createQuest("Stale", []);
  await updateQuest(quest.id, {
    status: "done",
    lastSeenAt: Date.now() - 40 * DAY_MS,
  });

  await runAutoArchiveCheck(); // default 30-day threshold

  expect((await questById(quest.id)).archivedAt).toBeGreaterThan(0);
});

it("leaves a done quest alone if it was seen recently", async () => {
  const quest = await createQuest("Fresh", []);
  await updateQuest(quest.id, {
    status: "done",
    lastSeenAt: Date.now() - 1 * DAY_MS,
  });

  await runAutoArchiveCheck();

  expect((await questById(quest.id)).archivedAt).toBeUndefined();
});

it("leaves a non-done quest alone regardless of lastSeenAt", async () => {
  const quest = await createQuest("Active", []);
  await updateQuest(quest.id, {
    status: "active",
    lastSeenAt: Date.now() - 100 * DAY_MS,
  });

  await runAutoArchiveCheck();

  expect((await questById(quest.id)).archivedAt).toBeUndefined();
});

it("falls back to createdAt when lastSeenAt was never set", async () => {
  const quest = await createQuest("Never captured", []);
  // createdAt is "now" by default — backdate it directly to simulate an old,
  // never-captured quest.
  const quests = await getQuests();
  await fakeBrowser.storage.local.set({
    quests: quests.map((q) =>
      q.id === quest.id
        ? { ...q, status: "done", createdAt: Date.now() - 40 * DAY_MS }
        : q,
    ),
  });

  await runAutoArchiveCheck();

  expect((await questById(quest.id)).archivedAt).toBeGreaterThan(0);
});

it("respects a non-default autoArchiveDays from Settings", async () => {
  await updateSettings({ autoArchiveDays: 5 });
  const quest = await createQuest("Stale-ish", []);
  await updateQuest(quest.id, {
    status: "done",
    lastSeenAt: Date.now() - 10 * DAY_MS,
  });

  await runAutoArchiveCheck();

  expect((await questById(quest.id)).archivedAt).toBeGreaterThan(0);
});

it("skips a quest that's already archived", async () => {
  const quest = await createQuest("Already archived", []);
  const archivedAt = Date.now() - 100 * DAY_MS;
  await updateQuest(quest.id, {
    status: "done",
    lastSeenAt: Date.now() - 100 * DAY_MS,
    archivedAt,
  });

  await runAutoArchiveCheck();

  expect((await questById(quest.id)).archivedAt).toBe(archivedAt);
});

it("skips a trashed quest", async () => {
  const quest = await createQuest("Trashed", []);
  await updateQuest(quest.id, {
    status: "done",
    lastSeenAt: Date.now() - 100 * DAY_MS,
  });
  const quests = await getQuests();
  await fakeBrowser.storage.local.set({
    quests: quests.map((q) =>
      q.id === quest.id ? { ...q, deletedAt: Date.now() } : q,
    ),
  });

  await runAutoArchiveCheck();

  expect((await questById(quest.id)).archivedAt).toBeUndefined();
});
