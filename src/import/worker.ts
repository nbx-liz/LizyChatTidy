// Dedicated Web Worker entry for the import (P-0004 item 3, P-0005 item 7).
// It handles one start message, replies once, and is then terminated by the
// management page. All parsing lives in the pure parseChatGptExport.
import { parseChatGptExport } from "./chatgptExport";
import { terminalResult } from "./results";
import type { ImportResult } from "./types";
import { parseStartMessage } from "./workerProtocol";

interface WorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: unknown): void;
}

const scope = globalThis as unknown as WorkerScope;
let started = false;

function reply(result: ImportResult): void {
  scope.postMessage({ kind: "result", result });
}

scope.addEventListener("message", (event) => {
  const start = parseStartMessage(event.data);
  if (started || start === null) {
    reply(terminalResult("worker-error"));
    return;
  }
  started = true;
  // Cancellation is by Worker.terminate(); this signal is never aborted here.
  parseChatGptExport(start.file, start.limits, new AbortController().signal).then(reply, () =>
    reply(terminalResult("worker-error")),
  );
});
