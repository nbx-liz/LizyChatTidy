// Development-only KEEP store dependencies for dev-workspace.html: an
// in-memory storage area (lost on reload) with the browser's WebCrypto and
// Web Locks. Never part of the extension build.
import type { StorageAreaLike } from "../keep/keepGateway";
import type { KeepDeps } from "../keep/keepStore";

export function memoryKeepDeps(): KeepDeps {
  const data = new Map<string, unknown>();
  const listeners = new Set<(value: unknown) => void>();
  const emit = (value: unknown) => {
    queueMicrotask(() => {
      for (const l of listeners) {
        l(value);
      }
    });
  };
  const storage: StorageAreaLike = {
    get: async (key) => (data.has(key) ? { [key]: structuredClone(data.get(key)) } : {}),
    set: async (items) => {
      for (const [k, v] of Object.entries(items)) {
        data.set(k, structuredClone(v));
        emit(v);
      }
    },
    remove: async (key) => {
      data.delete(key);
      emit(undefined);
    },
    setAccessLevel: async () => undefined,
  };
  return {
    storage,
    locks: navigator.locks as unknown as KeepDeps["locks"],
    subtle: crypto.subtle,
    random: (bytes) => crypto.getRandomValues(new Uint8Array(bytes)),
    timers: { set: (fn, ms) => window.setTimeout(fn, ms), clear: (id) => window.clearTimeout(id) },
    onStoredChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    // The minimum accepted count keeps the dev page responsive.
    iterations: 100_000,
  };
}
