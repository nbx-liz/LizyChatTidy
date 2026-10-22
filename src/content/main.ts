// Injected on demand into the ISOLATED world of a supported tab (INV-18).
// It answers requests from the extension Controller and never starts a
// conversation with the extension on its own.
import { ExecIdLedger, handleRequest } from "./handler";

const INSTALLED = Symbol.for("lizychattidy.content");
const scope = globalThis as typeof globalThis & { [INSTALLED]?: true };

if (scope[INSTALLED] !== true) {
  scope[INSTALLED] = true;
  const ledger = new ExecIdLedger();
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    sendResponse(
      handleRequest(message, sender, {
        extensionId: chrome.runtime.id,
        pageUrl: location.href,
        now: Date.now(),
        ledger,
      }),
    );
    return false;
  });
}
