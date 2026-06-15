import type { Database } from "bun:sqlite";
import * as fs from "node:fs";
import type { WatchEventType } from "node:fs";
import * as path from "node:path";

import { isNotePath } from "@/core/path";
import type { TranslatorFn } from "@/db/reindex";
import { type SyncResult, scanAndSync } from "@/db/sync";
import { log } from "@/log";
import { initializeTranslationModel, translateJaToEn } from "@/translate";

import { shouldIgnorePath } from "./ignore";
import { isOwnWrite } from "./pending-writes";

// Default debounce window per path. Coalesces bursts of fs.watch events for
// the same file — editor saves typically emit "write temp" + "rename" + a
// trailing "change" within a few tens of milliseconds, and we only need a
// single reconciliation per resulting file state. 300ms is comfortably wider
// than a typical editor write cycle while still feeling instantaneous to a
// human watching their note appear in search.
export const DEFAULT_DEBOUNCE_MS = 300;

// Called once per path after the debounce window collapses. The default
// installed below runs `scanAndSync` against the vault; tests can substitute
// a spy via `WatcherOptions.onChange` to observe filter / debounce behavior
// without exercising the full file-to-DB pipeline. Handlers may be sync
// (void) or async (Promise<void>); the timer adapter accepts both.
export type WatcherChangeHandler = (
  absolutePath: string,
  eventType: WatchEventType
) => void | Promise<void>;

export type WatcherOptions = {
  // Override the per-path debounce window. Tests use a short value (e.g. 50ms)
  // so the suite doesn't sit on real-time waits.
  debounceMs?: number;
  // DI for the translation model preloader. Tests pass a stub to avoid the
  // model download; production callers leave it unset.
  initializeTranslation?: () => Promise<void>;
  // JA→EN translator forwarded to `scanAndSync`.
  //   - undefined: use the production `translateJaToEn`
  //   - null:      explicit opt-out (no-op translator; body_en stays "")
  //   - function:  DI override (used by tests and offline deployments)
  // The null branch exists so callers who know the model is unavailable can
  // skip the cost up-front rather than wait for each translation to no-op
  // its way through the empty-string failure path.
  translate?: TranslatorFn | null;
  // Override the debounced change handler. The default runs scanAndSync;
  // tests inject a spy to observe filter / debounce behavior without
  // exercising the full file-to-DB pipeline.
  onChange?: WatcherChangeHandler;
};

export type WatcherHandle = {
  stop: () => void;
};

type PendingEntry = {
  eventType: WatchEventType;
  timer: ReturnType<typeof setTimeout>;
};

// Explicit no-op translator selected when `WatcherOptions.translate === null`.
// scanAndSync stores the returned string as `body_en`; "" is the established
// "not translated" sentinel used elsewhere in the pipeline (see
// translate/index.ts), so a null override produces the same DB shape as a
// disabled translation pipeline rather than carving out a new state.
const noopTranslate: TranslatorFn = () => Promise.resolve("");

function resolveTranslator(option: TranslatorFn | null | undefined): TranslatorFn {
  if (option === null) {
    return noopTranslate;
  }
  return option ?? translateJaToEn;
}

function logSyncResult(result: SyncResult): void {
  log.info("watcher: scanAndSync completed", {
    added: result.added,
    updated: result.updated,
    deleted: result.deleted,
  });
  // Per-file failures during the scan: kept at error level because they
  // indicate a row that the DB now disagrees with disk on (read failed, write
  // failed, parse failed). Subsequent scans will retry the same path.
  for (const e of result.errors) {
    log.error("watcher: scanAndSync per-file error", { path: e.path, error: e.message });
  }
  // Translation failures are warn-level — the row was still indexed with
  // body_en="" so search remains functional on the source-language body.
  // Distinguishing these from `errors` lets operational tooling separate
  // "translation outage" from "indexing failure".
  for (const t of result.translationErrors) {
    log.warn("watcher: scanAndSync translation failure", { path: t.path, error: t.message });
  }
}

// Single place where scanAndSync results / throws turn into log records.
// Centralizing the wrap-and-log keeps the chain in `createDefaultChangeHandler`
// straightforward (always-resolving) and means the log shape lives in one spot.
async function runScanAndSync(
  db: Database,
  vaultPath: string,
  translate: TranslatorFn
): Promise<void> {
  try {
    const result = await scanAndSync(db, vaultPath, translate);
    logSyncResult(result);
  } catch (err) {
    log.error("watcher: scanAndSync threw", {
      vaultPath,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Default change-handler factory.
//
// Serialization rationale: bun:sqlite runs in non-WAL mode (see
// db/connection.ts) so two interleaved transactions against the same handle
// can hit SQLITE_BUSY or produce partial-update windows. A burst of edits
// across multiple files would otherwise fire concurrent full-vault scans.
// A single-slot promise chain is sufficient because every scanAndSync call
// already reconciles the entire vault state — coalescing follow-ups into
// one trailing scan would be a valid optimization, but for v0.1 the simple
// chain is correct and easy to reason about.
function createDefaultChangeHandler(
  db: Database,
  vaultPath: string,
  translate: TranslatorFn
): WatcherChangeHandler {
  let scanChain: Promise<void> = Promise.resolve();
  return (absolutePath, eventType) => {
    log.debug("watcher: event flushed", { path: absolutePath, eventType });
    scanChain = scanChain.then(() => runScanAndSync(db, vaultPath, translate));
  };
}

export async function startWatcher(
  vaultPath: string,
  db: Database,
  options: WatcherOptions = {}
): Promise<WatcherHandle> {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const init = options.initializeTranslation ?? initializeTranslationModel;
  const translate = resolveTranslator(options.translate);
  const onChange = options.onChange ?? createDefaultChangeHandler(db, vaultPath, translate);

  // Pre-warm the translation model. Intentionally NOT awaited: startWatcher
  // must return promptly so the watcher starts receiving filesystem events
  // before the (potentially multi-second) cold-start model download finishes.
  // A failure here is logged at warn level and does not abort the watcher —
  // translation is a search enhancement; saves and indexing remain functional
  // without it (see translate/index.ts for the empty-string failure policy).
  //
  // Skip the preload entirely when the caller explicitly opted out via
  // `translate: null`. Downloading / loading a 300MB model that we are never
  // going to call is pure waste, and the spurious warning logs would mislead
  // operators investigating why translation appears broken.
  if (options.translate !== null) {
    void init().catch((err) => {
      const detail = err instanceof Error ? err.message : String(err);
      log.warn("watcher: translation model preload failed; continuing without translation", {
        error: detail,
      });
    });
  }

  // Map key is the absolute path; the watcher fires per-path callbacks, and
  // both isOwnWrite and the Phase 3 reconciliation reason in absolute paths.
  const pending = new Map<string, PendingEntry>();

  const enqueue = (eventType: WatchEventType, relativePath: string): void => {
    // Filtering runs BEFORE debouncing on purpose. If we deferred the checks
    // to the flush callback, every ignored-but-bursty source (e.g. .git
    // pack writes, editor swap files) would still allocate a timer and a Map
    // entry per event. Filtering here keeps the queue bounded to real notes.
    if (shouldIgnorePath(relativePath)) return;
    if (!isNotePath(relativePath)) return;

    const absolutePath = path.join(vaultPath, relativePath);

    // isOwnWrite is checked at event-arrival time, NOT at flush time:
    // core/memory.ts holds the marker through the full write → DB → git
    // sequence, so the fs.watch event (delivered within milliseconds of the
    // rename) reliably sees the marker set. By the time the 300ms debounce
    // would fire the marker has already been cleared, so re-checking inside
    // the timer callback would always read false and filter nothing useful.
    if (isOwnWrite(absolutePath)) return;

    const existing = pending.get(absolutePath);
    if (existing !== undefined) {
      clearTimeout(existing.timer);
    }
    const timer = setTimeout(() => {
      pending.delete(absolutePath);
      // Promise.resolve adapter accepts both sync handlers (void return) and
      // async ones (Promise return). The .catch is mandatory: a handler
      // rejection here would otherwise surface as an unhandled rejection on
      // the timer-callback boundary.
      void Promise.resolve(onChange(absolutePath, eventType)).catch((err) => {
        log.error("watcher: change handler threw", {
          path: absolutePath,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, debounceMs);
    pending.set(absolutePath, { eventType, timer });
  };

  const watcher = fs.watch(vaultPath, { recursive: true }, (eventType, filename) => {
    // filename can be null on some platforms / when only inode metadata
    // changed, and the empty-string case is the watched directory itself.
    // Either way there is no concrete path to reconcile.
    if (filename === null || filename === "") return;
    enqueue(eventType, filename);
  });

  // fs.watch is an EventEmitter and surfaces FS-level failures (permission
  // changes mid-flight, EBADF on unmount, kernel resource limits) through the
  // "error" event. Without a listener attached, Node / Bun treats it as
  // uncaught and terminates the process. The listener turns it into an error
  // log; the surrounding process decides whether to restart the watcher.
  watcher.on("error", (err) => {
    log.error("watcher: fs.watch error", {
      vaultPath,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return {
    stop: () => {
      watcher.close();
      // Pending timers must be cleared explicitly. Without this, a stop()
      // call inside the debounce window leaves setTimeout handles refed,
      // keeping the event loop alive past close() and firing stale handlers
      // against a now-detached watcher.
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
      }
      pending.clear();
    },
  };
}
