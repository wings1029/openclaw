import {
  markdownToSlackMrkdwn,
  normalizeSlackOutboundText,
} from "../extensions/slack/src/format.js";

const PASS = "✓";
const FAIL = "✗";
let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ${PASS} ${label}`);
    passed += 1;
  } else {
    console.log(`  ${FAIL} ${label}`);
    failed += 1;
  }
}

console.log("=== Blockquote + inline code → bold (the fix) ===");

assert(
  "> `code` → > *code*",
  markdownToSlackMrkdwn("> `code` in blockquote") === "> *code* in blockquote",
);
assert(
  "> run `deploy` after build → > run *deploy* after build",
  markdownToSlackMrkdwn("> run `deploy` after build") ===
    "> run *deploy* after build",
);

console.log("\n=== Inline code OUTSIDE blockquotes preserved ===");
assert(
  "`code` outside blockquote unchanged",
  markdownToSlackMrkdwn("`code` outside") === "`code` outside",
);

console.log("\n=== Blockquote WITHOUT code unchanged ===");
assert(
  "> plain quote unchanged",
  markdownToSlackMrkdwn("> plain quote") === "> plain quote",
);
assert(
  "> with <angle> brackets still works",
  markdownToSlackMrkdwn("> run basecamp done <todo_id> after deploy") ===
    "> run basecamp done &lt;todo_id&gt; after deploy",
);

console.log("\n=== Multi-line mixed content ===");
const mixed = markdownToSlackMrkdwn(
  "Top `code` here\n\n> `inner code` in quote\n\nBottom `more` text",
);
assert("multiline: blockquote has bold", mixed.includes("> *inner code* in quote"));
assert("multiline: non-blockquote code preserved", mixed.includes("Top `code` here"));

console.log("\n=== normalizeSlackOutboundText ===");
assert(
  "normalize also sanitizes",
  normalizeSlackOutboundText("> `fix` applied") === "> *fix* applied",
);

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
