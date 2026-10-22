// The service worker only opens the management tab (P-0004). It holds no
// state and registers no message listener, so no page or content script can
// start an operation through it.

chrome.action.onClicked.addListener((tab) => {
  const url = new URL(chrome.runtime.getURL("app.html"));
  if (tab.id !== undefined) {
    url.searchParams.set("target", String(tab.id));
  }
  chrome.tabs.create({ url: url.href }).catch((error: unknown) => {
    console.error("lizychattidy: open-app-failed", error instanceof Error ? error.name : "unknown");
  });
});
