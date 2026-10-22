import type { ExtensionApi } from "./controller";

export const CONTENT_SCRIPT_FILE = "content.js";

/** The production ExtensionApi backed by Chrome extension APIs. */
export const chromeApi: ExtensionApi = {
  async getTabUrl(tabId) {
    const tab = await chrome.tabs.get(tabId);
    return tab.url;
  },
  async injectContentScript(tabId) {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: [CONTENT_SCRIPT_FILE],
      world: "ISOLATED",
    });
  },
  sendToTab(tabId, message) {
    return chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
  },
  newExecId: () => crypto.randomUUID(),
  now: () => Date.now(),
};
