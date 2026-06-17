// Runtime unit tests for the Telegram bridge's pure helpers.
// Run: node --experimental-strip-types scripts/test-telegram-format.ts
import { splitForTelegram, parseCommand, isChatAllowed, formatToolLine } from "../src/lib/assistant/telegram-format.ts";

let passed = 0;
let failed = 0;
function eq(actual: unknown, expected: unknown, name: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}\n      expected ${e}\n      got      ${a}`); }
}
function ok(cond: boolean, name: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}`); }
}

console.log("splitForTelegram");
eq(splitForTelegram(""), [], "empty -> []");
eq(splitForTelegram("hello"), ["hello"], "short -> single chunk");
{
  const big = "a".repeat(5000);
  const chunks = splitForTelegram(big, 4096);
  ok(chunks.length === 2, "5000 chars -> 2 chunks");
  ok(chunks.every((c) => c.length <= 4096), "all chunks <= 4096");
  ok(chunks.join("").length === 5000, "no data lost on hard cut");
}
{
  // Prefer breaking on a newline near the limit.
  const text = "x".repeat(4000) + "\n" + "y".repeat(200);
  const chunks = splitForTelegram(text, 4096);
  ok(chunks.length === 2, "newline break -> 2 chunks");
  ok(chunks[0] === "x".repeat(4000), "first chunk ends before the newline");
  ok(chunks[1] === "y".repeat(200), "second chunk is the tail (newline stripped)");
}

console.log("parseCommand");
eq(parseCommand("/new"), { command: "new", args: "" }, "/new");
eq(parseCommand("/new my project"), { command: "new", args: "my project" }, "/new + args");
eq(parseCommand("/Stop"), { command: "stop", args: "" }, "case-insensitive");
eq(parseCommand("/help@CodeMaestroBot"), { command: "help", args: "" }, "strips @botname");
eq(parseCommand("  /status  "), { command: "status", args: "" }, "trims whitespace");
eq(parseCommand("just text"), { command: "", args: "just text" }, "plain text -> no command");
eq(parseCommand("fix the bug in /src/foo"), { command: "", args: "fix the bug in /src/foo" }, "mid-text slash is not a command");

console.log("isChatAllowed");
ok(isChatAllowed(42, [42, 7]) === true, "allowed id");
ok(isChatAllowed(99, [42, 7]) === false, "disallowed id");
ok(isChatAllowed(42, []) === false, "empty allowlist allows nobody");

console.log("formatToolLine");
ok(formatToolLine("Read", { file_path: "/a/b.ts" }).includes("Read"), "tool name shown");
ok(formatToolLine("Read", { file_path: "/a/b.ts" }).includes("/a/b.ts"), "file path shown");
ok(formatToolLine("Bash", { command: "ls -la" }).includes("ls -la"), "bash command shown");
ok(formatToolLine(undefined, undefined) === "🔧 tool", "fallback label");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
