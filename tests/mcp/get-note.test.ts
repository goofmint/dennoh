import { describe, expect, it } from "bun:test";

import { setupMcpHarness, toolPayload } from "./harness";

describe("mcp/get_note", () => {
  const h = setupMcpHarness();

  it("returns id, frontmatter, and body for a live note", async () => {
    const saved = toolPayload(await h.call("save_memory", { content: "lookup body #proj" })) as {
      id: string;
    };

    const found = toolPayload(await h.call("get_note", { id: saved.id })) as {
      note: { id: string; body: string; frontmatter: { projects: string[] } } | null;
    };
    expect(found.note?.id).toBe(saved.id);
    expect(found.note?.body).toContain("lookup body #proj");
    expect(found.note?.frontmatter.projects).toEqual(["proj"]);
  });

  it("returns { note: null } for an unknown id (not an error)", async () => {
    const res = await h.call("get_note", { id: "no-such-id" });
    expect(res.isError).toBeFalsy();
    expect((toolPayload(res) as { note: null }).note).toBeNull();
  });

  it("returns an isError result for an empty id (schema validation)", async () => {
    const res = await h.call("get_note", { id: "" });
    expect(res.isError).toBe(true);
  });
});
