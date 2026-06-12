// Slack tests cover format plugin behavior.
import { describe, expect, it } from "vitest";
import {
  markdownToSlackMrkdwn,
  markdownToSlackMrkdwnChunks,
  normalizeSlackOutboundText,
} from "./format.js";
import { escapeSlackMrkdwn } from "./monitor/mrkdwn.js";

describe("markdownToSlackMrkdwn", () => {
  it("handles core markdown formatting conversions", () => {
    const cases = [
      ["converts bold from double asterisks to single", "**bold text**", "*bold text*"],
      ["preserves italic underscore format", "_italic text_", "_italic text_"],
      [
        "converts strikethrough from double tilde to single",
        "~~strikethrough~~",
        "~strikethrough~",
      ],
      [
        "renders basic inline formatting together",
        "hi _there_ **boss** `code`",
        "hi _there_ *boss* `code`",
      ],
      ["renders inline code", "use `npm install`", "use `npm install`"],
      ["renders fenced code blocks", "```js\nconst x = 1;\n```", "```\nconst x = 1;\n```"],
      [
        "renders links with Slack mrkdwn syntax",
        "see [docs](https://example.com)",
        "see <https://example.com|docs>",
      ],
      ["does not duplicate bare URLs", "see https://example.com", "see https://example.com"],
      ["escapes unsafe characters", "a & b < c > d", "a &amp; b &lt; c &gt; d"],
      [
        "preserves Slack angle-bracket markup (mentions/links)",
        "hi <@U123> see <https://example.com|docs> and <!here>",
        "hi <@U123> see <https://example.com|docs> and <!here>",
      ],
      ["escapes raw HTML", "<b>nope</b>", "&lt;b&gt;nope&lt;/b&gt;"],
      ["renders paragraphs with blank lines", "first\n\nsecond", "first\n\nsecond"],
      ["renders bullet lists", "- one\n- two", "• one\n• two"],
      ["renders ordered lists with numbering", "2. two\n3. three", "2. two\n3. three"],
      ["renders headings as bold text", "# Title", "*Title*"],
      ["renders blockquotes", "> Quote", "> Quote"],
      // Regression #92239: Slack mrkdwn renders empty when blockquote contains inline code
      [
        "replaces backtick code with bold inside blockquote lines",
        "> `code` in blockquote",
        "> *code* in blockquote",
      ],
      [
        "preserves inline code outside blockquotes",
        "`code` without blockquote",
        "`code` without blockquote",
      ],
      [
        "handles blockquote with inline code mid-sentence",
        "> run `deploy` after build",
        "> run *deploy* after build",
      ],
      [
        "handles multiple code spans in one blockquote line",
        "> before `one` middle `two` after",
        "> before *one* middle *two* after",
      ],
    ] as const;
    for (const [name, input, expected] of cases) {
      expect(markdownToSlackMrkdwn(input), name).toBe(expected);
    }
  });

  it("handles nested list items", () => {
    const res = markdownToSlackMrkdwn("- item\n  - nested");
    // markdown-it correctly parses this as a nested list
    expect(res).toBe("• item\n  • nested");
  });

  it("handles complex message with multiple elements", () => {
    const res = markdownToSlackMrkdwn(
      "**Important:** Check the _docs_ at [link](https://example.com)\n\n- first\n- second",
    );
    expect(res).toBe(
      "*Important:* Check the _docs_ at <https://example.com|link>\n\n• first\n• second",
    );
  });

  it("returns empty text when input is undefined at runtime", () => {
    expect(markdownToSlackMrkdwn(undefined as unknown as string)).toBe("");
  });

  it("re-chunks on rendered length and still prefers word boundaries", () => {
    const chunks = markdownToSlackMrkdwnChunks("alpha <<", 8);

    expect(chunks).toEqual(["alpha ", "&lt;&lt;"]);
    expect(
      chunks
        .map((chunk, index) => ({ index, length: chunk.length }))
        .filter((chunk) => chunk.length > 8),
    ).toStrictEqual([]);
  });
});

describe("escapeSlackMrkdwn", () => {
  it("returns plain text unchanged", () => {
    expect(escapeSlackMrkdwn("heartbeat status ok")).toBe("heartbeat status ok");
  });

  it("escapes slack and mrkdwn control characters", () => {
    expect(escapeSlackMrkdwn("mode_*`~<&>\\")).toBe("mode\\_\\*\\`\\~&lt;&amp;&gt;\\\\");
  });
});

describe("normalizeSlackOutboundText", () => {
  it("normalizes markdown for outbound send/update paths", () => {
    expect(normalizeSlackOutboundText(" **bold** ")).toBe("*bold*");
  });

  it("sanitizes blockquote inline code to avoid Slack empty-message bug (#92239)", () => {
    expect(normalizeSlackOutboundText("> `code` in blockquote")).toBe(
      "> *code* in blockquote",
    );
  });

  it("preserves inline code outside blockquotes", () => {
    expect(normalizeSlackOutboundText("use `code` here")).toBe("use `code` here");
  });
});

describe("sanitizeSlackBlockquoteCode (via markdownToSlackMrkdwn)", () => {
  it("replaces inline code with bold in blockquote lines", () => {
    expect(markdownToSlackMrkdwn("> `code` here")).toBe("> *code* here");
  });

  it("keeps inline code outside blockquotes unchanged", () => {
    expect(markdownToSlackMrkdwn("`code` outside")).toBe("`code` outside");
  });

  it("handles blockquote lines without code unchanged", () => {
    expect(markdownToSlackMrkdwn("> plain quote")).toBe("> plain quote");
  });

  it("handles multi-line text with mixed blockquote and non-blockquote code", () => {
    const result = markdownToSlackMrkdwn(
      "Top `code` here\n\n> `inner code` in quote\n\nBottom `more` text",
    );
    expect(result).toContain("> *inner code* in quote");
    expect(result).toContain("Top `code` here");
    expect(result).toContain("Bottom `more` text");
  });
});
