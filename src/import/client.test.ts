import { describe, expect, it } from "vitest";
import { type ImportHandle, startImport, type TimerApi, type WorkerLike } from "./client";
import { ImportController, type ImportSession } from "./controller";
import { emptyReport } from "./results";
import { DEFAULT_IMPORT_LIMITS, type ImportResult } from "./types";

class FakeWorker implements WorkerLike {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(data: unknown): void {
    this.onmessage?.({ data });
  }
}

class FakeTimers implements TimerApi {
  pending: Array<{ id: number; fn: () => void; ms: number }> = [];
  private next = 1;

  set(fn: () => void, ms: number): number {
    const id = this.next++;
    this.pending.push({ id, fn, ms });
    return id;
  }

  clear(id: number): void {
    this.pending = this.pending.filter((t) => t.id !== id);
  }

  fire(): void {
    const timers = this.pending;
    this.pending = [];
    for (const t of timers) {
      t.fn();
    }
  }
}

const COMPLETE: ImportResult = {
  status: "complete",
  records: [],
  coverage: {
    status: "complete-within-declared-scope",
    declaredScope: "chatgpt-export:conversations.json",
    observedCount: 0,
    reportedTotal: null,
    excludedScopes: [],
    evidenceRefs: [],
  },
  issues: [],
  report: emptyReport(),
};

function start(): { worker: FakeWorker; timers: FakeTimers; handle: ImportHandle } {
  const worker = new FakeWorker();
  const timers = new FakeTimers();
  const handle = startImport(new Blob(["x"]), DEFAULT_IMPORT_LIMITS, () => worker, timers);
  return { worker, timers, handle };
}

describe("startImport", () => {
  it("posts the file and limits, resolves with the result and terminates the worker", async () => {
    const { worker, timers, handle } = start();
    expect(worker.posted).toEqual([
      { kind: "start", file: expect.any(Blob), limits: DEFAULT_IMPORT_LIMITS },
    ]);
    worker.reply({ kind: "result", result: COMPLETE });
    expect(await handle.result).toBe(COMPLETE);
    expect(worker.terminated).toBe(true);
    expect(timers.pending).toEqual([]);
  });

  it("terminates the worker on cancel and resolves cancelled with no records", async () => {
    const { worker, handle } = start();
    handle.cancel();
    const result = await handle.result;
    expect(worker.terminated).toBe(true);
    expect(result.status).toBe("cancelled");
    expect(result.records).toEqual([]);
  });

  it("ignores a result that arrives after cancel", async () => {
    const { worker, handle } = start();
    handle.cancel();
    worker.reply({ kind: "result", result: COMPLETE });
    expect((await handle.result).status).toBe("cancelled");
  });

  it("terminates the worker when the hard time limit passes", async () => {
    const { worker, timers, handle } = start();
    expect(timers.pending[0]?.ms).toBeGreaterThan(DEFAULT_IMPORT_LIMITS.maxMillis);
    timers.fire();
    const result = await handle.result;
    expect(worker.terminated).toBe(true);
    expect(result.status).toBe("failed");
    expect(result.issues).toEqual([{ code: "limit-time", entry: null }]);
  });

  it("fails on a worker error", async () => {
    const { worker, handle } = start();
    worker.onerror?.({});
    expect((await handle.result).issues).toEqual([{ code: "worker-error", entry: null }]);
    expect(worker.terminated).toBe(true);
  });

  const malformed: ReadonlyArray<[string, unknown]> = [
    ["a non-object", "done"],
    ["a wrong kind", { kind: "progress", result: COMPLETE }],
    ["extra keys", { kind: "result", result: COMPLETE, extra: 1 }],
    ["an unknown status", { kind: "result", result: { ...COMPLETE, status: "ok" } }],
    ["records that are not an array", { kind: "result", result: { ...COMPLETE, records: {} } }],
    [
      "a failed status with records",
      { kind: "result", result: { ...COMPLETE, status: "failed", records: [{}] } },
    ],
  ];

  for (const [label, data] of malformed) {
    it(`fails on a reply with ${label}`, async () => {
      const { worker, handle } = start();
      worker.reply(data);
      expect((await handle.result).issues).toEqual([{ code: "worker-error", entry: null }]);
    });
  }
});

describe("ImportController", () => {
  function setup() {
    const handles: Array<{ resolve: (r: ImportResult) => void; cancelled: boolean }> = [];
    const states: ImportSession[] = [];
    const controller = new ImportController(
      () => {
        let resolve: (r: ImportResult) => void = () => undefined;
        const result = new Promise<ImportResult>((r) => {
          resolve = r;
        });
        const entry = { resolve, cancelled: false };
        handles.push(entry);
        return {
          result,
          cancel: () => {
            entry.cancelled = true;
            resolve({ ...COMPLETE, status: "cancelled" });
          },
        };
      },
      (s) => states.push(s),
    );
    return { controller, handles, states };
  }

  it("replaces the previous result and increments the revision on re-import (AT07)", async () => {
    const { controller, handles, states } = setup();
    controller.begin(new Blob(["1"]));
    handles[0]?.resolve(COMPLETE);
    await Promise.resolve();
    await Promise.resolve();
    controller.begin(new Blob(["2"]));
    const second = { ...COMPLETE, status: "partial" as const };
    handles[1]?.resolve(second);
    await Promise.resolve();
    await Promise.resolve();
    expect(states.at(-1)).toEqual({ revision: 2, result: second, running: false });
    expect(states.map((s) => s.revision)).toEqual([0, 1, 1, 2]);
  });

  it("cancels an import still running when a new one begins, and ignores its result", async () => {
    const { controller, handles, states } = setup();
    controller.begin(new Blob(["1"]));
    controller.begin(new Blob(["2"]));
    expect(handles[0]?.cancelled).toBe(true);
    handles[1]?.resolve(COMPLETE);
    await Promise.resolve();
    await Promise.resolve();
    expect(states.at(-1)).toEqual({ revision: 1, result: COMPLETE, running: false });
  });

  it("commits a cancelled import as the new state, dropping the old records", async () => {
    const { controller, handles, states } = setup();
    controller.begin(new Blob(["1"]));
    handles[0]?.resolve(COMPLETE);
    await Promise.resolve();
    await Promise.resolve();
    controller.begin(new Blob(["2"]));
    controller.cancel();
    await Promise.resolve();
    await Promise.resolve();
    expect(states.at(-1)?.result?.status).toBe("cancelled");
    expect(states.at(-1)?.revision).toBe(2);
  });
});
