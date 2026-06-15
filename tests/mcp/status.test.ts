import { describe, expect, it } from "bun:test";

import { setupMcpHarness, toolPayload } from "./harness";

describe("mcp/status", () => {
  const h = setupMcpHarness();

  it("reports zero indexed notes for a fresh vault", async () => {
    const status = toolPayload(await h.call("status")) as {
      indexedCount: number;
      latestError: string | null;
    };
    expect(status.indexedCount).toBe(0);
    expect(status.latestError).toBeNull();
  });

  it("reports the live indexed count and omits queueDepth without a watcher", async () => {
    await h.call("save_memory", { content: "one" });
    await h.call("save_memory", { content: "two" });

    const status = toolPayload(await h.call("status")) as Record<string, unknown>;
    expect(status.indexedCount).toBe(2);
    expect(status.latestError).toBeNull();
    expect("queueDepth" in status).toBe(false);
  });
});
