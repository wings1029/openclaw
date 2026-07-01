/**
 * Boundary test: createHttpPokeApi error body is read under a byte cap.
 *
 * Proves that a streaming error response from a Urbit ship is cancelled
 * mid-stream instead of being fully buffered, preventing OOM on a
 * malformed or hostile ship response.
 */
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Replace urbitFetch with a passthrough that calls real fetch against a
// loopback HTTP server.  The SSRF guard is tested separately.
vi.mock("./urbit/fetch.js", () => ({
  urbitFetch: vi.fn(async (params: { baseUrl: string; path: string; init?: RequestInit }) => {
    const url = `${params.baseUrl}${params.path}`;
    const response = await fetch(url, params.init);
    return { response, finalUrl: url, release: async () => {} };
  }),
}));

const { testExports } = await import("./channel.runtime.js");
const { createHttpPokeApi } = testExports;

/** Streaming chunk size. */
const CHUNK_SIZE = 64 * 1024;

/** Total bytes the server will stream before closing. */
const TOTAL_BODY_SIZE = 4 * 1024 * 1024;

describe("createHttpPokeApi error body boundary", () => {
  let server: http.Server;
  let baseUrl: string;
  /** When set, the server returns this status + body for non-login requests. */
  let errorStatus: number;
  let errorBody: string | null;
  let streamLargeBody: boolean;

  beforeEach(async () => {
    vi.restoreAllMocks();
    errorStatus = 500;
    errorBody = null;
    streamLargeBody = false;

    server = http.createServer((req, res) => {
      // The login path must succeed so createHttpPokeApi can proceed to poke.
      if (req.url === "/~/login") {
        res.writeHead(204, { "Set-Cookie": "urbauth-test=abc" });
        res.end();
        return;
      }

      // Poke / channel request — return the configured error response.
      if (streamLargeBody) {
        res.writeHead(errorStatus, { "Content-Type": "text/html" });
        let written = 0;
        const chunk = Buffer.alloc(CHUNK_SIZE, "x");
        function writeChunk() {
          if (written >= TOTAL_BODY_SIZE) {
            res.end();
            return;
          }
          const ok = res.write(chunk);
          written += CHUNK_SIZE;
          if (ok) {
            setImmediate(writeChunk);
          } else {
            res.once("drain", writeChunk);
          }
        }
        writeChunk();
        return;
      }

      if (errorBody !== null) {
        res.writeHead(errorStatus, { "Content-Type": "text/plain" });
        res.end(errorBody);
        return;
      }

      res.writeHead(204);
      res.end();
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const port = (server.address() as { port: number }).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  });

  it("cancels the stream after 16 KiB on a non-ok poke response", async () => {
    streamLargeBody = true;

    const api = await createHttpPokeApi({
      url: baseUrl,
      code: "test-code",
      ship: "~zod",
    });

    const err = await api.poke({ app: "chat", mark: "message", json: {} }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;

    // The error message must be bounded.  If unguarded, the raw
    // response.text() would buffer the full 4 MiB streaming body.
    const messageBytes = Buffer.byteLength(message, "utf8");
    expect(messageBytes).toBeLessThan(32 * 1024);
    expect(messageBytes).toBeGreaterThan(0);
    expect(message).toContain("Poke failed: 500");
  });

  it("returns pokeId on 204 (no error)", async () => {
    // Default server returns 204 for non-login requests — no error.
    const api = await createHttpPokeApi({
      url: baseUrl,
      code: "test-code",
      ship: "~zod",
    });
    const pokeId = await api.poke({ app: "chat", mark: "message", json: {} });
    expect(typeof pokeId).toBe("number");
  });

  it("preserves a small error body fully", async () => {
    errorStatus = 500;
    errorBody = "invalid mark";

    const api = await createHttpPokeApi({
      url: baseUrl,
      code: "test-code",
      ship: "~zod",
    });
    const err = await api.poke({ app: "chat", mark: "message", json: {} }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("invalid mark");
  });
});
