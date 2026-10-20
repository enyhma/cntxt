import { type ActorRefFrom, createActor } from "xstate";
import { ensureBindingForWindow } from "@/utils/attach";
import {
  clearWindowBindingMap,
  getWindowBindingBackup,
  getWindowBindingMap,
  removeWindowBinding,
  requestSearchOpen,
  setWindowBinding,
} from "@/utils/session";
import { getSettings, updateSettings } from "@/utils/settings";
import { DASHBOARD_URL, ensureDashboardTab } from "@/utils/tabs";
import { windowSyncMachine } from "@/utils/windowSyncMachine";
import { scheduleCaptureCheck } from "@/utils/captureGroups";
import {
  changedSessionCaptureInterval,
  handleTabGroupRemoved,
  handleTabGroupUpdated,
  shouldAdoptWindowsOnInstall,
  shouldResyncOnStorageChange,
} from "@/utils/backgroundEvents";
import {
  captureSession,
  isRestoringSession,
  pruneOldLocalSessions,
} from "@/utils/sessions";
import { runAutoArchiveCheck } from "@/utils/autoArchive";

const SESSION_ALARM_NAME = "cntxt-session-capture";

export default defineBackground(() => {
  const windowActors = new Map<
    number,
    ActorRefFrom<typeof windowSyncMachine>
  >();

  function trackWindow(windowId: number) {
    if (windowActors.has(windowId)) return;
    const actor = createActor(windowSyncMachine, {
      input: { windowId },
    });
    actor.start();
    windowActors.set(windowId, actor);
  }

  function untrackWindow(windowId: number) {
    const actor = windowActors.get(windowId);
    if (!actor) return;
    actor.send({ type: "WINDOW_CLOSED" });
    windowActors.delete(windowId);
  }

  function notifyTabsChanged(windowId: number | undefined) {
    if (windowId === undefined) return;
    windowActors.get(windowId)?.send({ type: "TABS_CHANGED" });
  }

  // Service workers restart often (idle unload, browser startup, or — the
  // one that actually prompted this — a dev-server reload / crash
  // recovery); rehydrate the in-memory actor registry from the persisted
  // window->binding map every time this callback runs so tab-sync
  // survives a restart.
  (async () => {
    let map = await getWindowBindingMap();
    if (Object.keys(map).length === 0) {
      // storage.session (unlike storage.local) is also wiped by a
      // mid-session extension reload, even though every window id is
      // still exactly what it was — recover from the storage.local
      // backup (utils/session.ts) rather than treating every open
      // window as freshly unbound. Each entry is checked against the
      // browser's actual window list first, so a closed window just
      // drops instead of attaching to whatever unrelated window
      // happens to reuse its id later.
      const backup = await getWindowBindingBackup();
      for (const [idStr, binding] of Object.entries(backup)) {
        const windowId = Number(idStr);
        try {
          await browser.windows.get(windowId);
        } catch {
          continue;
        }
        await setWindowBinding(windowId, binding);
      }
      map = await getWindowBindingMap();
    }
    for (const windowId of Object.keys(map).map(Number)) {
      trackWindow(windowId);
    }
  })();

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== SESSION_ALARM_NAME) return;
    captureSession()
      .then(() => pruneOldLocalSessions())
      .then(() => runAutoArchiveCheck())
      .catch((e: unknown) => console.debug("session capture failed:", e));
  });

  (async () => {
    // check-then-create: alarms persist across service-worker restarts, and
    // unconditionally re-creating on every wake would keep resetting a live
    // timer on a frequently-woken worker, potentially delaying it
    // indefinitely. A later change to the setting is instead caught by the
    // storage.onChanged listener below, which re-arms deliberately.
    if (!(await browser.alarms.get(SESSION_ALARM_NAME))) {
      const { sessionCaptureIntervalMinutes } = await getSettings();
      browser.alarms.create(SESSION_ALARM_NAME, {
        periodInMinutes: sessionCaptureIntervalMinutes,
      });
    }
  })();

  // Shared by every place a window needs onboarding: bind it to something (a
  // fresh "Untitled Project" if it has no binding yet — see
  // ensureBindingForWindow), open its dashboard tab, and start tracking it.
  // Idempotent — calling this for a window that's already bound just
  // confirms the existing binding rather than creating a duplicate — so
  // it's always safe to call unconditionally rather than checking first.
  async function adoptWindow(windowId: number) {
    await ensureBindingForWindow(windowId);
    await ensureDashboardTab(windowId);
    trackWindow(windowId);
  }

  async function adoptAllOpenWindows() {
    const windows = await browser.windows.getAll({ windowTypes: ["normal"] });
    for (const win of windows) {
      if (win.id === undefined) continue;
      await adoptWindow(win.id);
    }
  }

  browser.runtime.onStartup.addListener(async () => {
    // A genuine browser restart, unlike the reload above, DOES invalidate
    // every window id — Chrome can (and does) reuse small ids after a
    // relaunch. Wipe first so this pass always rebuilds every binding
    // fresh via ensureBindingForWindow, regardless of whatever the boot
    // rehydration above already restored from the storage.local backup.
    // ponytail: these two async passes aren't mutually locked, so a
    // backup-restore write that happens to land after this wipe could in
    // theory still slip a stale id-collided entry back in — accepted as a
    // rare, self-correcting race (the next tab event re-syncs the right
    // target anyway) rather than adding real cross-task coordination for it.
    await clearWindowBindingMap();
    await adoptAllOpenWindows();
  });

  // A live install (the common case — adding the extension to an
  // already-running browser from the Web Store) fires onInstalled, not
  // onStartup; onStartup only fires on a genuine browser relaunch. Without
  // this, every window open at install time sat completely untracked until
  // the user clicked the toolbar icon in it specifically. No wipe needed
  // here (unlike onStartup): a fresh install's binding map is guaranteed
  // empty — the browser clears extension storage on uninstall, so even a
  // reinstall starts from nothing. Scoped to reason === "install" only —
  // an update (reason === "update"/"chrome_update") already has correct
  // bindings for every window; re-running this would be redundant at best.
  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    if (shouldAdoptWindowsOnInstall(reason)) await adoptAllOpenWindows();
  });

  browser.windows.onRemoved.addListener((windowId) => {
    untrackWindow(windowId);
    removeWindowBinding(windowId);
  });

  // Every new normal window is onboarded immediately — no click-to-adopt:
  // bound to a fresh "Untitled Project" from whatever tabs it opened with
  // (or reattached per settings.lastActiveBinding, same as
  // ensureBindingForWindow always decided for action.onClicked), with its
  // dashboard tab pinned in automatically. "Every window is a workspace"
  // applies the moment the window exists, not only once the user asks.
  //
  // Two exclusions:
  // - win.type !== "normal": onCreated fires for popups, devtools, panels,
  //   and picture-in-picture too (all technically "windows") — adopting
  //   those would force a Project + a pinned dashboard tab into a window
  //   that was never meant to hold either. Every other window listing in
  //   this codebase already filters to windowTypes: ["normal"]; onCreated
  //   just never had the chance to until now.
  // - isRestoringSession(): restoreSession (utils/sessions.ts) creates
  //   windows itself and sets each one's binding explicitly right after —
  //   adopting here too would race that and could create a throwaway
  //   Untitled Project in the gap, burning a real quota slot. trackWindow
  //   still runs so tab-sync is primed the instant restoreSession's own
  //   binding lands, matching what this listener already did before this
  //   change.
  browser.windows.onCreated.addListener(async (win) => {
    if (win.id === undefined || win.type !== "normal") return;
    if (isRestoringSession()) {
      trackWindow(win.id);
      return;
    }
    await adoptWindow(win.id);
  });

  browser.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === browser.windows.WINDOW_ID_NONE) return;
    const map = await getWindowBindingMap();
    const binding = map[windowId];
    if (binding) await updateSettings({ lastActiveBinding: binding });
  });

  browser.tabs.onCreated.addListener((tab) => notifyTabsChanged(tab.windowId));
  browser.tabs.onRemoved.addListener((_tabId, info) =>
    notifyTabsChanged(info.windowId),
  );
  browser.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.url !== undefined || changeInfo.title !== undefined) {
      notifyTabsChanged(tab.windowId);
    }
    // A tab joining a real group (not TAB_GROUP_ID_NONE) is the native
    // tab-groups "silent capture" trigger — see utils/captureGroups.ts.
    // Independent of the url/title check above: both can fire off one event.
    if (
      changeInfo.groupId !== undefined &&
      changeInfo.groupId !== -1 &&
      tab.windowId !== undefined
    ) {
      scheduleCaptureCheck(tab.windowId, changeInfo.groupId);
    }
  });
  browser.tabs.onMoved.addListener((_tabId, info) =>
    notifyTabsChanged(info.windowId),
  );

  // See utils/backgroundEvents.ts for what each of these three decides —
  // kept there, not here, so it's unit-testable.
  browser.tabGroups?.onUpdated.addListener(handleTabGroupUpdated);
  browser.tabGroups?.onRemoved.addListener(handleTabGroupRemoved);

  // ponytail: rescans every tracked window rather than indexing which one
  // owns the changed entity — fine at expected scale, add a reverse index
  // if this gets measurably expensive.
  browser.storage.onChanged.addListener((changes, area) => {
    if (shouldResyncOnStorageChange(changes, area)) {
      for (const windowId of windowActors.keys()) notifyTabsChanged(windowId);
    }
    const newInterval = changedSessionCaptureInterval(changes, area);
    if (newInterval !== undefined) {
      browser.alarms.clear(SESSION_ALARM_NAME).then(() =>
        browser.alarms.create(SESSION_ALARM_NAME, {
          periodInMinutes: newInterval,
        }),
      );
    }
  });

  browser.action.onClicked.addListener(async (tab) => {
    if (tab.windowId === undefined) return;
    const [existing] = await browser.tabs.query({
      url: DASHBOARD_URL,
      windowId: tab.windowId,
    });
    if (existing?.id !== undefined) {
      await browser.tabs.update(existing.id, { active: true });
      return;
    }
    await ensureBindingForWindow(tab.windowId);
    await ensureDashboardTab(tab.windowId);
    trackWindow(tab.windowId);
  });

  // The global "open search" hotkey (wxt.config.ts's commands.suggested_key)
  // — fires no matter which tab/site has focus, unlike the in-page ⌘K
  // shortcut App.tsx registers (which only works once its own dashboard
  // tab is already the focused one). `tab` is the one active when the
  // shortcut fired; Firefox doesn't pass it, hence the fallback.
  browser.commands.onCommand.addListener(async (command, tab) => {
    if (command !== "open-search") return;
    const windowId =
      tab?.windowId ?? (await browser.windows.getLastFocused()).id;
    if (windowId === undefined) return;

    await adoptWindow(windowId);
    const [dashboardTab] = await browser.tabs.query({
      url: DASHBOARD_URL,
      windowId,
    });
    // ensureDashboardTab (inside adoptWindow) only creates/pins — it never
    // activates an already-existing tab the user wasn't currently on, so
    // that's done explicitly here. openPalette() itself is requested via
    // storage (requestSearchOpen) rather than called directly: this is the
    // background script, which has no access to the dashboard page's own
    // Solid state.
    if (dashboardTab?.id !== undefined) {
      await browser.tabs.update(dashboardTab.id, { active: true });
    }
    await requestSearchOpen(windowId);
  });
});
