import { it } from "node:test";
import assert from "node:assert/strict";
import { vscodeUsageCapability } from "../src/vscode-sessions.mjs";

it("keeps optional VS Code disabled unless explicitly enabled", () => {
  assert.equal(vscodeUsageCapability().status, "disabled");
  assert.equal(vscodeUsageCapability(false).status, "disabled");
});

it("reports content-only VS Code storage as unsupported without reading it", () => {
  const capability = vscodeUsageCapability(true);
  assert.equal(capability.status, "unavailable");
  assert.match(capability.message, /not read or analyzed/);
  assert.deepEqual(Object.keys(capability).sort(), ["message", "status"]);
});
