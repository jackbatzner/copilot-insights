import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const installer = readFileSync(new URL("../scripts/install.sh", import.meta.url), "utf8");
const bash = process.platform === "win32" ? "bash" : "/bin/bash";
const packageName = "copilot-insights-1.2.3.tgz";
const packageContents = "test release tarball\n";
const checksum = createHash("sha256").update(packageContents).digest("hex");
const release = {
  tag_name: "v1.2.3",
  assets: [
    { name: packageName, browser_download_url: "https://example.test/package" },
    { name: "checksums.txt", browser_download_url: "https://example.test/checksums" },
  ],
};

const mocks = `
enable -n mapfile readarray 2>/dev/null || true
curl() {
  local url="" output=""
  while (($#)); do
    case "$1" in
      -o) output="$2"; shift ;;
      https://*) url="$1" ;;
    esac
    shift
  done
  printf 'Download: %s\\n' "$url" >&2
  case "$url" in
    https://api.github.com/*)
      if [[ "$MOCK_DOWNLOAD_FAIL" == "true" ]]; then
        echo "Mock release download failed." >&2
        return 22
      fi
      printf '%s' "$MOCK_RELEASE" > "$output" ;;
    https://example.test/package) printf '%s' "$MOCK_PACKAGE" > "$output" ;;
    https://example.test/checksums) printf '%s' "$MOCK_CHECKSUMS" > "$output" ;;
    *) echo "Unexpected download: $url" >&2; return 1 ;;
  esac
}
npm() {
  printf 'npm call: %s\\n' "$*" >&2
  case "$*" in
    "root -g") printf '%s\\n' "$temp_root/global" ;;
    "prefix -g") printf '%s\\n' "$temp_root/prefix" ;;
    *) echo "Unexpected npm invocation." >&2; return 1 ;;
  esac
}
`;

function runInstaller({ releaseJson = JSON.stringify(release), checksumText = `${checksum}  ${packageName}\n`, downloadFail = false, args = [] } = {}) {
  return spawnSync(bash, ["--noprofile", "--norc", "-s", "--", "--dry-run", ...args], {
    input: `${mocks}\n${installer}`,
    encoding: "utf8",
    timeout: 15_000,
    env: {
      ...process.env,
      BASH_ENV: "",
      GITHUB_TOKEN: "",
      COPILOT_INSIGHTS_VERSION: "",
      MOCK_RELEASE: releaseJson,
      MOCK_PACKAGE: packageContents,
      MOCK_CHECKSUMS: checksumText,
      MOCK_DOWNLOAD_FAIL: String(downloadFail),
    },
  });
}

describe("piped Bash installer", () => {
  it("resolves and verifies a release without mapfile or readarray", () => {
    const result = runInstaller();

    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Resolved release: v1\.2\.3/);
    assert.match(result.stdout, /Checksum verified for copilot-insights-1\.2\.3\.tgz/);
    assert.match(result.stdout, /Dry run only\. Skipping global install/);
    assert.match(result.stderr, /releases\/latest/);
    assert.doesNotMatch(result.stderr, /npm call: (?:install|uninstall)/);
  });

  it("normalizes an explicitly requested release tag", () => {
    const result = runInstaller({ args: ["1.2.3"] });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /releases\/tags\/v1\.2\.3/);
  });

  for (const [name, releaseJson, error] of [
    ["invalid JSON", "{", /SyntaxError/],
    ["a missing tag", "{}", /Could not resolve a release tag/],
    ["a missing package", JSON.stringify({ ...release, assets: [] }), /Release asset 'copilot-insights-1\.2\.3\.tgz' was not found/],
    ["missing checksums", JSON.stringify({ ...release, assets: [release.assets[0]] }), /Release asset 'checksums\.txt' was not found/],
  ]) {
    it(`stops immediately on ${name}`, () => {
      const result = runInstaller({ releaseJson });

      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, error);
      assert.doesNotMatch(result.stdout, /Resolved release|Checksum verified|Dry run only/);
      assert.doesNotMatch(result.stderr, /ENOENT|unbound variable|npm call:|Download: https:\/\/example\.test/);
    });
  }

  it("stops when the release download fails", () => {
    const result = runInstaller({ downloadFail: true });

    assert.equal(result.status, 22, result.stderr);
    assert.match(result.stderr, /Mock release download failed/);
    assert.doesNotMatch(result.stderr, /ENOENT|npm call:/);
    assert.doesNotMatch(result.stdout, /Resolved release/);
  });

  it("rejects a mismatched package checksum", () => {
    const result = runInstaller({ checksumText: `${"0".repeat(64)}  ${packageName}\n` });

    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Checksum verification failed/);
    assert.doesNotMatch(result.stdout, /Checksum verified|Dry run only/);
    assert.doesNotMatch(result.stderr, /npm call: (?:install|uninstall)/);
  });
});
