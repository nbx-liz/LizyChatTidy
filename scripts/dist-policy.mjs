// Checks the shipped extension against the permission and wiring rules of
// BLUEPRINT §4 and P-0004. Pure functions over file contents, so the same
// rules run in unit tests and against the real dist/ in CI. Every check fails
// closed: input it cannot interpret is reported as a violation.
//
// Scope (P-0004 item 9): this is defence in depth against our own build
// drifting out of policy (a dependency or config change). It is not a
// sandbox for adversarial input; runtime protection comes from the CSP and
// from the extension not shipping the corresponding code.

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

// The complete extension-page policy, directive by directive. Any other
// directive, a missing one or a different value is a violation, so widening
// e.g. img-src is caught as well as connect-src.
export const EXPECTED_CSP = Object.freeze({
  "default-src": "'self'",
  "script-src": "'self'",
  "object-src": "'none'",
  "base-uri": "'none'",
  "connect-src": "'none'",
  "frame-src": "'none'",
  "img-src": "'self'",
  "font-src": "'self'",
  "form-action": "'none'",
});

// Built files are classified by extension. Scripts are inspected; markup is
// inspected; anything the checker cannot inspect is a violation.
const SCRIPT_EXTENSIONS = Object.freeze([".js", ".mjs", ".cjs"]);
const INERT_EXTENSIONS = Object.freeze([".css"]);

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
 * required directives must carry exactly the expected value. Fails closed on
 * any character outside printable ASCII, since CSP only separates tokens with
 * ASCII whitespace and a look-alike space would hide a directive.
 */
export function checkCsp(policy) {
  if (typeof policy !== "string") {
    return ["content_security_policy.extension_pages is missing"];
  }
  if (/[^\x20-\x7E]/.test(policy)) {
    return ["CSP contains characters outside printable ASCII"];
  }
  const problems = [];
  const seen = new Map();
  for (const raw of policy.split(";")) {
    const tokens = raw.split(" ").filter((token) => token !== "");
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
  for (const [name, expected] of Object.entries(EXPECTED_CSP)) {
    if (!seen.has(name)) {
      problems.push(`CSP directive missing: ${name}`);
    } else if (seen.get(name) !== expected) {
      problems.push(`CSP directive ${name} must be exactly ${expected}`);
    }
  }
  for (const name of seen.keys()) {
    if (!Object.hasOwn(EXPECTED_CSP, name)) {
      problems.push(`CSP directive not allowed: ${name}`);
    }
  }
  return problems;
}

/**
 * Sorts built files (paths relative to dist/) into what each check reads.
 * `manifest.json` is checked separately; any other file whose type the
 * checker cannot inspect, such as WebAssembly or an unknown extension, is a
 * violation rather than being skipped.
 */
export function classifyFiles(paths) {
  const html = [];
  const scripts = [];
  const problems = [];
  for (const path of paths) {
    const lower = path.toLowerCase();
    if (lower === "manifest.json") {
      continue;
    }
    if (lower.endsWith(".html")) {
      html.push(path);
    } else if (SCRIPT_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      scripts.push(path);
    } else if (!INERT_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      problems.push(`${path}: file type is not inspectable by the dist checker`);
    }
  }
  return { html, scripts, problems };
}

// Substrings that no bundled-only page needs anywhere in its markup.
const FORBIDDEN_HTML_FRAGMENTS = Object.freeze([
  [":", "a scheme or other colon"],
  ["//", "a protocol-relative reference"],
  ["\\", "a backslash"],
  ["&", "a character reference"],
]);

/**
 * HTML pages may only reference resources bundled in the extension. Rather
 * than parse HTML (attribute spellings, separators and URL-list attributes
 * form an open grammar), the check fails closed over the whole document: a
 * page that only references relative, bundled paths contains none of the
 * forbidden fragments, so any occurrence is reported.
 */
export function checkHtml(name, html) {
  // URL parsing drops tab, LF and CR anywhere in a URL, so remove them first:
  // otherwise "/\n/host" would hide a protocol-relative reference.
  const body = html.replace(/^\s*<!doctype html>/i, "").replace(/[\t\n\r]/g, "");
  return FORBIDDEN_HTML_FRAGMENTS.filter(([fragment]) => body.includes(fragment)).map(
    ([, label]) => `${name}: contains ${label}`,
  );
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
    // Fail closed: any `import` token that is not part of a longer identifier,
    // whatever precedes or follows it (spread, comments, strings). A property
    // named `import` is rejected too; these bundles have no reason to use one.
    if (/(?:^|[^\w$])import(?![\w$])/m.test(source)) {
      problems.push(`${name}: must not import modules`);
    }
  }
  return problems;
}
