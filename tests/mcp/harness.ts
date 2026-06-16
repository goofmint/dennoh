import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, spyOn } from "bun:test";
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

// First text content block of a tool result, narrowed to its string.
export function toolText(res: CallToolResult): string {
  const block = res.content[0];
  if (block?.type !== "text") {
    throw new Error(`expected text content, got ${block?.type}`);
  }
  return block.text;
}

// Parse the JSON payload a successful tool encodes in its text block.
export function toolPayload(res: CallToolResult): unknown {
  return JSON.parse(toolText(res));
}

export type McpHarness = {
  call: (name: string, args?: Record<string, unknown>) => Promise<CallToolResult>;
  vaultPath: () => string;
};

// Registers beforeEach/afterEach that stand up a real, isolated vault (git +
// SQLite under a temp dir) and a linked in-memory client/server pair, mirroring
// the temp-dir isolation in core/memory.test.ts. Call once inside a describe.
export function setupMcpHarness(): McpHarness {
  let homeDir: string;
  let vaultPath: string;
  let db: Database;
  let client: Client;
  let serving: Promise<void>;
  let homedirSpy: ReturnType<typeof spyOn<typeof os, "homedir">>;
  let originalTranslateDisable: string | undefined;

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

  return {
    call: (name, args = {}) =>
      client.callTool({ name, arguments: args }) as Promise<CallToolResult>,
    vaultPath: () => vaultPath,
  };
}
