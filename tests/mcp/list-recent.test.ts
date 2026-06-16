import { describe, expect, it } from "bun:test";

import { setupMcpHarness, toolPayload } from "./harness";

describe("mcp/list_recent", () => {
  const h = setupMcpHarness();

  it("returns the saved notes as metadata", async () => {
    const a = toolPayload(await h.call("save_memory", { content: "first" })) as { id: string };
    const b = toolPayload(await h.call("save_memory", { content: "second" })) as { id: string };

    const out = toolPayload(await h.call("list_recent", { limit: 10 })) as {
      notes: { id: string }[];
    };
    expect(out.notes.map((n) => n.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("works with no arguments (default limit)", async () => {
    await h.call("save_memory", { content: "only one" });
    const out = toolPayload(await h.call("list_recent")) as { notes: { id: string }[] };
    expect(out.notes).toHaveLength(1);
  });

  it("returns an isError result for a non-positive limit (schema validation)", async () => {
    const res = await h.call("list_recent", { limit: 0 });
    expect(res.isError).toBe(true);
  });
});
