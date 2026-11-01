import { useEffect, useMemo, useState } from "react";
import { startImport, type WorkerLike } from "../import/client";
import { ImportController, type ImportSession } from "../import/controller";
import { DEFAULT_IMPORT_LIMITS } from "../import/types";

function createWorker(): WorkerLike {
  const worker = new Worker(new URL("../import/worker.ts", import.meta.url), { type: "module" });
  const like: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage: (message) => worker.postMessage(message),
    terminate: () => worker.terminate(),
  };
  worker.onmessage = (event) => like.onmessage?.({ data: event.data });
  worker.onerror = (event) => like.onerror?.(event);
  worker.onmessageerror = (event) => like.onerror?.(event);
  return like;
}

const browserTimers = {
  set: (fn: () => void, ms: number) => window.setTimeout(fn, ms),
  clear: (id: number) => window.clearTimeout(id),
};

export const INITIAL_SESSION: ImportSession = { revision: 0, result: null, running: false };

/** The page's single import session (P-0005 item 8), shared by the import panel and the list. */
export function useImportSession(): { session: ImportSession; controller: ImportController } {
  const [session, setSession] = useState<ImportSession>(INITIAL_SESSION);
  const controller = useMemo(
    () =>
      new ImportController(
        (file) => startImport(file, DEFAULT_IMPORT_LIMITS, createWorker, browserTimers),
        setSession,
      ),
    [],
  );
  useEffect(() => () => controller.cancel(), [controller]);
  return { session, controller };
}
