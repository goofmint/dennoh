import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { readNote, writeFileAtomic, writeNote } from "@/core/file";
import { buildNotePath } from "@/core/path";
import type { NoteFrontmatter } from "@/core/types";
import { generateId } from "@/core/uuid";

const SAMPLE_FM: NoteFrontmatter = {
  createdAt: "2026-06-12T10:30:00+09:00",
  updatedAt: "2026-06-12T10:35:00+09:00",
  source: "note",
  title: "Hello",
  projects: ["denno"],
  tags: ["mcp"],
};

describe("file", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-file-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("writeFileAtomic", () => {
    it("writes content to the target path", async () => {
      const target = path.join(tempDir, "file.txt");
      await writeFileAtomic(target, "hello");
      expect(fs.readFileSync(target, "utf-8")).toBe("hello");
    });

    it("creates parent directories recursively when missing", async () => {
      const target = path.join(tempDir, "a", "b", "c", "deep.txt");
      await writeFileAtomic(target, "deep");
      expect(fs.readFileSync(target, "utf-8")).toBe("deep");
    });

    it("leaves no .tmp.* temp files in the directory after completion", async () => {
      const target = path.join(tempDir, "file.txt");
      await writeFileAtomic(target, "x");
      const entries = fs.readdirSync(tempDir);
      expect(entries.filter((e) => e.startsWith(".tmp."))).toEqual([]);
    });

    it("overwrites an existing file", async () => {
      const target = path.join(tempDir, "file.txt");
      fs.writeFileSync(target, "old");
      await writeFileAtomic(target, "new");
      expect(fs.readFileSync(target, "utf-8")).toBe("new");
    });

    it("supports parallel writes to distinct paths without temp-name collisions", async () => {
      const targets = Array.from({ length: 20 }, (_, i) => path.join(tempDir, `n${i}.txt`));
      await Promise.all(targets.map((p, i) => writeFileAtomic(p, `body-${i}`)));
      for (const [i, file] of targets.entries()) {
        expect(fs.readFileSync(file, "utf-8")).toBe(`body-${i}`);
      }
    });
  });

  describe("writeNote + readNote round-trip", () => {
    it("writes a note and reads it back with id, frontmatter, body intact", async () => {
      const id = generateId();
      const date = new Date(2026, 5, 13);
      const body = "Note body line 1.\nNote body line 2.\n";
      const filePath = await writeNote(tempDir, id, date, SAMPLE_FM, body);

      expect(filePath).toBe(buildNotePath(tempDir, id, date));
      expect(fs.existsSync(filePath)).toBe(true);

      const read = await readNote(filePath);
      expect(read.id).toBe(id);
      expect(read.frontmatter).toEqual(SAMPLE_FM);
      expect(read.body).toBe(body);
    });

    it("creates the date subdirectories during writeNote", async () => {
      const id = generateId();
      const date = new Date(2026, 0, 5);
      const filePath = await writeNote(tempDir, id, date, SAMPLE_FM, "x");
      expect(filePath).toBe(path.join(tempDir, "2026", "01", "05", `${id}.md`));
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  describe("readNote errors", () => {
    it("throws on a non-.md path", async () => {
      const txt = path.join(tempDir, "foo.txt");
      fs.writeFileSync(txt, "not a note");
      await expect(readNote(txt)).rejects.toThrow(/Not a note path/);
    });

    it("throws when the basename is not a valid UUID v7", async () => {
      const target = path.join(tempDir, "not-a-uuid.md");
      fs.writeFileSync(target, "irrelevant");
      await expect(readNote(target)).rejects.toThrow(/UUID v7/);
    });

    it("throws on a missing file (with a UUID-v7 name)", async () => {
      const missing = path.join(tempDir, `${generateId()}.md`);
      await expect(readNote(missing)).rejects.toThrow(/Failed to read note/);
    });

    it("propagates parseFrontmatter errors for malformed content (UUID-v7 name)", async () => {
      const target = path.join(tempDir, `${generateId()}.md`);
      fs.writeFileSync(target, "no frontmatter here\n");
      await expect(readNote(target)).rejects.toThrow();
    });
  });

  describe("writeNote id validation", () => {
    it("throws when id is not a valid UUID v7", async () => {
      await expect(writeNote(tempDir, "not-a-uuid", new Date(), SAMPLE_FM, "x")).rejects.toThrow(
        /UUID v7/
      );
    });

    it("throws when id is a UUID v4 (wrong version nibble)", async () => {
      const v4 = "018f0c8e-7c4f-4d3a-8b2e-1234567890ab";
      await expect(writeNote(tempDir, v4, new Date(), SAMPLE_FM, "x")).rejects.toThrow(/UUID v7/);
    });
  });
});
