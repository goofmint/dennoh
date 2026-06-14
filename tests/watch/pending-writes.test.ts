import { describe, expect, it } from "bun:test";

import { isOwnWrite, markWriteEnd, markWriteStart } from "@/watch/pending-writes";

describe("watch/pending-writes", () => {
  // Note: the registry is module-level and process-global. Each test uses a
  // unique path so independent cases don't bleed into each other even when
  // bun runs them in the same worker.

  it("returns false for a path that was never marked", () => {
    expect(isOwnWrite("/tmp/pw-never-marked.md")).toBe(false);
  });

  it("returns true between markWriteStart and markWriteEnd", () => {
    const p = "/tmp/pw-basic.md";
    expect(isOwnWrite(p)).toBe(false);
    markWriteStart(p);
    expect(isOwnWrite(p)).toBe(true);
    markWriteEnd(p);
    expect(isOwnWrite(p)).toBe(false);
  });

  it("treats distinct absolute paths independently", () => {
    const a = "/tmp/pw-a.md";
    const b = "/tmp/pw-b.md";
    markWriteStart(a);
    expect(isOwnWrite(a)).toBe(true);
    expect(isOwnWrite(b)).toBe(false);
    markWriteEnd(a);
  });

  it("compares paths by exact string equality (not normalized)", () => {
    // The registry is a plain Set: callers are expected to pass identical
    // absolute paths on both sides. We document the contract by asserting
    // a trailing-slash variant does NOT match.
    const p = "/tmp/pw-strict.md";
    markWriteStart(p);
    expect(isOwnWrite(`${p}/`)).toBe(false);
    markWriteEnd(p);
  });

  it("markWriteEnd is a no-op when the path was never added", () => {
    expect(() => markWriteEnd("/tmp/pw-never-added.md")).not.toThrow();
    expect(isOwnWrite("/tmp/pw-never-added.md")).toBe(false);
  });

  it("nested start/end of the same path collapses on the first end", () => {
    // The set is presence-based, not refcounted. A second markWriteStart on
    // a path already present is a no-op, and the first markWriteEnd clears
    // it. Documented here so callers don't rely on refcount semantics.
    const p = "/tmp/pw-nested.md";
    markWriteStart(p);
    markWriteStart(p);
    expect(isOwnWrite(p)).toBe(true);
    markWriteEnd(p);
    expect(isOwnWrite(p)).toBe(false);
  });
});
