export default defineBackground(() => {
  browser.action.onClicked.addListener(async (tab) => {
    const dashboardUrl = browser.runtime.getURL("/dashboard.html");
    const [existing] = await browser.tabs.query({
      url: dashboardUrl,
      windowId: tab.windowId,
    });

    if (existing?.id !== undefined) {
      await browser.tabs.update(existing.id, { active: true });
      return;
    }

    await browser.tabs.create({ url: dashboardUrl, pinned: true });
  });
});
