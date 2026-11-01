// The one-time approval (P-0009 item 6). Memory only (INV-08).
import { APPROVAL_TTL_MS, type Approval, type Liveness } from "./types";

export class ApprovalBook {
  private value: Approval | null = null;
  private used = false;
  private invalid = false;

  get current(): Approval | null {
    return this.value;
  }

  issue(fields: Omit<Approval, "issuedAt" | "expiresAt">, now: number): Approval {
    this.value = { ...fields, issuedAt: now, expiresAt: now + APPROVAL_TTL_MS };
    this.used = false;
    this.invalid = false;
    return this.value;
  }

  /** True when `approvalId` may start a run now. */
  usable(approvalId: string, planId: string, planDigest: string): boolean {
    const a = this.value;
    return (
      a !== null &&
      !this.used &&
      !this.invalid &&
      a.approvalId === approvalId &&
      a.planId === planId &&
      a.planDigest === planDigest
    );
  }

  /** start() consumed it: it cannot start again but still governs its run. */
  consume(): void {
    this.used = true;
  }

  invalidate(): void {
    this.invalid = true;
    this.value = null;
  }

  clear(): void {
    this.value = null;
    this.used = false;
    this.invalid = false;
  }

  liveness(now: number, disposed: boolean, stopped: boolean): Liveness {
    if (disposed) {
      return "disposed";
    }
    if (stopped) {
      return "stopped";
    }
    if (this.value === null || this.invalid) {
      return "invalid";
    }
    return now >= this.value.expiresAt ? "expired" : "live";
  }
}
