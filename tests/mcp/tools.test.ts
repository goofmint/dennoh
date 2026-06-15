import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import git from "isomorphic-git";

import { writeConfig } from "@/config";
import { closeDatabase, openDatabase, runMigrations } from "@/db";
import { createMcpServer, startStdioServer } from "@/mcp";

// End-to-end tool coverage: a real client calls each tool over an in-memory
// transport, against a real vault (git + SQLite). Asserts the core bridge works
// and that failures come back as `isError` results, not protocol throws.
describe("mcp/tools", () => {
  let homeDir: string;
  let vaultPath: string;
  let db: Database;
  let client: Client;
  let serving: Promise<void>;
  let homedirSpy: ReturnType<typeof spyOn<typeof os, "homedir">>;
  let originalTranslateDisable: string | undefined;

  // Extract the JSON payload a tool encodes in its first text content block.
  function payload(res: CallToolResult): unknown {
    const block = res.content[0];
    if (block?.type !== "text") {
      throw new Error(`expected text content, got ${block?.type}`);
    }
    return JSON.parse(block.text);
  }

  function call(name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
    return client.callTool({ name, arguments: args }) as Promise<CallToolResult>;
  }

  beforeEach(async () => {
    originalTranslateDisable = process.env.DENNOH_TRANSLATE_DISABLE;
    process.env.DENNOH_TRANSLATE_DISABLE = "1";

    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-mcp-home-"));
    vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-mcp-vault-"));
    homedirSpy = spyOn(os, "homedir").mockReturnValue(homeDir);
    writeConfig({ vaultPath, lang: "ja", maxFileSizeBytes: 1_048_576 });

    db = openDatabase(vaultPath);
    runMigrations(db);
    await git.init({ fs, dir: vaultPath, defaultBranch: "main" });
    await git.setConfig({ fs, dir: vaultPath, path: "user.name", value: "Test" });
    await git.setConfig({ fs, dir: vaultPath, path: "user.email", value: "test@example.com" });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    serving = startStdioServer(createMcpServer({ db, vaultPath }), serverTransport);
    client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await serving;
    closeDatabase(db);
    homedirSpy.mockRestore();
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(vaultPath, { recursive: true, force: true });
    if (originalTranslateDisable === undefined) {
      Reflect.deleteProperty(process.env, "DENNOH_TRANSLATE_DISABLE");
    } else {
      process.env.DENNOH_TRANSLATE_DISABLE = originalTranslateDisable;
    }
  });

  it("save_memory returns metadata with extracted mentions", async () => {
    const res = await call("save_memory", { content: "first note #proj @tag" });
    expect(res.isError).toBeFalsy();
    const meta = payload(res) as { id: string; projects: string[]; tags: string[]; path: string };
    expect(meta.id).toMatch(/[0-9a-f-]{36}/);
    expect(meta.projects).toEqual(["proj"]);
    expect(meta.tags).toEqual(["tag"]);
    expect(meta.path.startsWith(vaultPath)).toBe(true);
  });

  it("get_note returns the note, and null for an unknown id", async () => {
    const saved = payload(await call("save_memory", { content: "lookup body #p" })) as {
      id: string;
    };

    const found = payload(await call("get_note", { id: saved.id })) as {
      note: { id: string; body: string } | null;
    };
    expect(found.note?.id).toBe(saved.id);
    expect(found.note?.body).toContain("lookup body #p");

    const missing = payload(await call("get_note", { id: "no-such-id" })) as { note: null };
    expect(missing.note).toBeNull();
  });

  it("update_memory re-extracts mentions and bumps the note", async () => {
    const saved = payload(await call("save_memory", { content: "v1 #old" })) as { id: string };

    const updated = payload(
      await call("update_memory", { id: saved.id, content: "v2 #new @reader" })
    ) as { projects: string[]; tags: string[] };
    expect(updated.projects).toEqual(["new"]);
    expect(updated.tags).toEqual(["reader"]);
  });

  it("search_memory finds an indexed note", async () => {
    await call("save_memory", { content: "searchablekeyword body" });
    const out = payload(await call("search_memory", { query: "searchablekeyword" })) as {
      results: { id: string }[];
    };
    expect(out.results).toHaveLength(1);
  });

  it("list_recent returns the saved notes", async () => {
    // Both saves land within the same wall-clock second, so updated_at ties and
    // strict newest-first ordering is non-deterministic here; that ordering is
    // covered in core/memory.test.ts. The tool's job is to surface the notes.
    const a = payload(await call("save_memory", { content: "first" })) as { id: string };
    const b = payload(await call("save_memory", { content: "second" })) as { id: string };

    const out = payload(await call("list_recent", { limit: 10 })) as { notes: { id: string }[] };
    expect(out.notes.map((n) => n.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("delete_memory removes the note so get_note returns null", async () => {
    const saved = payload(await call("save_memory", { content: "to delete" })) as { id: string };

    const del = payload(await call("delete_memory", { id: saved.id })) as {
      id: string;
      deleted: boolean;
    };
    expect(del).toEqual({ id: saved.id, deleted: true });

    const after = payload(await call("get_note", { id: saved.id })) as { note: null };
    expect(after.note).toBeNull();
  });

  it("status reports the indexed count", async () => {
    await call("save_memory", { content: "one" });
    await call("save_memory", { content: "two" });

    const status = payload(await call("status")) as { indexedCount: number; latestError: null };
    expect(status.indexedCount).toBe(2);
    expect(status.latestError).toBeNull();
  });

  it("reports failures as an isError result, not a protocol throw", async () => {
    // Updating an unknown id must come back as a tool-level error result.
    const res = await call("update_memory", { id: "no-such-id", content: "x" });
    expect(res.isError).toBe(true);
    const block = res.content[0];
    if (block?.type !== "text") {
      throw new Error("expected text content");
    }
    expect(block.text).toMatch(/not found or already deleted/);
  });
});
