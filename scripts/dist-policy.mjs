// Checks the shipped extension against the permission and wiring rules of
// BLUEPRINT §4 and P-0004. Pure functions over file contents, so the same
// rules run in unit tests and against the real dist/ in CI. Every check fails
// closed: input it cannot interpret is reported as a violation.

// `storage` is added with DEV08 (P-0004 item 6); until then it is a violation.
export const ALLOWED_PERMISSIONS = Object.freeze(["activeTab", "scripting"]);

export const FORBIDDEN_MANIFEST_KEYS = Object.freeze([
  "host_permissions",
  "optional_host_permissions",
  "optional_permissions",
  "content_scripts",
  "web_accessible_resources",
  "externally_connectable",
]);

// Effective values required for these CSP directives (each must appear once).
export const REQUIRED_CSP = Object.freeze({
  "default-src": "'self'",
  "script-src": "'self'",
  "object-src": "'none'",
  "connect-src": "'none'",
  "frame-src": "'none'",
});

const URL_ATTRIBUTES = new Set([
  "src",
  "href",
  "srcset",
  "action",
  "formaction",
  "poster",
  "data",
  "xlink:href",
]);

const EXTENSION_BASE = "chrome-extension://lizychattidy-check/app.html";

/** Returns a list of violations; an empty list means the manifest passes. */
export function checkManifest(manifest) {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    return ["manifest is not a JSON object"];
  }
  const problems = [];
  if (manifest.manifest_version !== 3) {
    problems.push("manifest_version must be 3");
  }
  const permissions = manifest.permissions;
  if (!Array.isArray(permissions)) {
    problems.push("permissions must be an array");
  } else {
    for (const permission of permissions) {
      if (!ALLOWED_PERMISSIONS.includes(permission)) {
        problems.push(`permission not allowed: ${String(permission)}`);
      }
    }
  }
  for (const key of FORBIDDEN_MANIFEST_KEYS) {
    if (Object.hasOwn(manifest, key)) {
      problems.push(`forbidden manifest key: ${key}`);
    }
  }
  const background = manifest.background;
  if (background?.service_worker !== "sw.js" || Object.hasOwn(background, "type")) {
    problems.push("background must be the classic service worker sw.js");
  }
  problems.push(...checkCsp(manifest.content_security_policy?.extension_pages));
  return problems;
}

/**
 * Parses the policy the way browsers do: a repeated directive is ignored
 * after its first occurrence, so duplicates are rejected outright and the
 * required directives must carry exactly the expected value.
 */
export function checkCsp(policy) {
  if (typeof policy !== "string") {
    return ["content_security_policy.extension_pages is missing"];
  }
  const problems = [];
  const seen = new Map();
  for (const raw of policy.split(";")) {
    const tokens = raw.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) {
      continue;
    }
    const name = tokens[0].toLowerCase();
    if (seen.has(name)) {
      problems.push(`CSP directive repeated: ${name}`);
      continue;
    }
    seen.set(name, tokens.slice(1).join(" "));
  }
  for (const [name, expected] of Object.entries(REQUIRED_CSP)) {
    if (!seen.has(name)) {
      problems.push(`CSP directive missing: ${name}`);
    } else if (seen.get(name) !== expected) {
      problems.push(`CSP directive ${name} must be exactly ${expected}`);
    }
  }
  return problems;
}

/**
 * HTML pages may only reference resources bundled in the extension. Attribute
 * values are read quoted or unquoted; values containing character references
 * are rejected rather than decoded, and every URL is resolved against an
 * extension base so `//host`, backslashes and schemes are all caught.
 */
export function checkHtml(name, html) {
  const problems = [];
  const attributes = html.matchAll(
    /\s([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g,
  );
  for (const match of attributes) {
    const attribute = match[1].toLowerCase();
    if (!URL_ATTRIBUTES.has(attribute)) {
      continue;
    }
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (value.includes("&")) {
      problems.push(`${name}: character reference in ${attribute} is not allowed`);
      continue;
    }
    // Browsers treat a backslash like a slash in standard URLs; do not rely on
    // how the chrome-extension: scheme is classified.
    if (value.includes("\\")) {
      problems.push(`${name}: backslash in ${attribute} is not allowed`);
      continue;
    }
    const candidates =
      attribute === "srcset"
        ? value.split(",").map((part) => part.trim().split(/\s+/)[0])
        : [value];
    for (const candidate of candidates) {
      if (!isBundledReference(candidate ?? "")) {
        problems.push(`${name}: external reference in ${attribute}: ${candidate}`);
      }
    }
  }
  return problems;
}

function isBundledReference(reference) {
  if (!URL.canParse(reference, EXTENSION_BASE)) {
    return false;
  }
  const base = new URL(EXTENSION_BASE);
  const resolved = new URL(reference, EXTENSION_BASE);
  return resolved.protocol === base.protocol && resolved.host === base.host;
}

/**
 * Script rules: no MAIN-world injection anywhere (INV-18); injected and
 * service-worker scripts are self-contained classic scripts; only the content
 * script registers a message listener (P-0004).
 */
export function checkScripts(files) {
  const problems = [];
  for (const [name, source] of Object.entries(files)) {
    if (/["'`]MAIN["'`]/.test(source)) {
      problems.push(`${name}: references the MAIN world`);
    }
    if (name !== "content.js" && /\bonMessage(?:External)?\b/.test(source)) {
      problems.push(`${name}: registers or references a message listener`);
    }
  }
  for (const name of ["content.js", "sw.js"]) {
    const source = files[name];
    if (source === undefined) {
      problems.push(`${name}: missing`);
      continue;
    }
    // Any `import` keyword use outside property access: static imports
    // anywhere in the file, dynamic import() and import.meta.
    if (/(?:^|[^\w$.])import(?:\s|[*{("'`.]|$)/m.test(source)) {
      problems.push(`${name}: must not import modules`);
    }
  }
  return problems;
}
