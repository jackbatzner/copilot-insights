import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { getExtensionSourcePath } from "../src/link.mjs";

describe("getExtensionSourcePath", () => {
  it("points to the official discovered extension directory", () => {
    const packageRoot = path.resolve("Q:\\repo\\copilot-insights");
    const sourcePath = getExtensionSourcePath(packageRoot);

    assert.equal(
      sourcePath,
      path.join(packageRoot, ".github", "extensions", "copilot-insights")
    );
  });
});
