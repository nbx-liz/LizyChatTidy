#!/usr/bin/env bash
# Verify that docs/handoff is the frozen v0.1.1 bundle, byte for byte.
#
# 1. The manifest itself is pinned, so editing SHA256SUMS.txt cannot pass.
# 2. Every manifest entry must match (sha256sum --strict fails on missing
#    files and malformed lines).
# 3. The directory must contain exactly the manifest entries plus the
#    manifest, so added or unlisted files fail.
set -euo pipefail

readonly MANIFEST_SHA256="a70e7ca1e237ce2170d911483a7f18c88c756f35e5f0250f4c47c877c3c53060"
readonly DIR="${1:-docs/handoff}"

cd "$DIR"

echo "${MANIFEST_SHA256}  SHA256SUMS.txt" | sha256sum --strict -c -
sha256sum --strict -c SHA256SUMS.txt

expected="$( { sed -E 's/^[0-9a-f]{64}  //' SHA256SUMS.txt; echo SHA256SUMS.txt; } | LC_ALL=C sort)"
actual="$(find . -mindepth 1 \( -type f -o -type l -o -type d \) -printf '%P\n' | LC_ALL=C sort)"

if [[ "$expected" != "$actual" ]]; then
  echo "handoff bundle file set differs from SHA256SUMS.txt:" >&2
  diff <(echo "$expected") <(echo "$actual") >&2 || true
  exit 1
fi

echo "handoff bundle verified: $(wc -l < SHA256SUMS.txt) files + manifest"
