import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import git from "isomorphic-git";

import { gitAdd, gitCommit } from "@/git/commit";

describe("git/commit", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-git-"));
    await git.init({ fs, dir: vaultPath, defaultBranch: "main" });
  });

  afterEach(() => {
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  describe("gitAdd + gitCommit", () => {
    it("stages a file and creates a commit whose SHA appears in the log", async () => {
      const filePath = path.join(vaultPath, "note.md");
      fs.writeFileSync(filePath, "hello\n");

      await gitAdd(vaultPath, filePath);
      const sha = await gitCommit(vaultPath, "add 018f0c8e-7c4f-7d3a-8b2e-1234567890ab");

      expect(sha).toMatch(/^[0-9a-f]{40}$/);

      const log = await git.log({ fs, dir: vaultPath });
      expect(log).toHaveLength(1);
      expect(log[0]?.oid).toBe(sha);
      expect(log[0]?.commit.message.trim()).toBe("add 018f0c8e-7c4f-7d3a-8b2e-1234567890ab");
    });

    it("accepts a path already relative to the vault", async () => {
      const filePath = path.join(vaultPath, "nested", "deep.md");
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, "deep\n");

      await gitAdd(vaultPath, path.join("nested", "deep.md"));
      const sha = await gitCommit(vaultPath, "add nested");
      expect(sha).toMatch(/^[0-9a-f]{40}$/);

      const log = await git.log({ fs, dir: vaultPath });
      expect(log).toHaveLength(1);
    });

    it("uses the configured user.name / user.email when set", async () => {
      await git.setConfig({ fs, dir: vaultPath, path: "user.name", value: "Alice" });
      await git.setConfig({ fs, dir: vaultPath, path: "user.email", value: "alice@example.com" });

      const filePath = path.join(vaultPath, "a.md");
      fs.writeFileSync(filePath, "a\n");
      await gitAdd(vaultPath, filePath);
      await gitCommit(vaultPath, "add a");

      const log = await git.log({ fs, dir: vaultPath });
      expect(log[0]?.commit.author.name).toBe("Alice");
      expect(log[0]?.commit.author.email).toBe("alice@example.com");
    });

    it("falls back to dennoh defaults when no user.name / user.email is configured", async () => {
      const filePath = path.join(vaultPath, "b.md");
      fs.writeFileSync(filePath, "b\n");
      await gitAdd(vaultPath, filePath);
      await gitCommit(vaultPath, "add b");

      const log = await git.log({ fs, dir: vaultPath });
      expect(log[0]?.commit.author.name).toBe("dennoh");
      expect(log[0]?.commit.author.email).toBe("dennoh@localhost");
    });

    it("supports the add / update / delete <id> message convention across commits", async () => {
      const id = "018f0c8e-7c4f-7d3a-8b2e-1234567890ab";
      const filePath = path.join(vaultPath, `${id}.md`);

      fs.writeFileSync(filePath, "v1\n");
      await gitAdd(vaultPath, filePath);
      await gitCommit(vaultPath, `add ${id}`);

      fs.writeFileSync(filePath, "v2\n");
      await gitAdd(vaultPath, filePath);
      await gitCommit(vaultPath, `update ${id}`);

      fs.rmSync(filePath);
      await git.remove({ fs, dir: vaultPath, filepath: `${id}.md` });
      await gitCommit(vaultPath, `delete ${id}`);

      const log = await git.log({ fs, dir: vaultPath });
      const messages = log.map((entry) => entry.commit.message.trim());
      expect(messages).toEqual([`delete ${id}`, `update ${id}`, `add ${id}`]);
    });
  });
});
