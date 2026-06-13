import { describe, expect, it } from "bun:test";

import { generateId, isValidUuid } from "@/core/uuid";

describe("uuid", () => {
  describe("generateId", () => {
    it("returns a UUID v7 that passes isValidUuid", () => {
      const id = generateId();
      expect(isValidUuid(id)).toBe(true);
    });

    it("returns unique values across many calls", () => {
      const ids = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        ids.add(generateId());
      }
      expect(ids.size).toBe(1000);
    });

    it("returns time-sortable strings (string ascending order matches generation order)", () => {
      const ids: string[] = [];
      for (let i = 0; i < 500; i++) {
        ids.push(generateId());
      }
      const sorted = [...ids].sort();
      expect(ids).toEqual(sorted);
    });
  });

  describe("isValidUuid", () => {
    it("accepts a freshly generated UUID v7", () => {
      expect(isValidUuid(generateId())).toBe(true);
    });

    it("accepts a known-good UUID v7 string", () => {
      expect(isValidUuid("018f0c8e-7c4f-7d3a-8b2e-1234567890ab")).toBe(true);
    });

    it("accepts uppercase hex", () => {
      expect(isValidUuid("018F0C8E-7C4F-7D3A-8B2E-1234567890AB")).toBe(true);
    });

    it("rejects UUID v4 (wrong version nibble)", () => {
      expect(isValidUuid("018f0c8e-7c4f-4d3a-8b2e-1234567890ab")).toBe(false);
    });

    it("rejects invalid variant nibble", () => {
      expect(isValidUuid("018f0c8e-7c4f-7d3a-7b2e-1234567890ab")).toBe(false);
    });

    it("rejects non-hex characters", () => {
      expect(isValidUuid("018f0c8e-7c4f-7d3a-8b2e-1234567890zz")).toBe(false);
    });

    it("rejects wrong segment lengths", () => {
      expect(isValidUuid("018f0c8e-7c4f-7d3a-8b2e-1234567890a")).toBe(false);
    });

    it("rejects missing hyphens", () => {
      expect(isValidUuid("018f0c8e7c4f7d3a8b2e1234567890ab")).toBe(false);
    });

    it("rejects empty string", () => {
      expect(isValidUuid("")).toBe(false);
    });
  });
});
