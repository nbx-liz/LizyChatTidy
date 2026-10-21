#!/usr/bin/env bash
# Regression cases for scripts/verify-handoff.sh: the pristine bundle passes,
# and every tampering below must fail.
set -u
repo="$(cd "$(dirname "$0")/.." && pwd)"
script="$repo/scripts/verify-handoff.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
fail=0

run_case() {
  local name="$1" want="$2" mutate="$3" got
  rm -rf "$work/h" && cp -a "$repo/docs/handoff" "$work/h"
  (cd "$work/h" && eval "$mutate")
  if bash "$script" "$work/h" >/dev/null 2>&1; then got=pass; else got=fail; fi
  if [[ "$got" == "$want" ]]; then
    echo "ok   $name ($got)"
  else
    echo "FAIL $name (want $want, got $got)"
    fail=1
  fi
}

run_case "pristine bundle" pass ":"
run_case "manifest line removed" fail "sed -i '/Handoff.md/d' SHA256SUMS.txt"
run_case "file and manifest edited together" fail "echo x >> README.md && sed -i \"s/^[0-9a-f]\{64\}  README.md\$/\$(sha256sum README.md | cut -c1-64)  README.md/\" SHA256SUMS.txt"
run_case "listed file edited" fail "echo x >> START_HERE.md"
run_case "unlisted file added" fail "touch extra.md"
run_case "subdirectory added" fail "mkdir sub"
run_case "listed file deleted" fail "rm CHANGELOG.md"
run_case "manifest emptied" fail ": > SHA256SUMS.txt"
exit "$fail"
