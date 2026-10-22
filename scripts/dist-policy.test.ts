import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkHtml, checkManifest, checkScripts } from "./dist-policy.mjs";

const shipped = JSON.parse(readFileSync("public/manifest.json", "utf8"));

describe("checkManifest", () => {
  it("passes the shipped manifest", () => {
    expect(checkManifest(shipped)).toEqual([]);
  });

  it.each([
    ["a broad permission", { ...shipped, permissions: ["activeTab", "tabs"] }],
    ["the cookies permission", { ...shipped, permissions: ["cookies"] }],
    ["host permissions", { ...shipped, host_permissions: ["https://chatgpt.com/*"] }],
    ["declared content scripts", { ...shipped, content_scripts: [] }],
    ["web accessible resources", { ...shipped, web_accessible_resources: [] }],
    ["externally connectable", { ...shipped, externally_connectable: {} }],
    [
      "a module service worker",
      { ...shipped, background: { service_worker: "sw.js", type: "module" } },
    ],
    ["manifest v2", { ...shipped, manifest_version: 2 }],
    [
      "a CSP allowing network",
      {
        ...shipped,
        content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'" },
      },
    ],
  ])("flags %s", (_label, manifest) => {
    expect(checkManifest(manifest).length).toBeGreaterThan(0);
  });

  it("flags a non-object manifest", () => {
    expect(checkManifest(null)).toEqual(["manifest is not a JSON object"]);
  });
});

describe("checkHtml", () => {
  it("allows relative bundled references", () => {
    expect(checkHtml("app.html", '<script src="./assets/app.js"></script>')).toEqual([]);
  });

  it.each([
    '<script src="https://cdn.example/x.js"></script>',
    '<link href="//fonts.example/x.css">',
    "<img src='data:image/png;base64,AAAA'>",
  ])("flags %s", (html) => {
    expect(checkHtml("app.html", html)).toHaveLength(1);
  });
});

describe("checkScripts", () => {
  const ok = { "content.js": "chrome.runtime.onMessage.addListener(f);", "sw.js": "x();" };

  it("passes self-contained scripts with one listener in the content script", () => {
    expect(checkScripts(ok)).toEqual([]);
  });

  it.each([
    ["MAIN world in the app bundle", { ...ok, "assets/app.js": 'inject({world:"MAIN"})' }],
    [
      "a listener in the service worker",
      { ...ok, "sw.js": "chrome.runtime.onMessage.addListener(f)" },
    ],
    ["an external listener", { ...ok, "assets/app.js": "chrome.runtime.onMessageExternal" }],
    ["a static import in the content script", { ...ok, "content.js": 'import "./x.js";' }],
    ["a dynamic import in the service worker", { ...ok, "sw.js": 'import("./x.js")' }],
    ["a missing content script", { "sw.js": "x();" }],
  ])("flags %s", (_label, files) => {
    expect(checkScripts(files).length).toBeGreaterThan(0);
  });
});
