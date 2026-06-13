import { describe, expect, it } from "bun:test";

import "@/core";
import "@/cli";
import "@/mcp";
import "@/db";
import "@/git";
import "@/i18n";
import "@/watch";
import "@/log";
import "@/config";

describe("smoke", () => {
  it("runs the test runner", () => {
    expect(1 + 1).toBe(2);
  });

  it("resolves @/ path alias for every subpackage", () => {
    expect(true).toBe(true);
  });
});
