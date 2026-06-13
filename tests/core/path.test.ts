import { describe, expect, it } from "bun:test";
import * as path from "node:path";

import { buildNoteDir, buildNotePath, isNotePath, parseIdFromPath } from "@/core/path";

const ID = "018f0c8e-7c4f-7d3a-8b2e-1234567890ab";

describe("path", () => {
  describe("buildNoteDir", () => {
    it("builds <vault>/YYYY/MM/DD for a regular date", () => {
      const dir = buildNoteDir("/vault", new Date(2026, 5, 13));
      expect(dir).toBe(path.join("/vault", "2026", "06", "13"));
    });

    it("zero-pads single-digit months and days", () => {
      const dir = buildNoteDir("/vault", new Date(2026, 0, 5));
      expect(dir).toBe(path.join("/vault", "2026", "01", "05"));
    });

    it("uses local time at the start of the day", () => {
      const dir = buildNoteDir("/vault", new Date(2026, 5, 13, 0, 0, 0));
      expect(dir).toBe(path.join("/vault", "2026", "06", "13"));
    });

    it("uses local time at the last second of the day", () => {
      const dir = buildNoteDir("/vault", new Date(2026, 5, 13, 23, 59, 59));
      expect(dir).toBe(path.join("/vault", "2026", "06", "13"));
    });

    it("handles year boundary", () => {
      expect(buildNoteDir("/v", new Date(2026, 11, 31))).toBe(path.join("/v", "2026", "12", "31"));
      expect(buildNoteDir("/v", new Date(2027, 0, 1))).toBe(path.join("/v", "2027", "01", "01"));
    });

    it("handles month boundary", () => {
      expect(buildNoteDir("/v", new Date(2026, 0, 31))).toBe(path.join("/v", "2026", "01", "31"));
      expect(buildNoteDir("/v", new Date(2026, 1, 1))).toBe(path.join("/v", "2026", "02", "01"));
    });

    it("handles leap day", () => {
      expect(buildNoteDir("/v", new Date(2024, 1, 29))).toBe(path.join("/v", "2024", "02", "29"));
    });

    it("preserves the trailing vault path segment", () => {
      const dir = buildNoteDir("/Users/x/My Notes", new Date(2026, 5, 13));
      expect(dir).toBe(path.join("/Users/x/My Notes", "2026", "06", "13"));
    });
  });

  describe("buildNotePath", () => {
    it("appends <id>.md inside the date dir", () => {
      const p = buildNotePath("/vault", ID, new Date(2026, 5, 13));
      expect(p).toBe(path.join("/vault", "2026", "06", "13", `${ID}.md`));
    });

    it("does not modify the id casing", () => {
      const upper = ID.toUpperCase();
      const p = buildNotePath("/vault", upper, new Date(2026, 5, 13));
      expect(p.endsWith(`${upper}.md`)).toBe(true);
    });
  });

  describe("isNotePath", () => {
    it("returns true for .md files", () => {
      expect(isNotePath("foo.md")).toBe(true);
      expect(isNotePath("/abs/foo.md")).toBe(true);
      expect(isNotePath("rel/dir/foo.md")).toBe(true);
    });

    it("returns true for uppercase extension (case-insensitive)", () => {
      expect(isNotePath("foo.MD")).toBe(true);
    });

    it("returns false for non-.md extensions", () => {
      expect(isNotePath("foo.txt")).toBe(false);
      expect(isNotePath("foo.markdown")).toBe(false);
      expect(isNotePath("foo.mdx")).toBe(false);
    });

    it("returns false for files without extension", () => {
      expect(isNotePath("foo")).toBe(false);
      expect(isNotePath("/a/b/foo")).toBe(false);
    });

    it("returns false for hidden dotfiles with no real extension", () => {
      expect(isNotePath(".gitignore")).toBe(false);
    });
  });

  describe("parseIdFromPath", () => {
    it("extracts the UUID from a vault-shaped path", () => {
      const p = path.join("/vault", "2026", "06", "13", `${ID}.md`);
      expect(parseIdFromPath(p)).toBe(ID);
    });

    it("extracts the basename for any .md file", () => {
      expect(parseIdFromPath("foo.md")).toBe("foo");
      expect(parseIdFromPath("/a/b/foo-bar.md")).toBe("foo-bar");
    });

    it("returns null for non-.md paths", () => {
      expect(parseIdFromPath("foo.txt")).toBeNull();
      expect(parseIdFromPath("foo")).toBeNull();
    });

    it("returns null for empty basename", () => {
      expect(parseIdFromPath(".md")).toBeNull();
    });

    it("round-trips with buildNotePath", () => {
      const built = buildNotePath("/vault", ID, new Date(2026, 5, 13));
      expect(parseIdFromPath(built)).toBe(ID);
    });
  });
});
