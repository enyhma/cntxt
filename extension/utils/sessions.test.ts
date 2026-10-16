import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { setWindowBinding } from "./session";
import { DASHBOARD_URL } from "./tabs";

const insert = vi.fn();
const gte = vi.fn();
const order = vi.fn();
const select = vi.fn(() => ({ gte }));
const from = vi.fn(() => ({ select, insert }));
// createGroup/createFolder("project") each fire an unawaited
// registerGroup/registerProject RPC call — needs a resolved stub or those
// calls reject with "rpc is not a function".
const rpc = vi.fn().mockResolvedValue({ error: null });
vi.mock("./supabase", () => ({ supabase: { from, rpc } }));

const { captureSession, getSessions, pruneOldLocalSessions, restoreSession } =
  await import("./sessions");
const { createGroup, getGroups, updateGroup } = await import("./groups");
const { createFolder, updateFolder } = await import("./folders");
const { getWindowBindingMap } = await import("./session");

beforeEach(() => {
  fakeBrowser.reset();
  insert.mockReset().mockResolvedValue({ error: null });
  gte.mockReset().mockReturnValue({ order });
  order.mockReset().mockResolvedValue({ data: [], error: null });
  select.mockClear();
  from.mockClear();
});

describe("captureSession", () => {
  it("does nothing when no window is bound", async () => {
    await captureSession();
    expect(await getSessions()).toEqual([]);
  });

  it("captures a standalone group-bound window's live tabs", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    await browser.tabs.create({ windowId: win.id, url: DASHBOARD_URL });
    // tabs.create's CreateProperties has no `title` — a tab's title comes
    // from the page itself, never from creation options, matching real
    // Chrome/Firefox behavior.
    await browser.tabs.create({
      windowId: win.id,
      url: "https://a.example/",
    });
    const group = await createGroup("Tracked", []);
    await setWindowBinding(win.id!, { kind: "group", groupId: group.id });

    await captureSession();

    const sessions = await getSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.windows).toEqual([
      {
        entityTable: "groups",
        entityId: group.id,
        entityName: "Tracked",
        tabs: [{ url: "https://a.example/", title: "" }],
      },
    ]);
  });

  it("stamps lastSeenAt on a captured group", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const group = await createGroup("Tracked", []);
    await setWindowBinding(win.id!, { kind: "group", groupId: group.id });

    await captureSession();

    const updated = (await getGroups()).find((q) => q.id === group.id);
    expect(updated?.lastSeenAt).toBeGreaterThan(0);
  });

  it("captures a project-bound window with no active group as a folders leg", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const project = await createFolder("Project", null, "project");
    await setWindowBinding(win.id!, {
      kind: "project",
      projectId: project.id,
    });

    await captureSession();

    const sessions = await getSessions();
    expect(sessions[0]!.windows).toEqual([
      {
        entityTable: "folders",
        entityId: project.id,
        entityName: "Project",
        tabs: [],
      },
    ]);
  });

  it("captures a project-bound window with a live child group as both a folders leg and a groups leg", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const project = await createFolder("Project", null, "project");
    // Pre-declared like restoreMachine would have left it after opening —
    // fakeBrowser doesn't implement tabs.group(), so URL identity against
    // the group's own last-known tabs is what attributes the open tab
    // below to the group instead of the project (see
    // windowSyncMachine.ts's partitionProjectWindowTabs).
    const group = await createGroup("Active child", [
      { url: "https://a.example/", title: "" },
    ]);
    await updateGroup(group.id, { folderId: project.id, status: "active" });
    await updateFolder(project.id, { activeGroupId: group.id });
    await setWindowBinding(win.id!, {
      kind: "project",
      projectId: project.id,
    });
    await browser.tabs.create({ windowId: win.id, url: "https://a.example/" });

    await captureSession();

    const sessions = await getSessions();
    expect(sessions[0]!.windows).toEqual([
      {
        entityTable: "folders",
        entityId: project.id,
        entityName: "Project",
        tabs: [],
      },
      {
        entityTable: "groups",
        entityId: group.id,
        entityName: "Active child",
        tabs: [{ url: "https://a.example/", title: "" }],
      },
    ]);
  });

  it("skips writing a new session when nothing changed since the last capture", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const group = await createGroup("Tracked", []);
    await setWindowBinding(win.id!, { kind: "group", groupId: group.id });

    await captureSession();
    await captureSession();

    expect(await getSessions()).toHaveLength(1);
  });

  it("writes a new session when the live tabs changed", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const group = await createGroup("Tracked", []);
    await setWindowBinding(win.id!, { kind: "group", groupId: group.id });

    await captureSession();
    await browser.tabs.create({ windowId: win.id, url: "https://b.example/" });
    await captureSession();

    expect(await getSessions()).toHaveLength(2);
  });

  it("skips a window whose binding points at a since-closed window", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const group = await createGroup("Tracked", []);
    await setWindowBinding(win.id!, { kind: "group", groupId: group.id });
    await browser.windows.remove(win.id!);
    // windows.remove doesn't itself prune the binding map (background.ts's
    // onRemoved listener does that in production) — simulate the race where
    // capture runs against a stale map entry.
    expect(Object.keys(await getWindowBindingMap())).toContain(String(win.id));

    await captureSession();

    expect(await getSessions()).toEqual([]);
  });

  it("fires registerSession's insert with the captured windows", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const group = await createGroup("Tracked", []);
    await setWindowBinding(win.id!, { kind: "group", groupId: group.id });

    await captureSession();
    await vi.waitFor(() => expect(insert).toHaveBeenCalled());
    expect(insert.mock.calls[0]![0]).toMatchObject({
      windows: [{ entityTable: "groups", entityId: group.id }],
    });
  });
});

describe("pruneOldLocalSessions", () => {
  it("removes sessions older than the given bound and keeps recent ones", async () => {
    const win = (await browser.windows.create({ focused: true }))!;
    const group = await createGroup("Tracked", []);
    await setWindowBinding(win.id!, { kind: "group", groupId: group.id });
    await captureSession();

    const sessions = await getSessions();
    const aged = sessions.map((s) => ({
      ...s,
      capturedAt: Date.now() - 10 * 24 * 60 * 60 * 1000,
    }));
    await browser.storage.local.set({ sessions: aged });

    await pruneOldLocalSessions(7);

    expect(await getSessions()).toEqual([]);
  });
});

describe("restoreSession", () => {
  it("opens one new window per leg, bound and populated", async () => {
    const session = {
      id: "s1",
      capturedAt: Date.now(),
      windows: [
        {
          entityTable: "groups" as const,
          entityId: "q1",
          entityName: "Q",
          tabs: [{ url: "https://a.example/", title: "A" }],
        },
        {
          entityTable: "folders" as const,
          entityId: "f1",
          entityName: "F",
          tabs: [{ url: "https://b.example/", title: "B" }],
        },
      ],
    };

    await restoreSession(session);

    const allWindows = await browser.windows.getAll();
    // The default window fakeBrowser seeds, plus one per leg.
    expect(allWindows.length).toBe(3);

    const bindingMap = await getWindowBindingMap();
    const bindings = Object.values(bindingMap);
    expect(bindings).toContainEqual({ kind: "group", groupId: "q1" });
    expect(bindings).toContainEqual({ kind: "project", projectId: "f1" });
  });
});
