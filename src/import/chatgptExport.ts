// ChatGPT official export importer (P-0005). Pure: no Worker, DOM or chrome
// APIs, so it is tested directly; src/import/worker.ts only wraps it.

import { mapConversation, newShapeStats, type ShapeStats } from "./chatgptConversation";
import { type Counter, increment, newCounter } from "./counter";
import { Guard, ImportFailure } from "./guard";
import { jsonDepthExceeds } from "./jsonDepth";
import { coverageFor, terminalResult } from "./results";
import type {
  ConversationRecord,
  EntryCategory,
  ImportIssue,
  ImportLimits,
  ImportResult,
  StructureReport,
} from "./types";
import { readEntry, readZipDirectory, type ZipEntry } from "./zip";

const CONVERSATIONS = "conversations.json";
const CHECK_EVERY = 100;

// Known root entries. This list is a provisional guess at the export layout
// (P-0005 item 2): anything else is an "unknown-entry" issue, so a file that
// might hold conversations is never treated as out of scope silently.
const KNOWN_FILES: Readonly<Record<string, EntryCategory>> = {
  [CONVERSATIONS]: "conversations",
  "chat.html": "chat-html",
  "user.json": "user-json",
  "message_feedback.json": "message-feedback",
  "shared_conversations.json": "shared-conversations",
};
const ATTACHMENT_EXTENSIONS: ReadonlySet<string> = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "heic",
  "wav",
  "mp3",
  "m4a",
  "ogg",
  "webm",
  "mp4",
  "pdf",
]);
const EXTENSION = /^[a-z0-9]{1,8}$/;

function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= name.lastIndexOf("/") || dot === name.length - 1) {
    return null;
  }
  const ext = name.slice(dot + 1).toLowerCase();
  return EXTENSION.test(ext) ? ext : null;
}

function classify(entry: ZipEntry): EntryCategory {
  const { name } = entry;
  if (name === null) {
    return "unknown";
  }
  const known = Object.hasOwn(KNOWN_FILES, name) ? KNOWN_FILES[name] : undefined;
  if (known !== undefined) {
    return known;
  }
  if (name.endsWith("/") && entry.uncompressedSize === 0) {
    return "directory";
  }
  const ext = extensionOf(name);
  return ext !== null && ATTACHMENT_EXTENSIONS.has(ext) ? "attachment" : "unknown";
}

class ReportBuilder {
  entryCount = 0;
  readonly entries: Partial<Record<EntryCategory, { count: number; bytes: number }>> = {};
  readonly unknownExtensions: Counter = newCounter();
  conversationsUncompressedBytes: number | null = null;
  conversationCount = 0;
  readonly stats: ShapeStats = newShapeStats();

  addEntry(entry: ZipEntry, category: EntryCategory): void {
    const slot = this.entries[category] ?? { count: 0, bytes: 0 };
    this.entries[category] = { count: slot.count + 1, bytes: slot.bytes + entry.uncompressedSize };
    if (category === "unknown") {
      const ext = entry.name === null ? "(undecodable)" : (extensionOf(entry.name) ?? "(none)");
      increment(this.unknownExtensions, ext);
    }
  }

  build(): StructureReport {
    return {
      entryCount: this.entryCount,
      entries: this.entries,
      unknownExtensions: this.unknownExtensions,
      conversationsUncompressedBytes: this.conversationsUncompressedBytes,
      conversationCount: this.conversationCount,
      ...this.stats,
    };
  }
}

function decodeJson(bytes: Uint8Array, guard: Guard): unknown {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ImportFailure("json-encoding", CONVERSATIONS);
  }
  if (jsonDepthExceeds(text, guard.limits.maxJsonDepth)) {
    throw new ImportFailure("limit-json-depth", CONVERSATIONS);
  }
  guard.check();
  try {
    return JSON.parse(text);
  } catch {
    throw new ImportFailure("json-syntax", CONVERSATIONS);
  }
}

function mapAll(
  list: readonly unknown[],
  observedAt: string,
  report: ReportBuilder,
  guard: Guard,
): { records: ConversationRecord[]; issues: ImportIssue[] } {
  const mapped: Array<{ index: number; record: ConversationRecord }> = [];
  const issues: Array<{ index: number; issue: ImportIssue }> = [];
  list.forEach((raw, index) => {
    if (index % CHECK_EVERY === 0) {
      guard.check();
    }
    const result = mapConversation(raw, index, observedAt, report.stats);
    for (const issue of result.issues) {
      issues.push({ index, issue });
    }
    if (result.record !== null) {
      mapped.push({ index, record: result.record });
    }
  });
  // A repeated id is ambiguous: no copy is kept, and every copy is listed.
  const counts = new Map<string, number>();
  for (const { record } of mapped) {
    counts.set(record.conversationId, (counts.get(record.conversationId) ?? 0) + 1);
  }
  const records: ConversationRecord[] = [];
  for (const { index, record } of mapped) {
    if ((counts.get(record.conversationId) ?? 0) > 1) {
      issues.push({ index, issue: { code: "duplicate-id", entry: `${CONVERSATIONS}[${index}]` } });
    } else {
      records.push(record);
    }
  }
  issues.sort((a, b) => a.index - b.index);
  return { records, issues: issues.map((i) => i.issue) };
}

export async function parseChatGptExport(
  file: Blob,
  limits: ImportLimits,
  signal: AbortSignal,
  now: () => number = Date.now,
): Promise<ImportResult> {
  const report = new ReportBuilder();
  const observedAt = new Date(now()).toISOString();
  try {
    const guard = new Guard(limits, signal, now);
    guard.check();
    const dir = await readZipDirectory(file, guard);
    const entryIssues: ImportIssue[] = [];
    const excluded = new Set<string>();
    let conversationsEntry: ZipEntry | null = null;
    report.entryCount = dir.entries.length;
    for (const entry of dir.entries) {
      const category = classify(entry);
      report.addEntry(entry, category);
      if (category === "conversations") {
        conversationsEntry = entry;
      } else if (category === "unknown") {
        entryIssues.push({ code: "unknown-entry", entry: entry.name });
      } else if (category !== "directory") {
        excluded.add(category);
      }
    }
    if (conversationsEntry === null) {
      throw new ImportFailure("missing-conversations");
    }
    const bytes = await readEntry(file, dir, conversationsEntry, guard);
    report.conversationsUncompressedBytes = bytes.length;
    const parsed = decodeJson(bytes, guard);
    if (!Array.isArray(parsed)) {
      throw new ImportFailure("not-conversation-array", CONVERSATIONS);
    }
    report.conversationCount = parsed.length;
    const { records, issues } = mapAll(parsed, observedAt, report, guard);
    guard.check();
    const allIssues = [...entryIssues, ...issues];
    const status = allIssues.length === 0 ? "complete" : "partial";
    return {
      status,
      records,
      coverage: coverageFor(status, records.length, [...excluded].sort()),
      issues: allIssues,
      report: report.build(),
    };
  } catch (error) {
    if (!(error instanceof ImportFailure)) {
      throw error;
    }
    return terminalResult(error.code, report.build(), error.entry);
  }
}
