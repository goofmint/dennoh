import { describe, expect, it } from "bun:test";

import { extractMentions } from "@/core";

describe("extractMentions", () => {
  describe("basic extraction", () => {
    it("extracts Japanese tags with # and @", () => {
      const result = extractMentions("今日は #日記 を書いた @仕事 もあった");
      expect(result.projects).toEqual(["日記"]);
      expect(result.tags).toEqual(["仕事"]);
    });

    it("extracts ASCII project names with hyphen", () => {
      const result = extractMentions("working on #project-name today");
      expect(result.projects).toEqual(["project-name"]);
      expect(result.tags).toEqual([]);
    });

    it("extracts ASCII tags with underscore and digits", () => {
      const result = extractMentions("ping @tag_123 please");
      expect(result.projects).toEqual([]);
      expect(result.tags).toEqual(["tag_123"]);
    });

    it("returns empty arrays for an empty string", () => {
      expect(extractMentions("")).toEqual({ projects: [], tags: [] });
    });

    it("does NOT extract single-character tags (#a, @b)", () => {
      const result = extractMentions("only #a and @b here");
      expect(result.projects).toEqual([]);
      expect(result.tags).toEqual([]);
    });

    it("extracts 2-character tags (#ab, @ab)", () => {
      const result = extractMentions("see #ab and @ab now");
      expect(result.projects).toEqual(["ab"]);
      expect(result.tags).toEqual(["ab"]);
    });

    it("extracts a 200-character tag at the upper boundary", () => {
      const name = "a".repeat(200);
      const result = extractMentions(`prefix #${name} suffix`);
      expect(result.projects).toEqual([name]);
    });

    it("does NOT extract a 201-character tag (over the boundary)", () => {
      const name = "a".repeat(201);
      const result = extractMentions(`prefix #${name} suffix`);
      expect(result.projects).toEqual([]);
    });
  });

  describe("URL fragment exclusion", () => {
    it("does NOT extract a # fragment from an https URL", () => {
      const result = extractMentions("see https://example.com#foo here");
      expect(result.projects).toEqual([]);
    });

    it("does NOT extract a # fragment from an http URL with a path", () => {
      const result = extractMentions("see http://example.com/path#section here");
      expect(result.projects).toEqual([]);
    });

    it("extracts a standalone #tag that follows a URL with a fragment", () => {
      const result = extractMentions("see https://example.com#foo and #realTag");
      expect(result.projects).toEqual(["realTag"]);
    });
  });

  describe("Markdown heading exclusion", () => {
    it("does NOT extract the # of a `# 見出し` heading", () => {
      const result = extractMentions("# 見出し");
      expect(result.projects).toEqual([]);
    });

    it("does NOT extract from `## 見出し2` or `### 見出し3` headings", () => {
      const result = extractMentions("## 見出し2\n### 見出し3");
      expect(result.projects).toEqual([]);
    });

    it("extracts a #tag that appears after a heading line", () => {
      const result = extractMentions("# 見出し\n本文の #realTag を含む");
      expect(result.projects).toEqual(["realTag"]);
    });

    it("does not extract `#` followed by a space — HASH_PATTERN requires [\\p{L}\\p{N}_-] after `#`, so the result is independent of HEADING_PATTERN", () => {
      const result = extractMentions("「これは # ではない」");
      expect(result.projects).toEqual([]);
    });
  });

  describe("Email address exclusion", () => {
    it("does NOT extract @example from user@example.com", () => {
      const result = extractMentions("contact user@example.com please");
      expect(result.tags).toEqual([]);
    });

    it("does NOT extract from a multi-segment email like test.user@domain.co.jp", () => {
      const result = extractMentions("send to test.user@domain.co.jp soon");
      expect(result.tags).toEqual([]);
    });

    it("extracts a standalone @tag that follows an email", () => {
      const result = extractMentions("user@example.com @tag");
      expect(result.tags).toEqual(["tag"]);
    });
  });

  describe("deduplication and order preservation", () => {
    it("dedupes #aa #bb #aa preserving first-occurrence order", () => {
      const result = extractMentions("#aa #bb #aa");
      expect(result.projects).toEqual(["aa", "bb"]);
    });

    it("dedupes @tag1 @tag2 @tag1 @tag3 preserving first-occurrence order", () => {
      const result = extractMentions("@tag1 @tag2 @tag1 @tag3");
      expect(result.tags).toEqual(["tag1", "tag2", "tag3"]);
    });

    it("dedupes mixed #proj @tag #proj @other across both buckets, preserving order", () => {
      const result = extractMentions("#proj @tag #proj @other");
      expect(result.projects).toEqual(["proj"]);
      expect(result.tags).toEqual(["tag", "other"]);
    });
  });
});
