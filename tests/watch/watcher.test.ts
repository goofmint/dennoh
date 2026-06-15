// Belt-and-braces: disable the production translation pipeline so any code
// path that bypasses our DI override (e.g. a regression where translate
// defaults to translateJaToEn) does not download the 300MB model during
// tests. Phase 3 tests pass `translate: null` explicitly; this env var is
// the safety net.
process.env.DENNOH_TRANSLATE_DISABLE = "1";

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { serializeFrontmatter } from "@/core/frontmatter";
import type { NoteFrontmatter } from "@/core/types";
import { generateId } from "@/core/uuid";
import { closeDatabase, openDatabase } from "@/db/connection";
import type { TranslatorFn } from "@/db/reindex";
import { getNoteById } from "@/db/repository";
import { runMigrations } from "@/db/schema";
import { markWriteEnd, markWriteStart } from "@/watch/pending-writes";
import { type WatcherHandle, startWatcher } from "@/watch/watcher";

// Short debounce keeps the suite fast; we still wait through both the
// macOS FSEvents delivery latency (~tens of ms in practice) and the debounce
// window before asserting that a flush did or did not happen.
const TEST_DEBOUNCE_MS = 100;
const FS_EVENT_LATENCY_BUFFER_MS = 350;

// Sample UUID v7s — the watcher only filters on `.md` extension so any
// .md-suffixed basename is fine, but using realistic ids documents intent.
const ID_A = "018f0c8e-7c4f-7d3a-8b2e-aaaaaaaaaaaa";
const ID_B = "018f0c8e-7c4f-7d3a-8b2e-bbbbbbbbbbbb";
const ID_C = "018f0c8e-7c4f-7d3a-8b2e-cccccccccccc";
const ID_D = "018f0c8e-7c4f-7d3a-8b2e-dddddddddddd";
const ID_E = "018f0c8e-7c4f-7d3a-8b2e-eeeeeeeeeeee";

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function waitForFlush(extra = 0): Promise<void> {
  return waitMs(TEST_DEBOUNCE_MS + FS_EVENT_LATENCY_BUFFER_MS + extra);
}

type FlushCall = { absolutePath: string; eventType: string };

describe("watch/watcher", () => {
  let vaultPath: string;
  let db: Database;
  let calls: FlushCall[];
  let handle: WatcherHandle | null;

  beforeEach(() => {
    vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-watcher-"));
    // In-memory SQLite — Phase 2 doesn't touch the DB, but startWatcher's
    // signature requires a real Database instance.
    db = new Database(":memory:");
    calls = [];
    handle = null;
  });

  afterEach(() => {
    if (handle !== null) {
      handle.stop();
      handle = null;
    }
    db.close();
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  async function start(overrides?: {
    debounceMs?: number;
    initializeTranslation?: () => Promise<void>;
  }): Promise<WatcherHandle> {
    const h = await startWatcher(vaultPath, db, {
      debounceMs: overrides?.debounceMs ?? TEST_DEBOUNCE_MS,
      // Stub the model preloader so the suite never triggers a real download.
      initializeTranslation: overrides?.initializeTranslation ?? (() => Promise.resolve()),
      onChange: (absolutePath, eventType) => {
        calls.push({ absolutePath, eventType });
      },
    });
    handle = h;
    return h;
  }

  it("returns a handle and stop() is idempotent", async () => {
    const h = await start();
    expect(typeof h.stop).toBe("function");
    h.stop();
    // A second stop() must not throw — defensive against double-shutdown
    // paths (signal handler racing with explicit cleanup).
    expect(() => h.stop()).not.toThrow();
    handle = null;
  });

  it("swallows translation init failures and still starts the watcher", async () => {
    await start({
      initializeTranslation: () => Promise.reject(new Error("model unavailable")),
    });
    // Give the .catch a tick to log before continuing.
    await waitMs(0);

    const notePath = path.join(vaultPath, `${ID_A}.md`);
    await fs.promises.writeFile(notePath, "hello");
    await waitForFlush();

    expect(calls.some((c) => c.absolutePath === notePath)).toBe(true);
  });

  it("invokes onChange after the debounce for a .md file creation", async () => {
    await start();
    const notePath = path.join(vaultPath, `${ID_B}.md`);
    await fs.promises.writeFile(notePath, "hello");
    await waitForFlush();

    // Exactly one flush is the meaningful contract. fs.watch emits "rename"
    // on create and "change" on modify (and macOS can coalesce them); the
    // watcher passes either through verbatim, so we don't pin the event-type
    // string here.
    const seen = calls.filter((c) => c.absolutePath === notePath);
    expect(seen.length).toBe(1);
  });

  it("coalesces multiple events on the same path into a single flush", async () => {
    await start();
    const notePath = path.join(vaultPath, `${ID_C}.md`);

    // Rapid edits within the debounce window must collapse to one flush.
    // 10ms < TEST_DEBOUNCE_MS so each setTimeout resets the previous.
    await fs.promises.writeFile(notePath, "v1");
    await waitMs(10);
    await fs.promises.writeFile(notePath, "v2");
    await waitMs(10);
    await fs.promises.writeFile(notePath, "v3");
    await waitForFlush();

    const matching = calls.filter((c) => c.absolutePath === notePath);
    expect(matching.length).toBe(1);
  });

  it("fires per-path independently when multiple files change", async () => {
    await start();
    const a = path.join(vaultPath, `${ID_A}.md`);
    const b = path.join(vaultPath, `${ID_B}.md`);
    // A short gap between the writes nudges macOS FSEvents to deliver
    // separate notifications. Without it, two writes inside the same syscall
    // tick can be batched into a single event with one filename, which would
    // hide a real bug in the watcher's per-path dispatch under timing noise.
    await fs.promises.writeFile(a, "alpha");
    await waitMs(30);
    await fs.promises.writeFile(b, "beta");
    await waitForFlush();

    expect(calls.some((c) => c.absolutePath === a)).toBe(true);
    expect(calls.some((c) => c.absolutePath === b)).toBe(true);
  });

  it("ignores events from hidden directories (.dennoh subtree)", async () => {
    await start();
    const hiddenDir = path.join(vaultPath, ".dennoh");
    await fs.promises.mkdir(hiddenDir, { recursive: true });
    const hiddenFile = path.join(hiddenDir, "index.db");
    await fs.promises.writeFile(hiddenFile, "fake");
    await waitForFlush();

    expect(calls.some((c) => c.absolutePath === hiddenFile)).toBe(false);
  });

  it("ignores events for non-.md files", async () => {
    await start();
    const txtPath = path.join(vaultPath, "notes.txt");
    await fs.promises.writeFile(txtPath, "plaintext");
    await waitForFlush();

    expect(calls.some((c) => c.absolutePath === txtPath)).toBe(false);
  });

  it("ignores events for paths currently marked as own writes", async () => {
    await start();
    const notePath = path.join(vaultPath, `${ID_D}.md`);
    markWriteStart(notePath);
    try {
      await fs.promises.writeFile(notePath, "from dennoh");
      await waitForFlush();
      expect(calls.some((c) => c.absolutePath === notePath)).toBe(false);
    } finally {
      // Always clear the marker so the global registry doesn't leak
      // between tests / suites.
      markWriteEnd(notePath);
    }
  });

  it("stop() prevents further flushes from pending events", async () => {
    // Use a wider debounce so the FS event has time to be delivered and
    // enqueued, but the timer is still pending when stop() is called.
    const h = await start({ debounceMs: 250 });
    const notePath = path.join(vaultPath, `${ID_E}.md`);
    await fs.promises.writeFile(notePath, "x");
    // Wait long enough for fs.watch delivery on macOS FSEvents (~tens of ms)
    // but well short of the 250ms debounce.
    await waitMs(100);
    h.stop();
    handle = null;

    // Wait beyond the debounce window plus a comfortable buffer.
    await waitMs(400);
    expect(calls.some((c) => c.absolutePath === notePath)).toBe(false);
  });

  it("absorbs async handler rejections and keeps processing later events", async () => {
    // A throwing handler must not leave an unhandled rejection on the timer
    // boundary or stop the next event from being processed. The handler
    // always rejects; we count invocations and assert the count keeps
    // climbing as more events arrive — proving the watcher survived each
    // rejection.
    let invocations = 0;
    handle = await startWatcher(vaultPath, db, {
      debounceMs: TEST_DEBOUNCE_MS,
      initializeTranslation: () => Promise.resolve(),
      onChange: () => {
        invocations++;
        return Promise.reject(new Error("boom"));
      },
    });

    const first = path.join(vaultPath, `${ID_A}.md`);
    await fs.promises.writeFile(first, "first");
    await waitForFlush();
    const afterFirst = invocations;
    expect(afterFirst).toBeGreaterThanOrEqual(1);

    const second = path.join(vaultPath, `${ID_B}.md`);
    await fs.promises.writeFile(second, "second");
    await waitForFlush();
    expect(invocations).toBeGreaterThan(afterFirst);
  });
});

// Phase 3: exercise the default change handler — the watcher's debounced
// flush runs scanAndSync, which reconciles disk state into the SQLite index.
// These tests use a real schema-migrated DB (not the in-memory placeholder
// the filter / debounce tests above use) and rely on `writeNote` to produce
// proper UUID-named markdown files with valid frontmatter.

function fm(overrides: Partial<NoteFrontmatter> = {}): NoteFrontmatter {
  return {
    createdAt: "2026-06-12T10:00:00+09:00",
    updatedAt: "2026-06-12T10:05:00+09:00",
    source: "note",
    projects: [],
    tags: [],
    ...overrides,
  };
}

// Phase 3 tests deliberately put notes directly under vaultPath instead of
// going through writeNote's YYYY/MM/DD layout. macOS FSEvents in Bun's
// fs.watch implementation does not reliably deliver events for files in
// subdirectories that did not exist when the watcher was started, so
// exercising the file-to-DB path with subdir creation would produce flaky
// "no event arrived" failures unrelated to the watcher's actual contract.
// scanAndSync's walk is recursive and treats vault-root files identically
// to nested ones, so the assertion coverage is unaffected.
async function writeNoteToVaultRoot(
  vaultPath: string,
  id: string,
  body: string,
  fmOverrides: Partial<NoteFrontmatter> = {}
): Promise<string> {
  const filePath = path.join(vaultPath, `${id}.md`);
  // Direct write (not writeFileAtomic) so each test write produces a single
  // fs.watch event. Atomic-write's tmp+rename dance produces multiple events
  // that are platform-specific in their delivery; isolating to one event
  // simplifies assertions about scanAndSync triggering.
  await fs.promises.writeFile(filePath, serializeFrontmatter(fm(fmOverrides), body));
  return filePath;
}

// Push mtime well past the DB's `updated_at` so the scanAndSync diff
// predicate (mtime > updated_at) fires deterministically without relying on
// real-time latency between writes.
function bumpMtime(filePath: string, secondsFromNow = 600): void {
  const future = (Date.now() + secondsFromNow * 1000) / 1000;
  fs.utimesSync(filePath, future, future);
}

// Wider wait for Phase 3: the scan walks the vault and writes to SQLite
// after the debounce window, so the assertion budget needs to cover
// debounce + FS-event latency + scan execution.
const SCAN_WAIT_MS = 900;

// macOS FSEvents (the kernel backend behind fs.watch with recursive:true)
// drops events delivered before the watcher has fully registered with the
// kernel. The first ~50-100ms after `fs.watch` returns is unreliable; in
// the full suite warmer tests mask this, but in isolation a cold-start
// test loses its single write event. Awaiting this brief settle period
// after startWatcher matches what the production stack experiences in
// practice (the daemon runs for hours; the first event is rarely missed).
const WATCHER_WARMUP_MS = 150;

describe("watch/watcher: default change handler (Phase 3)", () => {
  let vaultPath: string;
  let db: Database;
  let handle: WatcherHandle | null;

  beforeEach(() => {
    vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-watcher-p3-"));
    db = openDatabase(vaultPath);
    runMigrations(db);
    handle = null;
  });

  afterEach(() => {
    if (handle !== null) {
      handle.stop();
      handle = null;
    }
    closeDatabase(db);
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  // Phase-3 helper: start the watcher and wait through the FSEvents warmup
  // window before returning. Without this, isolated test runs lose the first
  // file-write event because macOS FSEvents hasn't fully registered the
  // recursive watch yet. Full-suite runs mask this because previous tests
  // warm the kernel state; isolation reveals it.
  async function startWatcherForTest(
    overrides: { translate?: TranslatorFn | null } = {}
  ): Promise<WatcherHandle> {
    const h = await startWatcher(vaultPath, db, {
      debounceMs: TEST_DEBOUNCE_MS,
      initializeTranslation: () => Promise.resolve(),
      translate: overrides.translate ?? null,
    });
    await waitMs(WATCHER_WARMUP_MS);
    return h;
  }

  it("indexes a newly-added .md file after the debounce window", async () => {
    handle = await startWatcherForTest();

    const id = generateId();
    await writeNoteToVaultRoot(vaultPath, id, "newly added body");
    await waitMs(SCAN_WAIT_MS);

    const row = getNoteById(db, id);
    expect(row).not.toBeNull();
    expect(row?.body).toBe("newly added body");
  });

  it("updates the DB row when an existing note is modified externally", async () => {
    handle = await startWatcherForTest();

    const id = generateId();
    const filePath = await writeNoteToVaultRoot(vaultPath, id, "v1", {
      updatedAt: "2026-06-14T10:00:00+09:00",
    });
    await waitMs(SCAN_WAIT_MS);
    expect(getNoteById(db, id)?.body).toBe("v1");

    // External modification: rewrite with later updated_at and bump mtime so
    // the diff predicate (mtime > updated_at) fires deterministically.
    await writeNoteToVaultRoot(vaultPath, id, "v2", {
      updatedAt: "2026-06-14T11:00:00+09:00",
    });
    bumpMtime(filePath);
    await waitMs(SCAN_WAIT_MS);

    const after = getNoteById(db, id);
    expect(after?.body).toBe("v2");
    expect(after?.updated_at).toBe("2026-06-14T11:00:00+09:00");
  });

  it("removes the DB row when a file is externally deleted", async () => {
    handle = await startWatcherForTest();

    const id = generateId();
    const filePath = await writeNoteToVaultRoot(vaultPath, id, "doomed");
    await waitMs(SCAN_WAIT_MS);
    expect(getNoteById(db, id)?.id).toBe(id);

    await fs.promises.unlink(filePath);
    await waitMs(SCAN_WAIT_MS);

    // scanAndSync uses a hard delete (deleteNote) for externally-removed
    // files — distinct from the soft-delete path used by deleteMemory.
    expect(getNoteById(db, id)).toBeNull();
  });

  it("honors translate: null by leaving body_en empty even for Japanese content", async () => {
    handle = await startWatcherForTest();

    const id = generateId();
    await writeNoteToVaultRoot(vaultPath, id, "こんにちは世界");
    await waitMs(SCAN_WAIT_MS);

    const row = getNoteById(db, id);
    expect(row?.body).toBe("こんにちは世界");
    // Null override routes through the no-op translator → body_en stays "".
    expect(row?.body_en).toBe("");
  });

  it("forwards a DI translator and absorbs its rejections without losing the row", async () => {
    // The translator throws on every call. scanAndSync catches into
    // translationErrors and proceeds with body_en="". The watcher must
    // record the row regardless and log the failure at warn level.
    let translatorCalls = 0;
    const failingTranslator = (): Promise<string> => {
      translatorCalls++;
      return Promise.reject(new Error("translator unavailable"));
    };

    handle = await startWatcherForTest({ translate: failingTranslator });

    const id = generateId();
    await writeNoteToVaultRoot(vaultPath, id, "テストデータ");
    await waitMs(SCAN_WAIT_MS);

    expect(translatorCalls).toBeGreaterThanOrEqual(1);
    const row = getNoteById(db, id);
    expect(row?.body).toBe("テストデータ");
    expect(row?.body_en).toBe("");
  });

  it("keeps indexing later files even when an earlier one fails to parse", async () => {
    // A .md file whose basename is not a valid UUID v7 makes readNote throw
    // (assertValidNoteId rejects the path). scanAndSync should record the
    // failure in `errors` and keep walking; the subsequent valid file must
    // still land in the DB.
    const malformedPath = path.join(vaultPath, "not-a-uuid.md");
    await fs.promises.writeFile(malformedPath, "no frontmatter, no UUID");

    handle = await startWatcherForTest();

    const validId = generateId();
    await writeNoteToVaultRoot(vaultPath, validId, "valid body");
    await waitMs(SCAN_WAIT_MS);

    expect(getNoteById(db, validId)?.body).toBe("valid body");
  });
});
