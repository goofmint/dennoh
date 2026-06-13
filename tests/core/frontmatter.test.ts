import { describe, expect, it } from "bun:test";

import {
  isoWithLocalOffset,
  parseFrontmatter,
  serializeFrontmatter,
  updateFrontmatter,
} from "@/core/frontmatter";
import type { NoteFrontmatter } from "@/core/types";

const SAMPLE: NoteFrontmatter = {
  createdAt: "2026-06-12T10:30:00+09:00",
  updatedAt: "2026-06-12T10:35:00+09:00",
  source: "note",
  title: "Hello",
  projects: ["denno", "blog"],
  tags: ["ai-coding", "mcp"],
};

function omitTitle(fm: NoteFrontmatter): NoteFrontmatter {
  const copy: NoteFrontmatter = { ...fm };
  Reflect.deleteProperty(copy, "title");
  return copy;
}

describe("frontmatter", () => {
  describe("isoWithLocalOffset", () => {
    it("matches the ISO 8601 with offset shape", () => {
      const out = isoWithLocalOffset(new Date());
      expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    });
  });

  describe("serializeFrontmatter", () => {
    it("starts with a --- delimiter line", () => {
      const out = serializeFrontmatter(SAMPLE, "body");
      expect(out.startsWith("---\n")).toBe(true);
    });

    it("places the body after a blank line that follows the closing delimiter", () => {
      const out = serializeFrontmatter(SAMPLE, "body");
      expect(out.endsWith("---\n\nbody")).toBe(true);
    });

    it("never emits an id field", () => {
      const withId = { ...SAMPLE, id: "should-not-appear" };
      const out = serializeFrontmatter(withId as NoteFrontmatter, "");
      expect(out).not.toMatch(/^id:/m);
    });

    it("emits empty projects and tags as []", () => {
      const out = serializeFrontmatter({ ...SAMPLE, projects: [], tags: [] }, "");
      expect(out).toContain("projects: []");
      expect(out).toContain("tags: []");
    });

    it("omits the title field when undefined", () => {
      const out = serializeFrontmatter(omitTitle(SAMPLE), "");
      expect(out).not.toMatch(/^title:/m);
    });

    it("includes the title field when present", () => {
      const out = serializeFrontmatter(SAMPLE, "");
      expect(out).toContain("title:");
      expect(out).toContain("Hello");
    });
  });

  describe("parseFrontmatter", () => {
    it("round-trips with serializeFrontmatter (full sample)", () => {
      const serialized = serializeFrontmatter(SAMPLE, "Body content here.\n");
      const { frontmatter, body } = parseFrontmatter(serialized);
      expect(frontmatter).toEqual(SAMPLE);
      expect(body).toBe("Body content here.\n");
    });

    it("round-trips when title is undefined", () => {
      const fm = omitTitle(SAMPLE);
      const { frontmatter } = parseFrontmatter(serializeFrontmatter(fm, "x"));
      expect(frontmatter).toEqual(fm);
      expect(frontmatter.title).toBeUndefined();
    });

    it("round-trips when projects and tags are empty", () => {
      const fm: NoteFrontmatter = { ...SAMPLE, projects: [], tags: [] };
      const { frontmatter } = parseFrontmatter(serializeFrontmatter(fm, ""));
      expect(frontmatter.projects).toEqual([]);
      expect(frontmatter.tags).toEqual([]);
    });

    it("applies default source/projects/tags when omitted from YAML", () => {
      const content = `---
createdAt: "2026-06-12T10:30:00+09:00"
updatedAt: "2026-06-12T10:35:00+09:00"
---

body
`;
      const { frontmatter, body } = parseFrontmatter(content);
      expect(frontmatter.source).toBe("note");
      expect(frontmatter.projects).toEqual([]);
      expect(frontmatter.tags).toEqual([]);
      expect(frontmatter.title).toBeUndefined();
      expect(body).toBe("body\n");
    });

    it("throws on invalid YAML", () => {
      const content = "---\n:::: garbage ::::\n---\n\nbody\n";
      expect(() => parseFrontmatter(content)).toThrow(/Invalid YAML/);
    });

    it("throws when createdAt is missing", () => {
      const content = `---
updatedAt: "2026-06-12T10:35:00+09:00"
---

body
`;
      expect(() => parseFrontmatter(content)).toThrow(/createdAt/);
    });

    it("throws when updatedAt is missing", () => {
      const content = `---
createdAt: "2026-06-12T10:30:00+09:00"
---

body
`;
      expect(() => parseFrontmatter(content)).toThrow(/updatedAt/);
    });

    it("throws when the opening delimiter is missing", () => {
      expect(() => parseFrontmatter("just a body\n")).toThrow(/delimiter/);
    });

    it("throws when the closing delimiter is missing", () => {
      expect(() => parseFrontmatter("---\ncreatedAt: foo\n")).toThrow(/Closing/);
    });

    it("accepts ISO 8601 with Z (UTC) offset", () => {
      const content = `---
createdAt: "2026-06-12T10:30:00Z"
updatedAt: "2026-06-12T10:35:00Z"
---

body
`;
      const { frontmatter } = parseFrontmatter(content);
      expect(frontmatter.createdAt).toBe("2026-06-12T10:30:00Z");
      expect(frontmatter.updatedAt).toBe("2026-06-12T10:35:00Z");
    });

    it("accepts ISO 8601 with fractional seconds and offset", () => {
      const content = `---
createdAt: "2026-06-12T10:30:00.123+09:00"
updatedAt: "2026-06-12T10:35:00.456-05:00"
---

body
`;
      const { frontmatter } = parseFrontmatter(content);
      expect(frontmatter.createdAt).toBe("2026-06-12T10:30:00.123+09:00");
    });

    it("throws when createdAt is a non-ISO string", () => {
      const content = `---
createdAt: "yesterday"
updatedAt: "2026-06-12T10:35:00+09:00"
---

body
`;
      expect(() => parseFrontmatter(content)).toThrow(/createdAt.*ISO 8601/);
    });

    it("throws when createdAt lacks an offset", () => {
      const content = `---
createdAt: "2026-06-12T10:30:00"
updatedAt: "2026-06-12T10:35:00+09:00"
---

body
`;
      expect(() => parseFrontmatter(content)).toThrow(/createdAt.*offset/);
    });

    it("throws when createdAt is a date-only string", () => {
      const content = `---
createdAt: "2026-06-12"
updatedAt: "2026-06-12T10:35:00+09:00"
---

body
`;
      expect(() => parseFrontmatter(content)).toThrow(/createdAt/);
    });

    it("throws when createdAt has impossible date components even if shape matches", () => {
      const content = `---
createdAt: "2026-13-99T10:30:00+09:00"
updatedAt: "2026-06-12T10:35:00+09:00"
---

body
`;
      expect(() => parseFrontmatter(content)).toThrow(/createdAt.*timestamp/);
    });

    it("throws when updatedAt is not ISO with offset (even if createdAt is fine)", () => {
      const content = `---
createdAt: "2026-06-12T10:30:00+09:00"
updatedAt: "today"
---

body
`;
      expect(() => parseFrontmatter(content)).toThrow(/updatedAt/);
    });

    it("throws on unsupported source value", () => {
      const content = `---
createdAt: "2026-06-12T10:30:00+09:00"
updatedAt: "2026-06-12T10:35:00+09:00"
source: url
---

body
`;
      expect(() => parseFrontmatter(content)).toThrow(/source/);
    });

    it("throws when projects contains a non-string element", () => {
      const content = `---
createdAt: "2026-06-12T10:30:00+09:00"
updatedAt: "2026-06-12T10:35:00+09:00"
projects:
  - foo
  - 42
---

body
`;
      expect(() => parseFrontmatter(content)).toThrow(/projects/);
    });

    it("throws when projects is not a sequence", () => {
      const content = `---
createdAt: "2026-06-12T10:30:00+09:00"
updatedAt: "2026-06-12T10:35:00+09:00"
projects: not-an-array
---

body
`;
      expect(() => parseFrontmatter(content)).toThrow(/projects/);
    });

    it("normalizes CRLF line endings", () => {
      const content =
        '---\r\ncreatedAt: "2026-06-12T10:30:00+09:00"\r\n' +
        'updatedAt: "2026-06-12T10:35:00+09:00"\r\n---\r\n\r\nbody\r\n';
      const { frontmatter, body } = parseFrontmatter(content);
      expect(frontmatter.createdAt).toBe("2026-06-12T10:30:00+09:00");
      expect(body).toBe("body\n");
    });

    it("preserves multi-line body content as-is", () => {
      const fm = SAMPLE;
      const body = "line one\n\nline two\nline three\n";
      const out = parseFrontmatter(serializeFrontmatter(fm, body));
      expect(out.body).toBe(body);
    });
  });

  describe("updateFrontmatter", () => {
    it("merges partial updates onto existing fields", () => {
      const out = updateFrontmatter(SAMPLE, { title: "Updated" });
      expect(out.title).toBe("Updated");
      expect(out.projects).toEqual(SAMPLE.projects);
      expect(out.tags).toEqual(SAMPLE.tags);
    });

    it("does not mutate the existing object", () => {
      const before = { ...SAMPLE };
      updateFrontmatter(SAMPLE, { title: "Updated" }, { bumpUpdatedAt: true });
      expect(SAMPLE).toEqual(before);
    });

    it("protects createdAt from being overwritten by updates", () => {
      const out = updateFrontmatter(SAMPLE, { createdAt: "2099-01-01T00:00:00+00:00" });
      expect(out.createdAt).toBe(SAMPLE.createdAt);
    });

    it("bumps updatedAt to the current time when option is set", () => {
      const out = updateFrontmatter(SAMPLE, {}, { bumpUpdatedAt: true });
      expect(out.updatedAt).not.toBe(SAMPLE.updatedAt);
      expect(out.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    });

    it("keeps updatedAt unchanged when the option is unset and no updates supply it", () => {
      const out = updateFrontmatter(SAMPLE, { title: "x" });
      expect(out.updatedAt).toBe(SAMPLE.updatedAt);
    });

    it("honors explicit updates.updatedAt when bumpUpdatedAt is not set", () => {
      const out = updateFrontmatter(SAMPLE, { updatedAt: "2099-01-01T00:00:00+00:00" });
      expect(out.updatedAt).toBe("2099-01-01T00:00:00+00:00");
    });

    it("bumpUpdatedAt overrides explicit updates.updatedAt", () => {
      const out = updateFrontmatter(
        SAMPLE,
        { updatedAt: "2099-01-01T00:00:00+00:00" },
        { bumpUpdatedAt: true }
      );
      expect(out.updatedAt).not.toBe("2099-01-01T00:00:00+00:00");
    });
  });
});
