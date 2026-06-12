import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

import { log } from "@/log";

type WriteFn = typeof process.stderr.write;

describe("log", () => {
  let stderrSpy: ReturnType<typeof spyOn<NodeJS.WriteStream, "write">>;
  let stdoutSpy: ReturnType<typeof spyOn<NodeJS.WriteStream, "write">>;
  let originalLevel: string | undefined;

  beforeEach(() => {
    originalLevel = process.env.DENNOH_LOG_LEVEL;
    Reflect.deleteProperty(process.env, "DENNOH_LOG_LEVEL");
    stderrSpy = spyOn(process.stderr, "write").mockImplementation(
      ((..._args: Parameters<WriteFn>) => true) as WriteFn
    );
    stdoutSpy = spyOn(process.stdout, "write").mockImplementation(
      ((..._args: Parameters<WriteFn>) => true) as WriteFn
    );
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
    if (originalLevel === undefined) {
      Reflect.deleteProperty(process.env, "DENNOH_LOG_LEVEL");
    } else {
      process.env.DENNOH_LOG_LEVEL = originalLevel;
    }
  });

  it("writes to stderr", () => {
    log.info("hello");
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });

  it("does not write to stdout", () => {
    log.info("hello");
    log.warn("warn");
    log.error("err");
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("emits JSON line with level, ts, msg, ctx", () => {
    log.info("greet", { user: "atsushi" });
    const firstCall = stderrSpy.mock.calls[0];
    expect(firstCall).toBeDefined();
    const raw = firstCall?.[0];
    expect(typeof raw).toBe("string");
    const line = String(raw);
    expect(line.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("greet");
    expect(parsed.user).toBe("atsushi");
    expect(typeof parsed.ts).toBe("string");
  });

  it("does not let ctx override level / ts / msg", () => {
    log.info("real-msg", { level: "debug", ts: "forged", msg: "forged" });
    const firstCall = stderrSpy.mock.calls[0];
    const parsed = JSON.parse(String(firstCall?.[0])) as Record<string, unknown>;
    expect(parsed.level).toBe("info");
    expect(parsed.msg).toBe("real-msg");
    expect(parsed.ts).not.toBe("forged");
  });

  it("filters below threshold (default info suppresses debug)", () => {
    log.debug("should be suppressed");
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("respects DENNOH_LOG_LEVEL=debug", () => {
    process.env.DENNOH_LOG_LEVEL = "debug";
    log.debug("now visible");
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });

  it("ignores invalid DENNOH_LOG_LEVEL and falls back to info", () => {
    process.env.DENNOH_LOG_LEVEL = "bogus";
    log.debug("hidden");
    log.info("shown");
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });
});
