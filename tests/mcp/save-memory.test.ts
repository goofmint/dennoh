import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";

import { setupMcpHarness, toolPayload } from "./harness";

describe("mcp/save_memory", () => {
  const h = setupMcpHarness();

  it("saves a note, extracts mentions, and writes the file", async () => {
    const res = await h.call("save_memory", { content: "hello world #proj @tag" });
    expect(res.isError).toBeFalsy();

    const meta = toolPayload(res) as {
      id: string;
      path: string;
      projects: string[];
      tags: string[];
    };
    expect(meta.id).toMatch(/[0-9a-f-]{36}/);
    expect(meta.projects).toEqual(["proj"]);
    expect(meta.tags).toEqual(["tag"]);
    expect(meta.path.startsWith(h.vaultPath())).toBe(true);
    expect(fs.existsSync(meta.path)).toBe(true);
  });

  it("defaults source to note", async () => {
    const meta = toolPayload(await h.call("save_memory", { content: "no source given" })) as {
      source: string;
    };
    expect(meta.source).toBe("note");
  });

  it("returns an isError result for empty content (schema validation)", async () => {
    const res = await h.call("save_memory", { content: "" });
    expect(res.isError).toBe(true);
  });

  it("returns an isError result for content containing a NULL byte", async () => {
    // A NUL byte trips core validateContent, surfaced as a tool-level error.
    const content = ["good", "bad"].join(String.fromCharCode(0));
    const res = await h.call("save_memory", { content });
    expect(res.isError).toBe(true);
  });
});
