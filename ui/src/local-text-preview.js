export function firstTextLine(messages) {
  const message = ["user", "assistant"].map((role) =>
    messages?.find((value) => value.role === role && typeof value.text === "string" && value.text.trim()))
    .find(Boolean);
  if (!message) return null;
  const line = message.text.split(/\r\n|\r|\n/).find((value) => value.trim()).trim();
  const characters = Array.from(line);
  return { role: message.role, text: characters.slice(0, 160).join("") + (characters.length > 160 ? "..." : "") };
}
