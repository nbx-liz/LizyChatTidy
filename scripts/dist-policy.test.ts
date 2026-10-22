import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkCsp, checkHtml, checkManifest, checkScripts, classifyFiles } from "./dist-policy.mjs";

const shipped = JSON.parse(readFileSync("public/manifest.json", "utf8"));
const shippedCsp: string = shipped.content_security_policy.extension_pages;

describe("checkManifest", () => {
  it("passes the shipped manifest", () => {
    expect(checkManifest(shipped)).toEqual([]);
  });

  it.each([
    ["a broad permission", { ...shipped, permissions: ["activeTab", "tabs"] }],
    ["the cookies permission", { ...shipped, permissions: ["cookies"] }],
    ["storage before DEV08", { ...shipped, permissions: ["activeTab", "scripting", "storage"] }],
    ["host permissions", { ...shipped, host_permissions: ["https://chatgpt.com/*"] }],
    ["declared content scripts", { ...shipped, content_scripts: [] }],
    ["web accessible resources", { ...shipped, web_accessible_resources: [] }],
    ["externally connectable", { ...shipped, externally_connectable: {} }],
    [
      "a module service worker",
      { ...shipped, background: { service_worker: "sw.js", type: "module" } },
    ],
    ["manifest v2", { ...shipped, manifest_version: 2 }],
    ["a missing CSP", { ...shipped, content_security_policy: {} }],
  ])("flags %s", (_label, manifest) => {
    expect(checkManifest(manifest).length).toBeGreaterThan(0);
  });

  it("flags a non-object manifest", () => {
    expect(checkManifest(null)).toEqual(["manifest is not a JSON object"]);
  });
});

describe("checkCsp", () => {
  it("passes the shipped policy", () => {
    expect(checkCsp(shippedCsp)).toEqual([]);
  });

  it.each([
    ["an earlier permissive connect-src", `connect-src https:; ${shippedCsp}`],
    ["a repeated directive with the same value", `${shippedCsp}; connect-src 'none'`],
    [
      "a widened connect-src",
      shippedCsp.replace("connect-src 'none'", "connect-src 'none' https:"),
    ],
    ["a remote script source", shippedCsp.replace("script-src 'self'", "script-src 'self' https:")],
    ["a missing frame-src", shippedCsp.replace("frame-src 'none';", "")],
    ["a missing default-src", shippedCsp.replace("default-src 'self';", "")],
    [
      "a no-break space hiding directives",
      shippedCsp
        .replace("default-src 'self'", "default-src 'self'")
        .replace("connect-src 'none'", "connect-src 'none'"),
    ],
    ["a tab separator", shippedCsp.replace("connect-src 'none'", "connect-src\t'none'")],
    ["a widened img-src", shippedCsp.replace("img-src 'self'", "img-src 'self' https:")],
    ["a widened font-src", shippedCsp.replace("font-src 'self'", "font-src 'self' data:")],
    ["a missing base-uri", shippedCsp.replace("base-uri 'none';", "")],
    ["an extra style-src", `${shippedCsp}; style-src 'self' https:`],
    ["an extra media-src", `${shippedCsp}; media-src https:`],
  ])("flags %s", (_label, policy) => {
    expect(checkCsp(policy).length).toBeGreaterThan(0);
  });

  it("flags a non-string policy", () => {
    expect(checkCsp(undefined)).toEqual(["content_security_policy.extension_pages is missing"]);
  });
});

describe("checkHtml", () => {
  it.each([
    '<script type="module" crossorigin src="./assets/app.js"></script>',
    "<link rel=stylesheet href=assets/app.css>",
    '<img srcset="./a.png 1x, ./b.png 2x">',
  ])("allows bundled references: %s", (html) => {
    expect(checkHtml("app.html", html)).toEqual([]);
  });

  it.each([
    ["an absolute URL", '<script src="https://cdn.example/x.js"></script>'],
    ["an unquoted absolute URL", "<script src=https://evil.example/x.js></script>"],
    ["a protocol-relative URL", '<link href="//fonts.example/x.css">'],
    ["a backslash host", '<link href="\\\\evil.example/x.css">'],
    ["a data URL", "<img src='data:image/png;base64,AAAA'>"],
    ["a character reference", '<img src="&#104;ttps://evil.example/x">'],
    ["an external srcset candidate", '<img srcset="./a.png 1x, https://evil.example/b.png 2x">'],
    ["an uppercase attribute", '<SCRIPT SRC="https://evil.example/x.js"></SCRIPT>'],
    ["a legacy background attribute", '<body background="https://evil.example/i.png">'],
    [
      "a preload imagesrcset",
      '<link rel="preload" as="image" imagesrcset="https://evil.example/i.png 1x">',
    ],
    ["an attribute after a slash", "<img/src=https://evil.example/image.png>"],
    [
      "a protocol-relative URL split by LF",
      '<img src="/\n/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/x.png">',
    ],
    ["a protocol-relative URL split by CR and tab", '<img src="/\r\t/evil.example/x.png">'],
    ["a reference after a quoted >", '<img alt=">" src=https://evil.example/i.png>'],
    ["a CSS url in a style attribute", '<div style="background:url(//evil.example/i.png)">'],
  ])("flags %s", (_label, html) => {
    expect(checkHtml("app.html", html).length).toBeGreaterThan(0);
  });

  it("passes the shape of the generated page", () => {
    const page = [
      "<!doctype html>",
      '<html lang="ja"><head><meta charset="utf-8" />',
      '<meta name="viewport" content="width=device-width, initial-scale=1" />',
      "<title>LizyChatTidy</title>",
      '<script type="module" crossorigin src="./assets/app-DyBPr7AH.js"></script>',
      '</head><body><div id="root"></div></body></html>',
    ].join("\n");
    expect(checkHtml("app.html", page)).toEqual([]);
  });
});

describe("classifyFiles", () => {
  it("sorts the current build output with no problems", () => {
    const result = classifyFiles([
      "manifest.json",
      "app.html",
      "assets/app-DyBPr7AH.js",
      "content.js",
      "sw.js",
    ]);
    expect(result).toEqual({
      html: ["app.html"],
      scripts: ["assets/app-DyBPr7AH.js", "content.js", "sw.js"],
      problems: [],
    });
  });

  it("inspects .mjs and .cjs bundles as scripts", () => {
    expect(classifyFiles(["assets/app-1.mjs", "assets/x.CJS"]).scripts).toEqual([
      "assets/app-1.mjs",
      "assets/x.CJS",
    ]);
  });

  it("accepts stylesheets without inspection", () => {
    expect(classifyFiles(["assets/app.css"]).problems).toEqual([]);
  });

  it.each([
    "assets/app.wasm",
    "assets/logo.svg",
    "assets/data.json",
    "assets/LICENSE",
    "assets/app.js.map",
  ])("flags a file it cannot inspect: %s", (path) => {
    expect(classifyFiles([path]).problems).toHaveLength(1);
  });
});

describe("checkScripts", () => {
  const ok = { "content.js": "chrome.runtime.onMessage.addListener(f);", "sw.js": "x();" };

  it("passes self-contained scripts with one listener in the content script", () => {
    expect(checkScripts(ok)).toEqual([]);
  });

  it("does not mistake longer identifiers for imports", () => {
    const source = "const importantValue = 1; reimport(); $import(); import_x();";
    expect(checkScripts({ ...ok, "sw.js": source })).toEqual([]);
  });

  it.each([
    ["MAIN world in the app bundle", { ...ok, "assets/app.js": 'inject({world:"MAIN"})' }],
    [
      "a listener in the service worker",
      { ...ok, "sw.js": "chrome.runtime.onMessage.addListener(f)" },
    ],
    ["an external listener", { ...ok, "assets/app.js": "chrome.runtime.onMessageExternal" }],
    ["a static import in the content script", { ...ok, "content.js": 'import "./x.js";' }],
    ["a static import after a statement", { ...ok, "sw.js": 'start();import "./dependency.js";' }],
    ["a named import mid-line", { ...ok, "sw.js": 'x(); import { a } from "./a.js";' }],
    ["a dynamic import in the service worker", { ...ok, "sw.js": 'import("./x.js")' }],
    ["import.meta", { ...ok, "content.js": "const u = import.meta.url;" }],
    [
      "a static import followed by a comment",
      { ...ok, "sw.js": 'start();import/* comment */"./dependency.js";' },
    ],
    [
      "a dynamic import followed by a comment",
      { ...ok, "sw.js": 'const p = import/* comment */("./dependency.js");' },
    ],
    ["an import followed by a line comment", { ...ok, "content.js": 'import// c\n"./x.js";' }],
    [
      "a dynamic import inside an object spread",
      { ...ok, "sw.js": 'const p={...import("./x.js")};' },
    ],
    ["a property named import", { ...ok, "sw.js": "obj.import(x);" }],
    ["a missing content script", { "sw.js": "x();" }],
  ])("flags %s", (_label, files) => {
    expect(checkScripts(files).length).toBeGreaterThan(0);
  });
});
