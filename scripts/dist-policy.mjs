// Checks the shipped extension against the permission and wiring rules of
// BLUEPRINT §4 and P-0004. Pure functions over file contents, so the same
// rules run in unit tests and against the real dist/ in CI.

export const ALLOWED_PERMISSIONS = Object.freeze(["activeTab", "scripting", "storage"]);

export const FORBIDDEN_MANIFEST_KEYS = Object.freeze([
  "host_permissions",
  "optional_host_permissions",
  "optional_permissions",
  "content_scripts",
  "web_accessible_resources",
  "externally_connectable",
]);

export const REQUIRED_CSP_DIRECTIVES = Object.freeze([
  "script-src 'self'",
  "object-src 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
]);

/** Returns a list of violations; an empty list means the manifest passes. */
export function checkManifest(manifest) {
  const problems = [];
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    return ["manifest is not a JSON object"];
  }
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
  const csp = manifest.content_security_policy?.extension_pages;
  if (typeof csp !== "string") {
    problems.push("content_security_policy.extension_pages is missing");
  } else {
    const directives = csp.split(";").map((d) => d.trim().replace(/\s+/g, " "));
    for (const required of REQUIRED_CSP_DIRECTIVES) {
      if (!directives.includes(required)) {
        problems.push(`CSP directive missing: ${required}`);
      }
    }
  }
  return problems;
}

/** HTML pages may only reference bundled, relative resources. */
export function checkHtml(name, html) {
  const problems = [];
  const refs = html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/gi);
  for (const [, ref] of refs) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref)) {
      problems.push(`${name}: external reference ${ref}`);
    }
  }
  return problems;
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
    if (/^\s*import[\s{*"']/m.test(source) || /\bimport\s*\(/.test(source)) {
      problems.push(`${name}: must not import modules`);
    }
  }
  return problems;
}
