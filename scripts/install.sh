#!/usr/bin/env bash

set -euo pipefail

repo="jackbatzner/copilot-insights"
version_arg=""
force_install="false"
dry_run="false"

while (($#)); do
  case "$1" in
    --force)
      force_install="true"
      ;;
    --dry-run)
      dry_run="true"
      ;;
    *)
      if [[ -n "$version_arg" ]]; then
        echo "Unexpected argument: $1" >&2
        exit 1
      fi
      version_arg="$1"
      ;;
  esac
  shift
done

requested_version="${version_arg:-${COPILOT_INSIGHTS_VERSION:-}}"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required." >&2
  exit 1
fi

temp_root="$(mktemp -d "${TMPDIR:-/tmp}/copilot-insights-install.XXXXXX")"
trap 'rm -rf "$temp_root"' EXIT

headers=(
  -H "Accept: application/vnd.github+json"
  -H "User-Agent: copilot-insights-installer"
)

if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  headers+=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
fi

normalize_tag() {
  local raw="$1"
  if [[ -z "$raw" || "$raw" == v* ]]; then
    printf '%s\n' "$raw"
    return
  fi
  printf 'v%s\n' "$raw"
}

release_endpoint="https://api.github.com/repos/${repo}/releases/latest"
if [[ -n "$requested_version" ]]; then
  release_endpoint="https://api.github.com/repos/${repo}/releases/tags/$(normalize_tag "$requested_version")"
fi

release_json_path="$temp_root/release.json"
curl -fsSL "${headers[@]}" "$release_endpoint" -o "$release_json_path"

mapfile -t release_info < <(
  node - "$release_json_path" <<'NODE'
const fs = require("fs");

const release = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const tag = release.tag_name;

if (!tag) {
  console.error("Could not resolve a release tag from GitHub.");
  process.exit(1);
}

const version = tag.replace(/^v/, "");
const packageName = `copilot-insights-${version}.tgz`;
const assets = Array.isArray(release.assets) ? release.assets : [];
const packageAsset = assets.find((asset) => asset.name === packageName);
const checksumsAsset = assets.find((asset) => asset.name === "checksums.txt");

if (!packageAsset) {
  console.error(`Release asset '${packageName}' was not found for ${tag}.`);
  process.exit(1);
}

if (!checksumsAsset) {
  console.error(`Release asset 'checksums.txt' was not found for ${tag}.`);
  process.exit(1);
}

console.log(tag);
console.log(version);
console.log(packageName);
console.log(packageAsset.browser_download_url);
console.log(checksumsAsset.browser_download_url);
NODE
)

release_tag="${release_info[0]}"
release_version="${release_info[1]}"
package_name="${release_info[2]}"
package_url="${release_info[3]}"
checksums_url="${release_info[4]}"

echo "Resolved release: ${release_tag}"

global_root="$(npm root -g)"
global_prefix="$(npm prefix -g)"
installed_package_json="${global_root}/copilot-insights/package.json"

if [[ -f "$installed_package_json" ]]; then
  installed_version="$(
    node -e 'const fs=require("fs"); const pkg=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(pkg.version);' \
      "$installed_package_json"
  )"
else
  installed_version=""
fi

if [[ -n "$installed_version" && "$installed_version" == "$release_version" && "$force_install" != "true" ]]; then
  echo "Copilot Insights ${installed_version} is already installed."
  echo "Use --force to reinstall the same version."
  exit 0
fi

package_path="${temp_root}/${package_name}"
checksums_path="${temp_root}/checksums.txt"

curl -fsSL "${headers[@]}" "$package_url" -o "$package_path"
curl -fsSL "${headers[@]}" "$checksums_url" -o "$checksums_path"

expected_checksum="$(
  node - "$checksums_path" "$package_name" <<'NODE'
const fs = require("fs");

const lines = fs.readFileSync(process.argv[2], "utf8").split(/\r?\n/);
const packageName = process.argv[3];

for (const line of lines) {
  const match = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
  if (match && match[2] === packageName) {
    process.stdout.write(match[1].toLowerCase());
    process.exit(0);
  }
}

console.error(`Could not find a checksum for '${packageName}' in checksums.txt.`);
process.exit(1);
NODE
)"

if command -v sha256sum >/dev/null 2>&1; then
  actual_checksum="$(sha256sum "$package_path" | awk '{print tolower($1)}')"
elif command -v shasum >/dev/null 2>&1; then
  actual_checksum="$(shasum -a 256 "$package_path" | awk '{print tolower($1)}')"
else
  echo "sha256sum or shasum is required to verify the release checksum." >&2
  exit 1
fi

if [[ "$expected_checksum" != "$actual_checksum" ]]; then
  echo "Checksum verification failed for ${package_name}." >&2
  exit 1
fi

echo "Checksum verified for ${package_name}."

if [[ "$dry_run" == "true" ]]; then
  echo "Dry run only. Skipping global install."
  exit 0
fi

npm uninstall -g copilot-insights >/dev/null 2>&1 || true
rm -rf "${global_root}/copilot-insights" || true
for leftover in "${global_root}"/.copilot-insights-*; do
  [[ -e "$leftover" ]] || continue
  rm -rf "$leftover" || true
done
rm -f \
  "${global_prefix}/copilot-insights" \
  "${global_prefix}/copilot-insights.cmd" \
  "${global_prefix}/copilot-insights.ps1" || true

npm install -g "$package_path"

echo "Installed Copilot Insights ${release_version}."
