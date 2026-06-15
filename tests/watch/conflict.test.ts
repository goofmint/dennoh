import { describe, expect, it } from "bun:test";

import { isConflictFile } from "@/watch/conflict";

describe("watch/conflict", () => {
  describe("isConflictFile", () => {
    it("matches the generic <name>.conflict.md pattern", () => {
      expect(isConflictFile("note.conflict.md")).toBe(true);
      expect(isConflictFile("2026-budget.conflict.md")).toBe(true);
      // Case-insensitive on the tag.
      expect(isConflictFile("note.CONFLICT.md")).toBe(true);
    });

    it("matches Dropbox English 'conflicted copy' names", () => {
      expect(isConflictFile("note (Alice's conflicted copy 2024-01-02).md")).toBe(true);
      expect(isConflictFile("note (conflicted copy).md")).toBe(true);
    });

    it("matches Dropbox 'conflicto' localized names", () => {
      expect(isConflictFile("nota (conflicto).md")).toBe(true);
      expect(isConflictFile("nota (copia en conflicto 2024-01-02).md")).toBe(true);
    });

    it("matches Dropbox Japanese '競合コピー' names", () => {
      expect(isConflictFile("メモ (Alice の競合コピー 2024-01-02).md")).toBe(true);
      expect(isConflictFile("メモ (競合コピー).md")).toBe(true);
    });

    it("does not match a normal note", () => {
      expect(isConflictFile("note.md")).toBe(false);
      expect(isConflictFile("018f0c8e-7c4f-7d3a-8b2e-1234567890ab.md")).toBe(false);
    });

    it("does not match a note literally named conflict.md (no leading dot)", () => {
      // `.conflict.md` requires a separator dot before `conflict`; a note that
      // is simply called "conflict" is a legitimate file, not a copy.
      expect(isConflictFile("conflict.md")).toBe(false);
    });

    it("does not match parenthesized names that are not conflict tags", () => {
      expect(isConflictFile("note (draft).md")).toBe(false);
      expect(isConflictFile("meeting (2024-01-02).md")).toBe(false);
    });

    it("requires the conflict tag to be parenthesized", () => {
      // A bare phrase without the surrounding parens is a normal title.
      expect(isConflictFile("conflicted copy notes.md")).toBe(false);
    });

    it("returns false for the empty string", () => {
      expect(isConflictFile("")).toBe(false);
    });
  });
});
