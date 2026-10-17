import { test, expect } from "./fixtures";

// Exercises two bugs fixed today, both against a real browser: fakeBrowser
// doesn't implement browser.tabGroups at all, so every assumption about
// whether/when tabGroups.onUpdated actually fires was unverified until
// this suite. No dashboard UI involved — state is seeded directly into
// browser.storage (matching utils/tabGroups.ts's/utils/groups.ts's/
// utils/folders.ts's own schemas) and driven entirely through real
// browser.tabs/browser.tabGroups calls from the service worker's own
// context, the same context background.ts's real listeners run in.
// Deliberately doesn't set a windowBindingMap entry: handleTabGroupUpdated
// never consults one, and setting it would spawn a real, live-resyncing
// windowSyncMachine actor for the window that has nothing to do with what
// this suite is testing.

test("a native rename on an already-active group updates its stored name", async ({
  serviceWorker,
}) => {
  const result = await serviceWorker.evaluate(async () => {
    const win = await browser.windows.create({});
    if (!win?.id) throw new Error("window.create returned no id");
    const tab = await browser.tabs.create({
      windowId: win.id,
      url: "https://example.com/",
    });
    if (!tab.id) throw new Error("tabs.create returned no id");

    try {
      const projectId = crypto.randomUUID();
      const groupId = crypto.randomUUID();
      const now = Date.now();

      // Arrange: matches what createFolder/createGroup + activateGroupInProject
      // would have produced — the thing under test is the rename below, not this.
      await browser.storage.local.set({
        folders: [
          {
            id: projectId,
            name: "E2E Project",
            parentId: null,
            kind: "project",
            createdAt: now,
            updatedAt: now,
            tabs: [],
          },
        ],
        groups: [
          {
            id: groupId,
            name: "Untitled group",
            tabs: [{ url: tab.url, title: "" }],
            createdAt: now,
            updatedAt: now,
            order: 0,
            folderId: projectId,
            status: "active",
          },
        ],
      });

      const nativeId = await browser.tabs.group({ tabIds: [tab.id] });
      await browser.tabGroups.update(nativeId, {
        title: "Untitled group",
        collapsed: false,
      });
      await browser.storage.session.set({
        tabGroupOwners: { [nativeId]: { table: "groups", id: groupId } },
      });

      // Act: a native rename, same as a user typing into the tab-strip
      // group editor.
      await browser.tabGroups.update(nativeId, { title: "Roadmap" });

      // background.ts's listener runs async and isn't awaited by Chrome's
      // dispatcher — poll briefly instead of asserting immediately.
      let groups: Array<{ id: string; name: string; status?: string }> = [];
      for (let i = 0; i < 20; i++) {
        const stored = await browser.storage.local.get("groups");
        groups = (stored.groups ?? []) as typeof groups;
        if (groups.find((g) => g.id === groupId)?.name === "Roadmap") break;
        await new Promise((r) => setTimeout(r, 100));
      }

      // Give any spurious re-sync a moment to misbehave if it's going to —
      // then check the native title is still what we set, not reverted.
      await new Promise((r) => setTimeout(r, 300));
      const nativeGroup = await browser.tabGroups.get(nativeId);

      const group = groups.find((g) => g.id === groupId);
      return {
        storedName: group?.name,
        storedStatus: group?.status,
        nativeTitle: nativeGroup.title,
      };
    } finally {
      await browser.windows.remove(win.id);
    }
  });

  expect(result.storedName).toBe("Roadmap");
  expect(result.storedStatus).toBe("active");
  expect(result.nativeTitle).toBe("Roadmap");
});

// The actual reported scenario: a group left expanded-but-not-"active" by
// whatever created it (captureGroups.ts's silent capture, or the
// dashboard's "create a group in an open project" before it was fixed to
// match) — renaming it must not get misread as "the user just expanded a
// previously-collapsed group" and spuriously activate it.
test("a native rename on a merely-expanded (not active) group updates its name without activating it", async ({
  serviceWorker,
}) => {
  const result = await serviceWorker.evaluate(async () => {
    const win = await browser.windows.create({});
    if (!win?.id) throw new Error("window.create returned no id");
    const tab = await browser.tabs.create({
      windowId: win.id,
      url: "https://example.com/",
    });
    if (!tab.id) throw new Error("tabs.create returned no id");

    try {
      const projectId = crypto.randomUUID();
      const groupId = crypto.randomUUID();
      const now = Date.now();

      await browser.storage.local.set({
        folders: [
          {
            id: projectId,
            name: "E2E Project",
            parentId: null,
            kind: "project",
            createdAt: now,
            updatedAt: now,
            tabs: [],
          },
        ],
        groups: [
          {
            id: groupId,
            name: "Untitled group",
            tabs: [{ url: tab.url, title: "" }],
            createdAt: now,
            updatedAt: now,
            order: 0,
            folderId: projectId,
            // The inconsistency itself: a pending group's native tab group
            // left expanded — exactly what captureGroups.ts's silent
            // capture (and the pre-fix "create a group in an open
            // project" path) produced.
            status: "pending",
          },
        ],
      });

      const nativeId = await browser.tabs.group({ tabIds: [tab.id] });
      await browser.tabGroups.update(nativeId, {
        title: "Untitled group",
        collapsed: false,
      });
      await browser.storage.session.set({
        tabGroupOwners: { [nativeId]: { table: "groups", id: groupId } },
      });

      await browser.tabGroups.update(nativeId, { title: "Roadmap" });

      let groups: Array<{ id: string; name: string; status?: string }> = [];
      for (let i = 0; i < 20; i++) {
        const stored = await browser.storage.local.get("groups");
        groups = (stored.groups ?? []) as typeof groups;
        if (groups.find((g) => g.id === groupId)?.name === "Roadmap") break;
        await new Promise((r) => setTimeout(r, 100));
      }
      // Give a spurious activation a moment to fire if it's going to.
      await new Promise((r) => setTimeout(r, 500));
      const finalStored = await browser.storage.local.get("groups");
      const finalGroups = (finalStored.groups ?? []) as typeof groups;

      const group = groups.find((g) => g.id === groupId);
      const finalGroup = finalGroups.find((g) => g.id === groupId);
      return { storedName: group?.name, finalStatus: finalGroup?.status };
    } finally {
      await browser.windows.remove(win.id);
    }
  });

  expect(result.storedName).toBe("Roadmap");
  expect(result.finalStatus).toBe("pending");
});
