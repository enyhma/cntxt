import { fakeBrowser } from "wxt/testing/fake-browser";

const originalRemove = fakeBrowser.tabs.remove.bind(fakeBrowser.tabs);

/**
 * Works around a bug in @webext-core/fake-browser@2.0.1: tabs.remove()
 * resolves the removed tab's window via `windows.get(removedTab.id)` (the
 * tab's OWN id) instead of `removedTab.windowId`, which throws whenever the
 * two don't coincidentally match — i.e. almost always once a window has
 * more than one tab. This removes ids one at a time, captures each tab's
 * real windowId first, swallows the library's crash, and re-fires
 * onRemoved with the correct windowId. Persists across fakeBrowser.reset()
 * since reset only clears internal state, not method references.
 */
fakeBrowser.tabs.remove = async (tabIds: number | number[]) => {
  const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
  for (const id of ids) {
    const tab = await fakeBrowser.tabs.get(id);
    if (!tab) continue;
    await originalRemove(id).catch(() => {});
    await fakeBrowser.tabs.onRemoved.trigger(id, {
      isWindowClosing: false,
      windowId: tab.windowId,
    });
  }
};
