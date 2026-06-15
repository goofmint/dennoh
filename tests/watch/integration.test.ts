// Belt-and-braces: keep the production translation pipeline from kicking in
// during integration tests. Every test here either passes `translate: null`
// or a DI override, but the env var protects against future regressions
// where a default path slips through.
process.env.DENNOH_TRANSLATE_DISABLE = "1";

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { serializeFrontmatter } from "@/core/frontmatter";
import { searchMemory } from "@/core/memory";
import type { NoteFrontmatter } from "@/core/types";
import { generateId } from "@/core/uuid";
import { closeDatabase, openDatabase } from "@/db/connection";
import type { TranslatorFn } from "@/db/reindex";
import { getNoteById } from "@/db/repository";
import { runMigrations } from "@/db/schema";
import { scanAndSync } from "@/db/sync";
import { type WatcherHandle, markWriteEnd, markWriteStart, startWatcher } from "@/watch";

// Phase-4 integration tests exercise the watcher end-to-end:
//   • fs.watch wired with the real recursive listener
//   • scanAndSync called via the default change handler
//   • SQLite + FTS5 schema migrated as in production
//   • searchMemory consulted to confirm user-visible indexing
//
// We deliberately put files at the vault root (not in YYYY/MM/DD/ as
// writeNote would) because Bun's fs.watch on macOS does not reliably deliver
// events for files in subdirectories created after the watcher started. The
// scanAndSync walk is recursive so a vault-root .md is treated identically
// to a nested one — the assertion coverage is unaffected.

const TEST_DEBOUNCE_MS = 100;
const SCAN_WAIT_MS = 900;
// macOS FSEvents drops events delivered before fs.watch has fully registered
// with the kernel. Production daemons run for hours and never see this, but
// isolated test runs lose the first event without the settle period.
const WATCHER_WARMUP_MS = 150;

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

async function writeNoteToVaultRoot(
  vaultPath: string,
  id: string,
  body: string,
  fmOverrides: Partial<NoteFrontmatter> = {}
): Promise<string> {
  const filePath = path.join(vaultPath, `${id}.md`);
  // Direct (non-atomic) writes keep each test operation to a single fs.watch
  // event; writeFileAtomic's tmp+rename dance would produce multiple events
  // whose delivery ordering varies across platforms.
  await fs.promises.writeFile(filePath, serializeFrontmatter(fm(fmOverrides), body));
  return filePath;
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// Bumps mtime well past `updated_at` so scanAndSync's diff predicate
// (mtime > updated_at) fires deterministically.
function bumpMtime(filePath: string, secondsFromNow = 600): void {
  const future = (Date.now() + secondsFromNow * 1000) / 1000;
  fs.utimesSync(filePath, future, future);
}

describe("watch integration", () => {
  let vaultPath: string;
  let db: Database;
  let handle: WatcherHandle | null;

  beforeEach(() => {
    vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "dennoh-watch-int-"));
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

  async function startForTest(
    overrides: { translate?: TranslatorFn | null; debounceMs?: number } = {}
  ): Promise<WatcherHandle> {
    const h = await startWatcher(vaultPath, db, {
      debounceMs: overrides.debounceMs ?? TEST_DEBOUNCE_MS,
      initializeTranslation: () => Promise.resolve(),
      translate: overrides.translate ?? null,
    });
    await waitMs(WATCHER_WARMUP_MS);
    return h;
  }

  describe("basic scenarios", () => {
    // FTS5 treats `-` as the NOT operator and `:` as a column qualifier, so
    // search keywords in these tests are deliberately plain tokens (no
    // hyphens, no colons, no quotes) — they go through MATCH unescaped.

    it("externally added .md surfaces via searchMemory", async () => {
      handle = await startForTest();
      const id = generateId();
      await writeNoteToVaultRoot(vaultPath, id, "alphakeyword body");
      await waitMs(SCAN_WAIT_MS);

      const results = searchMemory(db, "alphakeyword");
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(id);
    });

    it("external edit replaces the indexed content (old terms drop, new terms hit)", async () => {
      handle = await startForTest();
      const id = generateId();
      const filePath = await writeNoteToVaultRoot(vaultPath, id, "beforetoken body", {
        updatedAt: "2026-06-14T10:00:00+09:00",
      });
      await waitMs(SCAN_WAIT_MS);
      expect(searchMemory(db, "beforetoken")).toHaveLength(1);
      expect(searchMemory(db, "aftertoken")).toHaveLength(0);

      await writeNoteToVaultRoot(vaultPath, id, "aftertoken body", {
        updatedAt: "2026-06-14T11:00:00+09:00",
      });
      bumpMtime(filePath);
      await waitMs(SCAN_WAIT_MS);

      // Old content no longer matches; new content does — confirms the FTS
      // row was rewritten, not just supplemented with a duplicate entry.
      expect(searchMemory(db, "beforetoken")).toHaveLength(0);
      const after = searchMemory(db, "aftertoken");
      expect(after).toHaveLength(1);
      expect(after[0]?.id).toBe(id);
    });

    it("external deletion removes the row from searchMemory results", async () => {
      handle = await startForTest();
      const id = generateId();
      const filePath = await writeNoteToVaultRoot(vaultPath, id, "deletiontarget");
      await waitMs(SCAN_WAIT_MS);
      expect(searchMemory(db, "deletiontarget")).toHaveLength(1);

      await fs.promises.unlink(filePath);
      await waitMs(SCAN_WAIT_MS);

      expect(searchMemory(db, "deletiontarget")).toHaveLength(0);
    });

    it("writes wrapped by markWriteStart/markWriteEnd do not trigger the change handler", async () => {
      // The contract under test: when dennoh's own CRUD path writes a file,
      // the watcher must observe `isOwnWrite === true` for the duration of
      // the write and skip dispatching to onChange. We exercise this with the
      // marker primitives directly rather than full saveMemory so the test
      // doesn't pull in config / git / homedir setup. core/memory.ts uses
      // the same primitives, so the wired-up integration is covered by the
      // CRUD test suite.
      let onChangeCount = 0;
      handle = await startWatcher(vaultPath, db, {
        debounceMs: TEST_DEBOUNCE_MS,
        initializeTranslation: () => Promise.resolve(),
        translate: null,
        onChange: () => {
          onChangeCount++;
        },
      });
      await waitMs(WATCHER_WARMUP_MS);

      const id = generateId();
      const filePath = path.join(vaultPath, `${id}.md`);
      markWriteStart(filePath);
      try {
        await fs.promises.writeFile(filePath, serializeFrontmatter(fm(), "internal body"));
        await waitMs(SCAN_WAIT_MS);
      } finally {
        markWriteEnd(filePath);
      }

      expect(onChangeCount).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("handles a 0-byte .md file without halting subsequent indexing", async () => {
      handle = await startForTest();

      // scanAndSync reads the file and pipes it through parseFrontmatter,
      // which throws on empty input. The error lands in `errors[]` and the
      // walk continues — the empty file is simply not indexed.
      const emptyId = generateId();
      await fs.promises.writeFile(path.join(vaultPath, `${emptyId}.md`), "");
      await waitMs(SCAN_WAIT_MS);
      expect(getNoteById(db, emptyId)).toBeNull();

      // Watcher remains alive: a subsequent valid file still lands.
      const validId = generateId();
      await writeNoteToVaultRoot(vaultPath, validId, "post-empty body");
      await waitMs(SCAN_WAIT_MS);
      expect(getNoteById(db, validId)?.body).toBe("post-empty body");
    });

    it("indexes a note that lives several directories deep when the path exists at startup", async () => {
      // Pre-create the deep directory chain BEFORE startWatcher so macOS
      // FSEvents includes the leaf in the initial recursive registration —
      // subdirs created post-start would not deliver reliably on Bun's
      // current fs.watch backend (see writeNoteToVaultRoot comment).
      const deepDir = path.join(vaultPath, "a", "b", "c", "d", "e", "f");
      fs.mkdirSync(deepDir, { recursive: true });

      handle = await startForTest();

      const id = generateId();
      const deepFile = path.join(deepDir, `${id}.md`);
      await fs.promises.writeFile(deepFile, serializeFrontmatter(fm(), "deep body"));
      await waitMs(SCAN_WAIT_MS);

      const row = getNoteById(db, id);
      expect(row?.path).toBe(deepFile);
      expect(row?.body).toBe("deep body");
    });

    it("flushes separately when events fall outside the debounce window", async () => {
      // Spy on onChange so we can count flushes precisely. Phase 2 covers the
      // INSIDE-window coalescing case; this asserts the symmetric property
      // that gaps wider than `debounceMs` produce independent flushes rather
      // than continued coalescing.
      const debounceMs = 150;
      // Gap must exceed the debounce window AND fs.watch's own delivery
      // latency on macOS so the first timer actually has a chance to fire
      // before the second event arrives. 400ms is comfortably above both.
      const gapMs = 400;

      const flushes: string[] = [];
      handle = await startWatcher(vaultPath, db, {
        debounceMs,
        initializeTranslation: () => Promise.resolve(),
        translate: null,
        onChange: (absolutePath) => {
          flushes.push(absolutePath);
        },
      });
      await waitMs(WATCHER_WARMUP_MS);

      const id = generateId();
      const filePath = path.join(vaultPath, `${id}.md`);
      await fs.promises.writeFile(filePath, "v1");
      await waitMs(gapMs);
      await fs.promises.writeFile(filePath, "v2");
      // Wait through the second debounce + buffer.
      await waitMs(debounceMs + 300);

      const sameFile = flushes.filter((p) => p === filePath);
      expect(sameFile.length).toBeGreaterThanOrEqual(2);
    });

    it("keeps the watcher running and the row searchable when translation fails", async () => {
      // Translator always throws. scanAndSync stores body_en="" and pushes
      // into translationErrors; the watcher logs at warn level and continues.
      // We confirm the row is still indexed and searchable on the original
      // (untranslated) body, so search remains functional in the source
      // language even when the JA→EN pipeline is unavailable.
      const failingTranslator: TranslatorFn = () => Promise.reject(new Error("translator offline"));

      handle = await startForTest({ translate: failingTranslator });

      const id = generateId();
      await writeNoteToVaultRoot(vaultPath, id, "テスト用本文");
      await waitMs(SCAN_WAIT_MS);

      const row = getNoteById(db, id);
      expect(row?.body).toBe("テスト用本文");
      expect(row?.body_en).toBe("");

      // FTS still finds the row via the original body — translation is a
      // search-enhancement, not a precondition for indexability.
      const hits = searchMemory(db, "テスト用本文");
      expect(hits.some((h) => h.id === id)).toBe(true);
    });

    it("stop() during a pending debounce window leaves the DB untouched", async () => {
      // Wider debounce so the FS event has time to be enqueued before we
      // tear down the watcher mid-window. The contract: pending timers
      // cleared on stop() => scanAndSync never runs => DB is unchanged.
      handle = await startForTest({ debounceMs: 350 });

      const id = generateId();
      await writeNoteToVaultRoot(vaultPath, id, "should-not-land");
      await waitMs(120);

      handle.stop();
      handle = null;

      // Wait beyond the original debounce window plus a buffer; nothing
      // should fire because the timer was cleared on stop().
      await waitMs(500);
      expect(getNoteById(db, id)).toBeNull();
    });

    it("rejects when vaultPath does not exist", async () => {
      // fs.watch throws synchronously with ENOENT for a missing path; that
      // sync throw is converted to a Promise rejection by the async wrapper.
      // We feed it a separate in-memory DB so the test doesn't depend on a
      // real vault being present.
      const memoryDb = new Database(":memory:");
      try {
        const nonexistent = path.join(os.tmpdir(), "dennoh-int-no-such-dir-xyz");
        await expect(
          startWatcher(nonexistent, memoryDb, {
            debounceMs: TEST_DEBOUNCE_MS,
            initializeTranslation: () => Promise.resolve(),
            translate: null,
          })
        ).rejects.toThrow();
      } finally {
        memoryDb.close();
      }
    });
  });

  describe("conflict-copy exclusion", () => {
    it("scanAndSync skips cloud-sync conflict copies", async () => {
      const noTranslate: TranslatorFn = () => Promise.resolve("");
      // A real note and a conflict copy side by side at the vault root.
      const normalId = generateId();
      await writeNoteToVaultRoot(vaultPath, normalId, "normalkeyword body");
      // Valid frontmatter, but a conflict-tagged filename — it must never be read.
      await fs.promises.writeFile(
        path.join(vaultPath, "memo (conflicted copy).md"),
        serializeFrontmatter(fm(), "conflictkeyword body")
      );

      const result = await scanAndSync(db, vaultPath, noTranslate);

      // Only the real note is indexed; the conflict copy is invisible to search
      // and contributes nothing to the scan.
      expect(getNoteById(db, normalId)?.body).toBe("normalkeyword body");
      expect(searchMemory(db, "normalkeyword")).toHaveLength(1);
      expect(searchMemory(db, "conflictkeyword")).toHaveLength(0);
      expect(result.added).toBe(1);
    });

    it("the live watcher ignores a conflict copy created at runtime", async () => {
      handle = await startForTest();
      // Japanese Dropbox conflict form, created after the watcher is live.
      await fs.promises.writeFile(
        path.join(vaultPath, "draft (競合コピー).md"),
        serializeFrontmatter(fm(), "watchedconflict body")
      );
      await waitMs(SCAN_WAIT_MS);

      expect(searchMemory(db, "watchedconflict")).toHaveLength(0);
    });
  });
});
