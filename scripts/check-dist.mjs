// Verifies the built extension in dist/ (P-0004). Exits non-zero on any violation.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { checkHtml, checkManifest, checkScripts } from "./dist-policy.mjs";

const DIST = "dist";

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const problems = [];
const shipped = JSON.parse(readFileSync(join(DIST, "manifest.json"), "utf8"));
const source = JSON.parse(readFileSync(join("public", "manifest.json"), "utf8"));
if (JSON.stringify(shipped) !== JSON.stringify(source)) {
  problems.push("dist/manifest.json differs from public/manifest.json");
}
problems.push(...checkManifest(shipped));

const files = walk(DIST).map((path) => relative(DIST, path).split("\\").join("/"));
if (!files.includes("app.html")) {
  problems.push("app.html: missing");
}
const scripts = {};
for (const file of files) {
  const text = readFileSync(join(DIST, file), "utf8");
  if (file.endsWith(".html")) {
    problems.push(...checkHtml(file, text));
  } else if (file.endsWith(".js")) {
    scripts[file] = text;
  }
}
problems.push(...checkScripts(scripts));

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(`check-dist: ${problem}`);
  }
  process.exit(1);
}
console.info(`check-dist: ok (${files.length} files)`);
