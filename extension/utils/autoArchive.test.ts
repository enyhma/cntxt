import { beforeEach, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

// createGroup fires off registerGroup's RPC call without awaiting it — needs
// a resolved stub or that unawaited call rejects with "rpc is not a
// function". archiveGroup/updateGroup themselves never touch supabase.
const rpc = vi.fn().mockResolvedValue({ error: null });
vi.mock("./supabase", () => ({ supabase: { rpc } }));

const { runAutoArchiveCheck } = await import("./autoArchive");
const { createGroup, getGroups, updateGroup } = await import("./groups");
const { updateSettings } = await import("./settings");

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  fakeBrowser.reset();
});

async function groupById(id: string) {
  return (await getGroups()).find((q) => q.id === id)!;
}

it("archives a done group inactive past the configured threshold", async () => {
  const group = await createGroup("Stale", []);
  await updateGroup(group.id, {
    status: "done",
    lastSeenAt: Date.now() - 40 * DAY_MS,
  });

  await runAutoArchiveCheck(); // default 30-day threshold

  expect((await groupById(group.id)).archivedAt).toBeGreaterThan(0);
});

it("leaves a done group alone if it was seen recently", async () => {
  const group = await createGroup("Fresh", []);
  await updateGroup(group.id, {
    status: "done",
    lastSeenAt: Date.now() - 1 * DAY_MS,
  });

  await runAutoArchiveCheck();

  expect((await groupById(group.id)).archivedAt).toBeUndefined();
});

it("leaves a non-done group alone regardless of lastSeenAt", async () => {
  const group = await createGroup("Active", []);
  await updateGroup(group.id, {
    status: "active",
    lastSeenAt: Date.now() - 100 * DAY_MS,
  });

  await runAutoArchiveCheck();

  expect((await groupById(group.id)).archivedAt).toBeUndefined();
});

it("falls back to createdAt when lastSeenAt was never set", async () => {
  const group = await createGroup("Never captured", []);
  // createdAt is "now" by default — backdate it directly to simulate an old,
  // never-captured group.
  const groups = await getGroups();
  await fakeBrowser.storage.local.set({
    groups: groups.map((q) =>
      q.id === group.id
        ? { ...q, status: "done", createdAt: Date.now() - 40 * DAY_MS }
        : q,
    ),
  });

  await runAutoArchiveCheck();

  expect((await groupById(group.id)).archivedAt).toBeGreaterThan(0);
});

it("respects a non-default autoArchiveDays from Settings", async () => {
  await updateSettings({ autoArchiveDays: 5 });
  const group = await createGroup("Stale-ish", []);
  await updateGroup(group.id, {
    status: "done",
    lastSeenAt: Date.now() - 10 * DAY_MS,
  });

  await runAutoArchiveCheck();

  expect((await groupById(group.id)).archivedAt).toBeGreaterThan(0);
});

it("skips a group that's already archived", async () => {
  const group = await createGroup("Already archived", []);
  const archivedAt = Date.now() - 100 * DAY_MS;
  await updateGroup(group.id, {
    status: "done",
    lastSeenAt: Date.now() - 100 * DAY_MS,
    archivedAt,
  });

  await runAutoArchiveCheck();

  expect((await groupById(group.id)).archivedAt).toBe(archivedAt);
});

it("skips a trashed group", async () => {
  const group = await createGroup("Trashed", []);
  await updateGroup(group.id, {
    status: "done",
    lastSeenAt: Date.now() - 100 * DAY_MS,
  });
  const groups = await getGroups();
  await fakeBrowser.storage.local.set({
    groups: groups.map((q) =>
      q.id === group.id ? { ...q, deletedAt: Date.now() } : q,
    ),
  });

  await runAutoArchiveCheck();

  expect((await groupById(group.id)).archivedAt).toBeUndefined();
});
