import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import git from "isomorphic-git";

import pkg from "../../package.json" with { type: "json" };

// True end-to-end: spawn the real `dennoh serve` process and talk to it over
// actual stdio pipes. This exercises the initialize handshake, proves stdout
// carries only JSON-RPC (a noisy stdout would break the client's parser, so a
// successful handshake is itself the assertion), and confirms logs land on
// stderr. It then runs a multi-tool scenario end to end.
const MAIN = path.resolve(import.meta.dir, "../../src/cli/main.ts");

function firstText(res: CallToolResult): string {
  const block = res.content[0];
  if (block?.type !== "text") {
    throw new Error(`expected text content, got ${block?.type}`);
  }
  return block.text;
}

// Recursively collect .md note files under the vault (skipping dot-dirs).
function findMarkdown(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findMarkdown(full));
    } else if (entry.name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

describe("mcp/stdio integration", () => {
  let homeDir: string;
  let vaultPath: string;
  let client: Client;
  let transport: StdioClientTransport;
  let stderr = "";

  beforeEach(async () => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-int-home-"));
    vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-int-vault-"));

    // Write the config exactly where the spawned process will look for it:
    // os.homedir()/Library/Application Support/dennoh/config.json. The child's
    // os.homedir() resolves from the HOME we pass below.
    const configDir = path.join(homeDir, "Library", "Application Support", "dennoh");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({ vaultPath, lang: "ja", maxFileSizeBytes: 1_048_576 })
    );

    await git.init({ fs, dir: vaultPath, defaultBranch: "main" });
    await git.setConfig({ fs, dir: vaultPath, path: "user.name", value: "Test" });
    await git.setConfig({ fs, dir: vaultPath, path: "user.email", value: "test@example.com" });

    // Inherit the full environment (PATH, etc.), then point HOME at our temp
    // home and disable the translation model download for the child.
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === "string") env[k] = v;
    }
    env.HOME = homeDir;
    env.DENNOH_TRANSLATE_DISABLE = "1";

    transport = new StdioClientTransport({
      command: "bun",
      args: ["run", MAIN, "serve"],
      env,
      stderr: "pipe",
    });
    stderr = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    client = new Client({ name: "integration-client", version: "0.0.0" });
    // A successful connect IS the initialize-handshake assertion: it round-trips
    // an initialize request/response over the real stdio pipes.
    await client.connect(transport);
  });

  afterEach(async () => {
    await client.close();
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  it("completes the initialize handshake and reports the dennoh identity", () => {
    expect(client.getServerVersion()).toEqual({ name: "dennoh", version: pkg.version });
  });

  it("runs a multi-tool scenario over stdio and writes a markdown file", async () => {
    // save_memory -> a real .md file appears in the vault.
    const saved = JSON.parse(
      firstText(
        (await client.callTool({
          name: "save_memory",
          arguments: { content: "integration body #demo" },
        })) as CallToolResult
      )
    ) as { id: string };
    expect(saved.id).toMatch(/[0-9a-f-]{36}/);

    const files = findMarkdown(vaultPath);
    expect(files).toHaveLength(1);
    expect(fs.readFileSync(files[0] as string, "utf-8")).toContain("integration body #demo");

    // get_note -> reads the same note back.
    const got = JSON.parse(
      firstText(
        (await client.callTool({
          name: "get_note",
          arguments: { id: saved.id },
        })) as CallToolResult
      )
    ) as { note: { id: string } | null };
    expect(got.note?.id).toBe(saved.id);

    // status -> reflects the one indexed note.
    const status = JSON.parse(
      firstText((await client.callTool({ name: "status" })) as CallToolResult)
    ) as { indexedCount: number };
    expect(status.indexedCount).toBe(1);
  });

  it("writes diagnostics to stderr (stdout stays JSON-RPC only)", async () => {
    // Make at least one round-trip so the child has fully started and logged.
    await client.callTool({ name: "status" });
    expect(stderr).toContain("mcp: serving over stdio");
  });
});
