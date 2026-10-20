import assert from "node:assert/strict";
import test from "node:test";
import { firstTextLine } from "../ui/src/local-text-preview.js";

test("turn previews preserve the first nonempty prompt line, not a generated summary", () => {
  assert.deepEqual(firstTextLine([{ role: "user", text: "\n  ## Recorded heading\r\nMore text" }]), { role: "user", text: "## Recorded heading" });
  assert.deepEqual(firstTextLine([{ role: "assistant", text: "Reply" }, { role: "user", text: "Prompt\nSecond line" }]), { role: "user", text: "Prompt" });
  assert.deepEqual(firstTextLine([{ role: "user", text: " \r\n" }, { role: "assistant", text: "\rReply" }]), { role: "assistant", text: "Reply" });
  assert.equal(firstTextLine([]), null);
  assert.equal(firstTextLine(undefined), null);
  assert.equal(firstTextLine([{ role: "agent-prompt", text: "Not a turn" }]), null);
});

test("turn previews bound Unicode characters without interpreting HTML or markdown", () => {
  assert.equal(firstTextLine([{ role: "user", text: "😀".repeat(161) }]).text, "😀".repeat(160) + "...");
  assert.equal(firstTextLine([{ role: "user", text: "<script>literal</script>" }]).text, "<script>literal</script>");
});
