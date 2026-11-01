// Management page, import, workspace and keyboard behaviour in a real Chromium
// (INV-01, AT09, AT33 partially). Real screen-reader output is not testable here.
import {
  expect,
  keepStatus,
  openApp,
  outsideExtension,
  test,
  watch,
  watchRequests,
} from "./fixtures";
import { HOSTILE_TITLE, IDS, importSyntheticExport } from "./synthetic";

test("the management page loads with no console errors and no request outside the extension (INV-01)", async ({
  context,
  extensionId,
}) => {
  let escaped = false;
  await context.route("https://example.test/**", (route) => {
    escaped = true;
    return route.fulfill({ status: 200, body: "reached" });
  });
  const requests = watchRequests(context);
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto(`chrome-extension://${extensionId}/app.html`);
  await expect(keepStatus(page)).not.toHaveText(/^確認中/);
  await expect(page.getByRole("heading", { name: "LizyChatTidy", level: 1 })).toBeVisible();

  expect(seen.errors).toEqual([]);
  expect(requests.length).toBeGreaterThan(0);
  expect(outsideExtension(requests)).toEqual([]);

  // connect-src 'none' stops a script-initiated request before the network.
  const outcome = await page.evaluate(() =>
    fetch("https://example.test/").then(
      () => "sent",
      (error: unknown) => (error instanceof Error ? error.name : "unknown"),
    ),
  );
  expect(outcome).toBe("TypeError");
  expect(escaped).toBe(false);
  expect(outsideExtension(requests)).toEqual([]);
});

test("the request watcher sees a request from a second page (negative control for INV-01)", async ({
  context,
}) => {
  await context.route("https://example.test/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<p>control</p>" }),
  );
  const requests = watchRequests(context);
  const other = await context.newPage();
  await other.goto("https://example.test/control");
  // If this were empty, every "no request left the extension" assertion would pass vacuously.
  expect(outsideExtension(requests)).toContain("https://example.test/control");
});

test("import shows the count and renders hostile strings as text (AT09)", async ({
  context,
  extensionId,
}) => {
  const requests = watchRequests(context);
  const page = await openApp(context, extensionId);
  const seen = watch(page);
  await importSyntheticExport(page);

  await expect(page.getByRole("heading", { name: /取得済み 3 件 \/ 全件数不明/ })).toBeVisible();
  const hostileRow = page.getByRole("listbox", { name: "会話一覧" }).getByRole("option").first();
  await expect(hostileRow.locator(".row-title")).toHaveText(HOSTILE_TITLE);
  await hostileRow.click();
  await expect(page.locator(".message-text").first()).toContainText("<script>");

  // Nothing was parsed as HTML or executed.
  expect(await page.locator("img[src='x'], .messages script, .messages b").count()).toBe(0);
  expect(await page.evaluate(() => "__pwned" in window)).toBe(false);
  expect(seen.errors).toEqual([]);
  expect(requests.length).toBeGreaterThan(0);
  expect(outsideExtension(requests)).toEqual([]);
});

test("keyboard: list navigation, Enter opens the preview, Escape returns to the list (AT33)", async ({
  context,
  extensionId,
}) => {
  const page = await openApp(context, extensionId);
  await importSyntheticExport(page);
  const list = page.getByRole("listbox", { name: "会話一覧" });
  await list.focus();

  const active = () => list.getAttribute("aria-activedescendant");
  await page.keyboard.press("Home");
  expect(await active()).toBe(`conversation-${IDS.hostile}`);
  await page.keyboard.press("ArrowDown");
  expect(await active()).toBe(`conversation-${IDS.plain}`);
  await page.keyboard.press("End");
  expect(await active()).toBe(`conversation-${IDS.third}`);
  await page.keyboard.press("ArrowUp");
  expect(await active()).toBe(`conversation-${IDS.plain}`);

  // Enter opens the preview and moves focus to its heading.
  await page.keyboard.press("Enter");
  const heading = page.locator(".preview-title");
  await expect(heading).toBeFocused();
  await expect(heading).toHaveText("Zebra-quartz-title-marker");

  // Escape closes it and returns focus to the listbox.
  await page.keyboard.press("Escape");
  await expect(page.locator(".preview-title")).toHaveCount(0);
  await expect(list).toBeFocused();
  // Enter on the list only ever opens a preview (no destructive action exists here).
  await page.keyboard.press("Enter");
  await expect(page.locator(".preview-title")).toBeFocused();
});
