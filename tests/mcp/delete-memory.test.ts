import { describe, expect, it } from "bun:test";

import { setupMcpHarness, toolPayload, toolText } from "./harness";

describe("mcp/delete_memory", () => {
  const h = setupMcpHarness();

  it("deletes a note so get_note then returns null", async () => {
    const saved = toolPayload(await h.call("save_memory", { content: "to delete" })) as {
      id: string;
    };

    const del = toolPayload(await h.call("delete_memory", { id: saved.id })) as {
      id: string;
      deleted: boolean;
    };
    expect(del).toEqual({ id: saved.id, deleted: true });

    const after = toolPayload(await h.call("get_note", { id: saved.id })) as { note: null };
    expect(after.note).toBeNull();
  });

  it("returns an isError result for an unknown id", async () => {
    const res = await h.call("delete_memory", { id: "no-such-id" });
    expect(res.isError).toBe(true);
    expect(toolText(res)).toMatch(/not found or already deleted/);
  });

  it("returns an isError result on a double delete", async () => {
    const saved = toolPayload(await h.call("save_memory", { content: "once" })) as { id: string };
    await h.call("delete_memory", { id: saved.id });
    const res = await h.call("delete_memory", { id: saved.id });
    expect(res.isError).toBe(true);
  });
});
