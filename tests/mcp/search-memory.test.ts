import { describe, expect, it } from "bun:test";

import { setupMcpHarness, toolPayload } from "./harness";

describe("mcp/search_memory", () => {
  const h = setupMcpHarness();

  it("finds an indexed note by a body term", async () => {
    await h.call("save_memory", { content: "searchablekeyword body" });
    const out = toolPayload(await h.call("search_memory", { query: "searchablekeyword" })) as {
      results: { id: string }[];
    };
    expect(out.results).toHaveLength(1);
  });

  it("narrows results with a project filter", async () => {
    await h.call("save_memory", { content: "common term #alpha" });
    await h.call("save_memory", { content: "common term #beta" });

    const out = toolPayload(
      await h.call("search_memory", { query: "common", filters: { project: "alpha" } })
    ) as { results: { projects: string[] }[] };
    expect(out.results).toHaveLength(1);
    expect(out.results[0]?.projects).toEqual(["alpha"]);
  });

  it("returns an isError result for an empty query (schema validation)", async () => {
    const res = await h.call("search_memory", { query: "" });
    expect(res.isError).toBe(true);
  });
});
