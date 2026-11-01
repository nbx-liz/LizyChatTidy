// KEEP store in a real Chromium (P-0007, AT28, AT29, AT32) and its multi-tab behaviour.

import { STORAGE_KEY } from "../../src/keep/envelope";
import {
  createKeepStore,
  expect,
  keepPanel,
  keepStatus,
  openApp,
  PASSPHRASE,
  readStorage,
  test,
  unlockKeepStore,
} from "./fixtures";
import { decryptKeepEnvelope } from "./keepDecrypt";
import { IDS, importSyntheticExport, SECRET_TEXT_MARKER, SECRET_TITLE_MARKER } from "./synthetic";

test("KEEP store: create, lock on reload, wrong then right passphrase", async ({
  context,
  extensionId,
}) => {
  const page = await openApp(context, extensionId);
  await expect(keepStatus(page)).toContainText("未作成");

  await createKeepStore(page);
  await expect(keepStatus(page)).toContainText("解除済み");

  await page.reload();
  await expect(keepStatus(page)).toContainText("ロック中");

  await unlockKeepStore(page, "this is the wrong passphrase");
  await expect(keepStatus(page)).toContainText("ロック中");
  await expect(keepPanel(page).getByRole("alert")).toHaveText(
    "パスフレーズが違うか、保存データが壊れています。",
  );

  await unlockKeepStore(page, PASSPHRASE);
  await expect(keepStatus(page)).toContainText("解除済み");
});

test("KEEP store: nothing goes to storage.sync and no title or text reaches storage.local", async ({
  context,
  extensionId,
}) => {
  const page = await openApp(context, extensionId);
  await createKeepStore(page);
  await importSyntheticExport(page);
  await page.getByRole("option", { name: new RegExp(SECRET_TITLE_MARKER) }).click();
  const keepButton = page.getByRole("button", { name: "KEEP", exact: true });
  await keepButton.click();
  await expect(keepButton).toHaveAttribute("aria-pressed", "true");

  // AT29: the sync area stays empty.
  expect(await readStorage(page, "sync")).toEqual({});

  // AT28: the raw stored value holds no readable title or text...
  const local = await readStorage(page, "local");
  expect(Object.keys(local)).toEqual([STORAGE_KEY]);
  const dump = JSON.stringify(local);
  expect(dump).not.toContain(SECRET_TITLE_MARKER);
  expect(dump).not.toContain(SECRET_TEXT_MARKER);
  expect(dump).not.toContain("Synthetic");

  // ...and, decrypted with the test passphrase, the plaintext is exactly
  // {revision, entries: [{provider, conversationId, scope}]} (KINV-5).
  const decrypted = await decryptKeepEnvelope(local, PASSPHRASE);
  expect(decrypted.plaintext).toEqual({
    revision: decrypted.revision,
    entries: [{ provider: "chatgpt", conversationId: IDS.plain, scope: null }],
  });
  expect(Object.keys(decrypted.plaintext as object).sort()).toEqual(["entries", "revision"]);
  expect(decrypted.plaintextText).not.toContain(SECRET_TITLE_MARKER);
  expect(decrypted.plaintextText).not.toContain(SECRET_TEXT_MARKER);
});

test("KEEP marking: toggles aria-pressed, shows the badge and the count", async ({
  context,
  extensionId,
}) => {
  const page = await openApp(context, extensionId);
  await createKeepStore(page);
  await importSyntheticExport(page);
  await expect(page.getByRole("status").filter({ hasText: "KEEP 0 件" })).toBeVisible();

  const row = page.getByRole("option", { name: new RegExp(SECRET_TITLE_MARKER) });
  await row.click();
  const keepButton = page.getByRole("button", { name: "KEEP", exact: true });
  await expect(keepButton).toHaveAttribute("aria-pressed", "false");
  await keepButton.click();
  await expect(keepButton).toHaveAttribute("aria-pressed", "true");
  await expect(row.locator(".keep-badge")).toHaveText("KEEP");
  await expect(page.getByRole("status").filter({ hasText: "KEEP 1 件" })).toBeVisible();

  await keepButton.click();
  await expect(keepButton).toHaveAttribute("aria-pressed", "false");
  await expect(row.locator(".keep-badge")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "KEEP 0 件" })).toBeVisible();
});

test("multi-tab: a change in one management tab makes the other unavailable", async ({
  context,
  extensionId,
}) => {
  const first = await openApp(context, extensionId);
  const second = await openApp(context, extensionId);
  await expect(keepStatus(second)).toContainText("未作成");

  await createKeepStore(first);
  await expect(keepStatus(second)).toContainText("利用不可");
  await expect(keepStatus(second)).toContainText(
    "別のタブ（または別の操作）が保存データを変更しました。",
  );
  // The other tab itself keeps working.
  await expect(keepStatus(first)).toContainText("解除済み");
});

test("deleting the KEEP store needs a deliberate confirmation (AT32, AT33)", async ({
  context,
  extensionId,
}) => {
  const page = await openApp(context, extensionId);
  await createKeepStore(page);
  const stored = async () => Object.keys(await readStorage(page, "local")).length;
  expect(await stored()).toBeGreaterThan(0);

  const panel = keepPanel(page);
  await panel.getByRole("button", { name: "保存データを削除…" }).click();
  // Initial focus is the cancel side, not the destructive button.
  await expect(panel.getByRole("button", { name: "やめる" })).toBeFocused();

  // Repeated Enter on the destructive button without the check does nothing.
  const destructive = panel.getByRole("button", { name: "削除する" });
  await destructive.focus();
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Enter");
  }
  await expect(keepStatus(page)).toContainText("解除済み");
  expect(await stored()).toBeGreaterThan(0);

  // Repeated Enter on the initial focus cancels the dialog and deletes nothing.
  await panel.getByRole("button", { name: "やめる" }).focus();
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Enter");
  }
  await expect(keepStatus(page)).toContainText("解除済み");
  expect(await stored()).toBeGreaterThan(0);

  // A deliberate confirmation deletes the key (AT32).
  await panel.getByRole("button", { name: "保存データを削除…" }).click();
  await panel.getByLabel("KEEP の内容が失われることを理解しました").check();
  await panel.getByRole("button", { name: "削除する" }).click();
  await expect(keepStatus(page)).toContainText("未作成");
  expect(await stored()).toBe(0);
});
