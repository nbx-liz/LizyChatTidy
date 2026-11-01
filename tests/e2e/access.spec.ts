// Storage access level and the connect gate (P-0004, P-0007 item 1, KINV-8).
// The shipped dist/ cannot report what a content script sees, and a toolbar
// click (activeTab) cannot be automated, so these use a modified COPY of dist/
// from makeHarnessCopy(). The copy adds a test-only content script and the
// `tabs` permission; the shipped extension is never changed.
import {
  expect,
  fakePage,
  keepStatus,
  launchWithExtension,
  makeHarnessCopy,
  openApp,
  test,
} from "./fixtures";

interface Probe {
  hasLocal: boolean;
  set: string;
  get: unknown;
}

async function readProbe(context: import("@playwright/test").BrowserContext): Promise<Probe> {
  await fakePage(context, "https://probe.test/");
  const page = await context.newPage();
  await page.goto("https://probe.test/");
  await expect(page.locator("html")).toHaveAttribute("data-probe", /.+/);
  return JSON.parse((await page.locator("html").getAttribute("data-probe")) ?? "null") as Probe;
}

test("setAccessLevel: a content script can read storage.local before, but not after, the management page restricts it", async () => {
  const copy = await makeHarnessCopy();
  try {
    // Control: no management page was opened, so storage.local is unrestricted and
    // the probe is able to read. Without this the "denied" result below proves nothing.
    const control = await launchWithExtension(copy.path);
    try {
      const open = await readProbe(control.context);
      test.info().annotations.push({ type: "control-probe", description: JSON.stringify(open) });
      expect(open.hasLocal).toBe(true);
      expect(open.set).toBe("ok");
      expect(open.get).toEqual({ probe: 1 });
    } finally {
      await control.close();
    }

    // Restricted: the management page opened first (it restricts the area at startup).
    const restricted = await launchWithExtension(copy.path);
    try {
      const app = await openApp(restricted.context, restricted.extensionId);
      await expect(keepStatus(app)).not.toContainText("利用不可");
      const probe = await readProbe(restricted.context);
      test
        .info()
        .annotations.push({ type: "restricted-probe", description: JSON.stringify(probe) });
      const denied = (value: unknown) =>
        typeof value === "string" && value.startsWith("error:") ? true : value === undefined;
      // Either the API is absent or every call is rejected; nothing may be readable.
      expect(probe.hasLocal ? denied(probe.get) && probe.set !== "ok" : true).toBe(true);
      expect(probe.get).not.toEqual({ probe: 1 });
    } finally {
      await restricted.close();
    }
  } finally {
    await copy.remove();
  }
});

test("connect gate: no target tab", async ({ context, extensionId }) => {
  const page = await openApp(context, extensionId);
  await page.getByRole("button", { name: "対象のタブに接続" }).click();
  await expect(page.getByRole("status").first()).toContainText("対象のタブがありません");
});

test("connect gate: a target tab that does not exist is a failure, not a success", async ({
  context,
  extensionId,
}) => {
  const page = await openApp(context, extensionId, "?target=999999");
  await page.getByRole("button", { name: "対象のタブに接続" }).click();
  await expect(page.getByRole("status").first()).toContainText("tab-unavailable");
});

test("connect gate: an unsupported https page is refused and nothing is injected", async () => {
  const copy = await makeHarnessCopy();
  const launched = await launchWithExtension(copy.path);
  try {
    const { context, extensionId } = launched;
    await fakePage(context, "https://unsupported.test/");
    const target = await context.newPage();
    await target.goto("https://unsupported.test/");

    const probePage = await openApp(context, extensionId);
    const tabId = await probePage.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: "https://unsupported.test/*" });
      return tabs[0]?.id ?? null;
    });
    expect(tabId).not.toBeNull();

    const app = await openApp(context, extensionId, `?target=${tabId}`);
    await app.getByRole("button", { name: "対象のタブに接続" }).click();
    await expect(app.getByRole("status").first()).toContainText(
      "対象のタブは対応ページではありません",
    );
    // No content script answers in that tab: nothing was injected.
    const reachable = await app.evaluate(
      (id) =>
        chrome.tabs.sendMessage(id as number, { probe: true }).then(
          () => "answered",
          (error: unknown) => (error instanceof Error ? error.message : "unknown"),
        ),
      tabId,
    );
    expect(reachable).toMatch(/Receiving end does not exist/);
  } finally {
    await launched.close();
    await copy.remove();
  }
});

test("connect gate: a supported origin without an activeTab grant is not injected", async () => {
  const copy = await makeHarnessCopy();
  const launched = await launchWithExtension(copy.path);
  try {
    const { context, extensionId } = launched;
    await fakePage(context, "https://chatgpt.com/");
    const target = await context.newPage();
    await target.goto("https://chatgpt.com/");
    const probePage = await openApp(context, extensionId);
    const tabId = await probePage.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: "https://chatgpt.com/*" });
      return tabs[0]?.id ?? null;
    });
    expect(tabId).not.toBeNull();

    const app = await openApp(context, extensionId, `?target=${tabId}`);
    await app.getByRole("button", { name: "対象のタブに接続" }).click();
    // The manifest has no host permission; only a toolbar click would grant activeTab.
    await expect(app.getByRole("status").first()).toContainText("inject-failed");
  } finally {
    await launched.close();
    await copy.remove();
  }
});
