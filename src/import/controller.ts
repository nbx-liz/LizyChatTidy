// Holds the single current import for the management page (P-0005 item 8).
// A new import replaces the previous result wholesale and increments the
// revision; DEV09 binds delete plans to this revision so that a re-import
// invalidates earlier approvals (AT07).
import type { ImportHandle } from "./client";
import { terminalResult } from "./results";
import type { ImportResult } from "./types";

export interface ImportSession {
  readonly revision: number;
  readonly result: ImportResult | null;
  readonly running: boolean;
}

export class ImportController {
  private session: ImportSession = { revision: 0, result: null, running: false };
  private current: { readonly id: number; readonly handle: ImportHandle } | null = null;
  private nextId = 1;

  constructor(
    private readonly start: (file: Blob) => ImportHandle,
    private readonly onChange: (session: ImportSession) => void,
  ) {}

  get state(): ImportSession {
    return this.session;
  }

  begin(file: Blob): void {
    // Detach the running import first, so its cancelled result is ignored.
    const previous = this.current;
    this.current = null;
    previous?.handle.cancel();
    const id = this.nextId++;
    const handle = this.start(file);
    this.current = { id, handle };
    this.emit({ ...this.session, running: true });
    handle.result.then(
      (result) => this.commit(id, result),
      () => this.commit(id, terminalResult("worker-error")),
    );
  }

  cancel(): void {
    this.current?.handle.cancel();
  }

  private commit(id: number, result: ImportResult): void {
    if (this.current?.id !== id) {
      return; // Superseded by a newer import.
    }
    this.current = null;
    this.emit({ revision: this.session.revision + 1, result, running: false });
  }

  private emit(session: ImportSession): void {
    this.session = session;
    this.onChange(session);
  }
}
