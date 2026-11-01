// Production dependencies of the KEEP store: chrome.storage.local, Web Locks
// and WebCrypto in the management page (P-0007).
import { STORAGE_KEY } from "../../keep/envelope";
import type { LockManagerLike, StorageAreaLike } from "../../keep/keepGateway";
import type { KeepDeps } from "../../keep/keepStore";

function localArea(): StorageAreaLike {
  const local = chrome.storage.local;
  const area: StorageAreaLike = {
    get: (key) => local.get(key),
    set: (items) => local.set(items),
    remove: (key) => local.remove(key),
  };
  // Only offered when the browser has it; a missing API keeps the store closed (KINV-8).
  if (typeof local.setAccessLevel === "function") {
    area.setAccessLevel = (options) => local.setAccessLevel(options);
  }
  return area;
}

export function chromeKeepDeps(): KeepDeps {
  return {
    storage: localArea(),
    locks:
      typeof navigator.locks === "undefined"
        ? null
        : (navigator.locks as unknown as LockManagerLike),
    subtle: crypto.subtle,
    random: (bytes) => crypto.getRandomValues(new Uint8Array(bytes)),
    timers: {
      set: (fn, ms) => window.setTimeout(fn, ms),
      clear: (id) => window.clearTimeout(id),
    },
    onStoredChange: (listener) => {
      const handler = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
        const change = changes[STORAGE_KEY];
        if (areaName === "local" && change !== undefined) {
          listener(change.newValue);
        }
      };
      chrome.storage.onChanged.addListener(handler);
      return () => chrome.storage.onChanged.removeListener(handler);
    },
  };
}
