// Turns the date inputs into a filter condition. An input the browser reports
// as invalid (validity.badInput, e.g. an incomplete or impossible date) has an
// empty value, so its validity is carried separately: an invalid side must
// never look like an open bound (PR #7 review).
import { localDayBound } from "./format";

export interface DateInputs {
  readonly from: string;
  readonly to: string;
  readonly fromInvalid: boolean;
  readonly toInvalid: boolean;
}

export type DateCondition =
  | { readonly status: "none" }
  | { readonly status: "active"; readonly fromMs: number | null; readonly toMs: number | null }
  | { readonly status: "invalid" }
  | { readonly status: "reversed" };

export function dateCondition(inputs: DateInputs): DateCondition {
  const fromMs = localDayBound(inputs.from, "start");
  const toMs = localDayBound(inputs.to, "end");
  const fromBad = inputs.fromInvalid || (inputs.from !== "" && fromMs === null);
  const toBad = inputs.toInvalid || (inputs.to !== "" && toMs === null);
  if (fromBad || toBad) {
    return { status: "invalid" };
  }
  if (fromMs === null && toMs === null) {
    return { status: "none" };
  }
  if (fromMs !== null && toMs !== null && fromMs > toMs) {
    return { status: "reversed" };
  }
  return { status: "active", fromMs, toMs };
}
