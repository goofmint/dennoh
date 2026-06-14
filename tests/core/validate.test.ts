import { describe, expect, it } from "bun:test";
import { Buffer } from "node:buffer";

import { ContentValidationError, validateContent } from "@/core/validate";

describe("validateContent", () => {
  describe("happy path", () => {
    it("returns silently for plain ASCII content under the size cap", () => {
      expect(() => validateContent("hello world", 1024)).not.toThrow();
    });

    it("returns silently for multi-byte UTF-8 content under the size cap", () => {
      expect(() => validateContent("日本語のメモ ✅", 1024)).not.toThrow();
    });

    it("accepts content whose UTF-8 byte length exactly equals the cap", () => {
      const text = "a".repeat(8);
      expect(Buffer.byteLength(text, "utf8")).toBe(8);
      expect(() => validateContent(text, 8)).not.toThrow();
    });

    it("accepts an empty string", () => {
      expect(() => validateContent("", 16)).not.toThrow();
    });
  });

  describe("NULL byte rejection (binary detection)", () => {
    it("throws ContentValidationError with code validate.content.binary on a NULL byte", () => {
      try {
        validateContent("hello\0world", 1024);
        throw new Error("validateContent should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ContentValidationError);
        const err = e as ContentValidationError;
        expect(err.code).toBe("validate.content.binary");
        expect(err.message).toMatch(/NULL byte/);
      }
    });

    it("rejects a leading NULL byte", () => {
      expect(() => validateContent("\0start", 1024)).toThrow(ContentValidationError);
    });

    it("rejects a trailing NULL byte", () => {
      expect(() => validateContent("end\0", 1024)).toThrow(ContentValidationError);
    });

    it("rejects a NULL byte even when content would otherwise fit", () => {
      expect(() => validateContent("\0", 1)).toThrow(ContentValidationError);
    });
  });

  describe("size cap rejection", () => {
    it("throws ContentValidationError with code validate.content.too_large when over cap", () => {
      const text = "a".repeat(100);
      try {
        validateContent(text, 50);
        throw new Error("validateContent should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ContentValidationError);
        const err = e as ContentValidationError;
        expect(err.code).toBe("validate.content.too_large");
        expect(err.details.sizeBytes).toBe(100);
        // Public contract: the upper-bound key is `maxSizeBytes`, matching
        // the validateContent parameter name. Asserting it directly catches
        // contract drift; the previous `?? maxFileSizeBytes` fallback hid it.
        expect(err.details.maxSizeBytes).toBe(50);
      }
    });

    it("counts UTF-8 byte length, not JavaScript string length, against the cap", () => {
      // "あ" is 3 bytes in UTF-8; the string length is 1. A cap of 2 must
      // reject it because we measure bytes.
      const text = "あ";
      expect(text.length).toBe(1);
      expect(Buffer.byteLength(text, "utf8")).toBe(3);
      expect(() => validateContent(text, 2)).toThrow(ContentValidationError);
    });

    it("rejects content one byte over the cap", () => {
      const text = "a".repeat(9);
      expect(() => validateContent(text, 8)).toThrow(ContentValidationError);
    });
  });

  describe("ordering", () => {
    it("checks for NULL bytes before size — binary content is rejected even when over cap", () => {
      // The error code is the deterministic way to assert which check fired.
      try {
        validateContent("\0".repeat(100), 10);
        throw new Error("validateContent should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ContentValidationError);
        const err = e as ContentValidationError;
        expect(err.code).toBe("validate.content.binary");
      }
    });
  });
});
