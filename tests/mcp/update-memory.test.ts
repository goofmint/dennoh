import { describe, expect, it } from "bun:test";

import { setupMcpHarness, toolPayload, toolText } from "./harness";

describe("mcp/update_memory", () => {
  const h = setupMcpHarness();

  it("re-extracts mentions and returns updated metadata", async () => {
    const saved = toolPayload(await h.call("save_memory", { content: "v1 #old" })) as {
      id: string;
    };

    const updated = toolPayload(
      await h.call("update_memory", { id: saved.id, content: "v2 #new @reader" })
    ) as { id: string; projects: string[]; tags: string[] };
    expect(updated.id).toBe(saved.id);
    expect(updated.projects).toEqual(["new"]);
    expect(updated.tags).toEqual(["reader"]);
  });

  it("returns an isError result for an unknown id", async () => {
    const res = await h.call("update_memory", { id: "no-such-id", content: "x" });
    expect(res.isError).toBe(true);
    expect(toolText(res)).toMatch(/not found or already deleted/);
  });

  it("returns an isError result for empty content (schema validation)", async () => {
    const saved = toolPayload(await h.call("save_memory", { content: "keep" })) as { id: string };
    const res = await h.call("update_memory", { id: saved.id, content: "" });
    expect(res.isError).toBe(true);
  });
});
