// Synthetic ChatGPT export for the browser tests. Every string is invented
// (CLAUDE.md safety rules). The ZIP is built with the unit tests' test-only
// builder, which uses node:zlib independently of the shipped reader.
import type { Page } from "@playwright/test";
import { buildZip } from "../../src/import/testing/zipFixture";

export const HOSTILE_TITLE = `<img src=x onerror="window.__pwned='title'"> Hostile title`;
export const HOSTILE_TEXT = `<script>window.__pwned='text'</script><b>bold?</b>`;
export const SECRET_TITLE_MARKER = "Zebra-quartz-title-marker";
export const SECRET_TEXT_MARKER = "Pelican-granite-body-marker";

export const IDS = {
  hostile: "6a1f0c2e-1b2c-4d3e-8f90-0123456789ab",
  plain: "7b2e1d3f-2c3d-4e4f-9a01-123456789abc",
  third: "8c3f2e40-3d4e-4f50-ab12-23456789abcd",
} as const;

function chat(id: string, title: string, text: string, updateTime: number) {
  const user = {
    id: `${id}-u`,
    author: { role: "user", name: null, metadata: {} },
    create_time: updateTime - 10,
    content: { content_type: "text", parts: [text] },
    status: "finished_successfully",
  };
  const assistant = {
    id: `${id}-a`,
    author: { role: "assistant", name: null, metadata: {} },
    create_time: updateTime - 5,
    content: { content_type: "text", parts: [`Answer to: ${text}`] },
    status: "finished_successfully",
  };
  return {
    id,
    conversation_id: id,
    title,
    create_time: updateTime - 100,
    update_time: updateTime,
    is_archived: false,
    mapping: {
      root: { id: "root", parent: null, children: ["u"], message: null },
      u: { id: "u", parent: "root", children: ["a"], message: user },
      a: { id: "a", parent: "u", children: [], message: assistant },
    },
    current_node: "a",
  };
}

/** Three conversations, newest first in the list: hostile, plain, third. */
export function syntheticExportZip(): Buffer {
  const conversations = [
    chat(IDS.hostile, HOSTILE_TITLE, HOSTILE_TEXT, 1_700_000_300),
    chat(IDS.plain, SECRET_TITLE_MARKER, SECRET_TEXT_MARKER, 1_700_000_200),
    chat(IDS.third, "Third synthetic title", "Third synthetic question", 1_700_000_100),
  ];
  return Buffer.from(
    buildZip([{ name: "conversations.json", data: JSON.stringify(conversations) }]),
  );
}

export async function importSyntheticExport(page: Page): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles({
    name: "synthetic-export.zip",
    mimeType: "application/zip",
    buffer: syntheticExportZip(),
  });
}
