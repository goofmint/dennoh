import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import git from "isomorphic-git";

import { gitAdd, gitCommit } from "@/git/commit";
import { gitShow } from "@/git/show";

describe("git/show", () => {
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

  async function commitFile(relPath: string, contents: string, message: string): Promise<string> {
    const filePath = path.join(vaultPath, relPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
    await gitAdd(vaultPath, filePath);
    return await gitCommit(vaultPath, message);
  }

  it("returns the file contents as of a specific commit", async () => {
    const sha1 = await commitFile("note.md", "v1\n", "add note");
    await commitFile("note.md", "v2\n", "update note");

    // The older commit must still yield the original contents, not HEAD's.
    const atSha1 = await gitShow(vaultPath, path.join(vaultPath, "note.md"), sha1);
    expect(atSha1).toBe("v1\n");
  });

  it("decodes UTF-8 (multibyte) contents correctly", async () => {
    const sha = await commitFile("ja.md", "電脳メモ\n", "add ja");

    const contents = await gitShow(vaultPath, path.join(vaultPath, "ja.md"), sha);
    expect(contents).toBe("電脳メモ\n");
  });

  it("throws for a commit SHA that does not exist", async () => {
    await commitFile("note.md", "v1\n", "add note");
    const missingSha = "0".repeat(40);

    await expect(gitShow(vaultPath, path.join(vaultPath, "note.md"), missingSha)).rejects.toThrow(
      /does not exist/
    );
  });

  it("throws for a path absent from the given commit", async () => {
    const sha = await commitFile("note.md", "v1\n", "add note");

    await expect(gitShow(vaultPath, path.join(vaultPath, "missing.md"), sha)).rejects.toThrow(
      /does not exist in commit/
    );
  });
});
