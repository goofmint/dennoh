import { describe, expect, it } from "bun:test";
import * as path from "node:path";

import { shouldIgnorePath } from "@/watch/ignore";

describe("watch/ignore", () => {
  describe("shouldIgnorePath", () => {
    it("ignores .DS_Store at any depth", () => {
      expect(shouldIgnorePath(".DS_Store")).toBe(true);
      expect(shouldIgnorePath(path.join("2026", "06", ".DS_Store"))).toBe(true);
    });

    it("ignores anything under .git/", () => {
      expect(shouldIgnorePath(".git")).toBe(true);
      expect(shouldIgnorePath(path.join(".git", "HEAD"))).toBe(true);
      expect(shouldIgnorePath(path.join(".git", "objects", "ab", "cdef"))).toBe(true);
    });

    it("ignores anything under .obsidian/", () => {
      expect(shouldIgnorePath(".obsidian")).toBe(true);
      expect(shouldIgnorePath(path.join(".obsidian", "workspace.json"))).toBe(true);
    });

    it("ignores anything under .dennoh/", () => {
      expect(shouldIgnorePath(".dennoh")).toBe(true);
      expect(shouldIgnorePath(path.join(".dennoh", "index.db"))).toBe(true);
    });

    it("ignores any other dot-prefixed segment (anywhere in the chain)", () => {
      expect(shouldIgnorePath(".hidden.md")).toBe(true);
      expect(shouldIgnorePath(path.join(".cache", "foo.md"))).toBe(true);
      expect(shouldIgnorePath(path.join("2026", ".scratch", "note.md"))).toBe(true);
    });

    it("ignores atomic-write tempfiles produced by writeFileAtomic", () => {
      // writeFileAtomic writes to `.tmp.<uuid>` in the same dir as the target.
      expect(
        shouldIgnorePath(path.join("2026", "06", "13", ".tmp.018f0c8e-7c4f-7d3a-8b2e-1234567890ab"))
      ).toBe(true);
    });

    it("does NOT ignore normal note paths", () => {
      expect(
        shouldIgnorePath(path.join("2026", "06", "13", "018f0c8e-7c4f-7d3a-8b2e-1234567890ab.md"))
      ).toBe(false);
    });

    it("does NOT ignore a non-dot directory whose name merely contains a dot", () => {
      expect(shouldIgnorePath(path.join("notes.v2", "foo.md"))).toBe(false);
      expect(shouldIgnorePath("foo.md")).toBe(false);
    });

    it("handles backslash separators (defensive against Windows-style inputs)", () => {
      expect(shouldIgnorePath(".git\\HEAD")).toBe(true);
      expect(shouldIgnorePath("2026\\06\\13\\.DS_Store")).toBe(true);
    });

    it("returns false for the empty string", () => {
      expect(shouldIgnorePath("")).toBe(false);
    });

    it("normalizes leading separators", () => {
      // Defensive: a watcher implementation that joins with a leading slash
      // produces e.g. "/2026/06/13/foo.md". The first split segment is empty
      // and must not be treated as hidden.
      expect(shouldIgnorePath("/2026/06/13/foo.md")).toBe(false);
      expect(shouldIgnorePath("/.git/HEAD")).toBe(true);
    });

    it("ignores cloud-sync conflict copies (basename at any depth)", () => {
      expect(shouldIgnorePath("note.conflict.md")).toBe(true);
      expect(shouldIgnorePath(path.join("2026", "06", "13", "note (conflicted copy).md"))).toBe(
        true
      );
      expect(shouldIgnorePath(path.join("2026", "メモ (競合コピー).md"))).toBe(true);
    });

    it("does NOT ignore a normal note that merely sits beside a conflict copy", () => {
      expect(shouldIgnorePath(path.join("2026", "06", "13", "note.md"))).toBe(false);
      // Parenthesized but not a conflict tag.
      expect(shouldIgnorePath(path.join("2026", "note (draft).md"))).toBe(false);
    });
  });
});
