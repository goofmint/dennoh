import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import git from "isomorphic-git";

import { gitAdd, gitCommit } from "@/git/commit";
import { gitLog } from "@/git/log";

describe("git/log", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-git-"));
    await git.init({ fs, dir: vaultPath, defaultBranch: "main" });
    await git.setConfig({ fs, dir: vaultPath, path: "user.name", value: "Test" });
    await git.setConfig({ fs, dir: vaultPath, path: "user.email", value: "test@example.com" });
  });

  afterEach(() => {
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  // Stage + commit a single file in one step so each test reads as a sequence
  // of revisions rather than add/commit boilerplate.
  async function commitFile(relPath: string, contents: string, message: string): Promise<string> {
    const filePath = path.join(vaultPath, relPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
    await gitAdd(vaultPath, filePath);
    return await gitCommit(vaultPath, message);
  }

  it("returns history for a file newest-first", async () => {
    const sha1 = await commitFile("note.md", "v1\n", "add note");
    const sha2 = await commitFile("note.md", "v2\n", "update note");

    const log = await gitLog(vaultPath, path.join(vaultPath, "note.md"));

    expect(log).toHaveLength(2);
    expect(log[0]?.sha).toBe(sha2);
    expect(log[1]?.sha).toBe(sha1);
    expect(log.map((c) => c.message)).toEqual(["update note", "add note"]);
    expect(log[0]?.author).toBe("Test");
    expect(log[0]?.timestamp).toBeInstanceOf(Date);
  });

  it("excludes commits that did not touch the target file", async () => {
    const sha1 = await commitFile("note.md", "v1\n", "add note");
    // A commit to an unrelated file must not appear in note.md's history.
    await commitFile("other.md", "other\n", "add other");
    const sha3 = await commitFile("note.md", "v2\n", "update note");

    const log = await gitLog(vaultPath, path.join(vaultPath, "note.md"));

    const shas = log.map((c) => c.sha);
    expect(shas).toEqual([sha3, sha1]);
    expect(shas).not.toContain(
      // sanity: the "other.md" commit's message is never present
      log.find((c) => c.message === "add other")?.sha
    );
    expect(log.map((c) => c.message)).toEqual(["update note", "add note"]);
  });

  it("accepts a path already relative to the vault", async () => {
    const sha = await commitFile("nested/deep.md", "deep\n", "add deep");

    const log = await gitLog(vaultPath, path.join("nested", "deep.md"));

    expect(log).toHaveLength(1);
    expect(log[0]?.sha).toBe(sha);
  });
});
