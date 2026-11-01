// Test harness for the Chrome integration suite (P-0008). Everything here is
// test-only: it loads the built extension from dist/ (or a modified COPY of it
// in a temp directory) and never touches src/ or public/.
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type BrowserContext,
  test as base,
  chromium,
  expect,
  type Page,
  type Worker,
} from "@playwright/test";

export const DIST = resolve("dist");

/** The status text strings the management page shows (src/app/keep/KeepPanel.tsx). */
export const PASSPHRASE = "correct horse battery staple";

/** Launches Chromium (new headless) with the extension at `extensionPath` and an empty profile. */
export async function launchWithExtension(extensionPath: string): Promise<{
  context: BrowserContext;
  extensionId: string;
  close: () => Promise<void>;
}> {
  const profile = await mkdtemp(join(tmpdir(), "lizychattidy-profile-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      // Chromium's crash handler cannot start inside restricted sandboxes.
      "--disable-crash-reporter",
      `--crash-dumps-dir=${join(profile, "crashes")}`,
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  let worker: Worker | undefined = context.serviceWorkers()[0];
  worker ??= await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  return {
    context,
    extensionId,
    close: async () => {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    },
  };
}

interface Fixtures {
  context: BrowserContext;
  extensionId: string;
}

export const test = base.extend<Fixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright fixtures require a destructuring pattern
  context: async ({}, use) => {
    const launched = await launchWithExtension(DIST);
    await use(launched.context);
    await launched.close();
  },
  extensionId: async ({ context }, use) => {
    let worker: Worker | undefined = context.serviceWorkers()[0];
    worker ??= await context.waitForEvent("serviceworker");
    await use(new URL(worker.url()).host);
  },
});

export { expect };

export function appUrl(extensionId: string, search = ""): string {
  return `chrome-extension://${extensionId}/app.html${search}`;
}

/** Opens the management page and waits until the KEEP panel has left "確認中". */
export async function openApp(
  context: BrowserContext,
  extensionId: string,
  search = "",
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(appUrl(extensionId, search));
  await expect(keepStatus(page)).not.toHaveText(/^確認中/);
  return page;
}

export function keepPanel(page: Page) {
  return page.locator(".keep-panel");
}

/** The KEEP panel's status line, for example "未作成：KEEP の保存先がありません…". */
export function keepStatus(page: Page) {
  return keepPanel(page).getByRole("status");
}

export async function createKeepStore(page: Page, passphrase = PASSPHRASE): Promise<void> {
  const panel = keepPanel(page);
  await panel.getByRole("button", { name: "保存先を作成…" }).click();
  await panel.getByLabel("上記を理解し、保存先の作成に同意します").check();
  await panel.getByLabel("パスフレーズ（12 文字以上）", { exact: true }).fill(passphrase);
  await panel.getByLabel("パスフレーズ（確認）", { exact: true }).fill(passphrase);
  await panel.getByRole("button", { name: "作成", exact: true }).click();
  await expect(keepStatus(page)).toContainText("解除済み");
}

export async function unlockKeepStore(page: Page, passphrase = PASSPHRASE): Promise<void> {
  const panel = keepPanel(page);
  // After a failed attempt the form stays open, so only open it when it is closed.
  const open = panel.getByRole("button", { name: "解除…" });
  if ((await open.count()) > 0) {
    await open.click();
  }
  await panel.getByLabel("パスフレーズ", { exact: true }).fill(passphrase);
  await panel.getByRole("button", { name: "解除", exact: true }).click();
}

/** Everything in chrome.storage.local / sync, read from an extension page. */
export function readStorage(page: Page, area: "local" | "sync"): Promise<Record<string, unknown>> {
  return page.evaluate((name) => chrome.storage[name].get(null), area);
}

/** Collects console errors, page errors and every request URL the page makes. */
export function watch(page: Page): { errors: string[]; requests: string[] } {
  const seen = { errors: [] as string[], requests: [] as string[] };
  page.on("console", (message) => {
    if (message.type() === "error") {
      seen.errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => seen.errors.push(`pageerror: ${error.message}`));
  page.on("request", (request) => seen.requests.push(request.url()));
  return seen;
}

/**
 * A modified COPY of dist/ for checks the shipped manifest cannot support.
 * It adds (a) a test-only content script that reports what an ISOLATED-world
 * content script can do with chrome.storage.local, and (b) the `tabs`
 * permission so the management page can read a tab's URL without the
 * `activeTab` grant that only a toolbar click gives. The shipped dist/ is
 * never modified.
 */
export async function makeHarnessCopy(): Promise<{ path: string; remove: () => Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), "lizychattidy-harness-"));
  await cp(DIST, path, { recursive: true });
  const manifestPath = join(path, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  manifest["permissions"] = [...(manifest["permissions"] as string[]), "tabs"];
  manifest["content_scripts"] = [
    {
      matches: ["https://probe.test/*"],
      js: ["probe.js"],
      run_at: "document_idle",
      world: "ISOLATED",
    },
  ];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  await writeFile(join(path, "probe.js"), PROBE_SCRIPT);
  return { path, remove: () => rm(path, { recursive: true, force: true }) };
}

const PROBE_SCRIPT = `
(async () => {
  const out = { hasLocal: typeof chrome.storage?.local?.get === "function" };
  const text = (e) => String(e && e.message ? e.message : e);
  try {
    await chrome.storage.local.set({ probe: 1 });
    out.set = "ok";
  } catch (e) {
    out.set = "error: " + text(e);
  }
  try {
    out.get = await chrome.storage.local.get(null);
  } catch (e) {
    out.get = "error: " + text(e);
  }
  document.documentElement.dataset.probe = JSON.stringify(out);
})();
`;

/** Serves a tiny fake page for `url` without any network access. */
export async function fakePage(context: BrowserContext, url: string): Promise<void> {
  await context.route(`${url}**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>fake</title><p>synthetic page</p>",
    }),
  );
}
