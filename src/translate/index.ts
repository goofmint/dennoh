import * as os from "node:os";
import * as path from "node:path";

import { env, pipeline } from "@huggingface/transformers";

// Cache resolution follows the de facto Hugging Face convention:
// `TRANSFORMERS_CACHE` > `HF_HOME` > `~/.cache/huggingface`. This is path
// discovery for an OS-managed cache directory, not a configuration fallback —
// the absence of an env override is the normal case for first-time setup.
const CACHE_DIR_DEFAULT = path.join(os.homedir(), ".cache", "huggingface");
const RESOLVED_CACHE_DIR =
  process.env.TRANSFORMERS_CACHE ?? process.env.HF_HOME ?? CACHE_DIR_DEFAULT;
env.cacheDir = RESOLVED_CACHE_DIR;

const MODEL_ID = "Xenova/opus-mt-ja-en";

// Hiragana / Katakana / Han (CJK Unified Ideographs) — opus-mt-ja-en is a
// JA→EN model; feeding it English-only content produces nonsense output. We
// gate on script detection so a call on plain English content is a no-op.
const HAS_JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

type TranslatorOutput = Array<{ translation_text: string }>;
type Translator = (text: string) => Promise<TranslatorOutput>;

let translatorPromise: Promise<Translator> | null = null;

// Runtime (not module-load) env check so tests can set the flag in their
// own setup and have it take effect for module-level imports already done.
function isDisabled(): boolean {
  return process.env.DENNOH_TRANSLATE_DISABLE === "1";
}

function logProgress(info: unknown): void {
  // The pipeline emits many fine-grained progress events while downloading
  // and loading model files. We only relay the coarse status transitions so
  // stderr stays usable; per-byte progress would flood the log.
  if (info !== null && typeof info === "object" && "status" in info) {
    const status = (info as { status: unknown }).status;
    if (status === "initiate" || status === "ready" || status === "done") {
      process.stderr.write(`[dennoh translate] ${JSON.stringify(info)}\n`);
    }
  }
}

function getTranslator(): Promise<Translator> {
  if (translatorPromise === null) {
    // Reset the singleton on rejection so the next call retries rather than
    // returning the same cached failure. Without this, a transient network
    // error during model download would permanently disable translation for
    // the lifetime of the process.
    translatorPromise = (
      pipeline("translation", MODEL_ID, {
        progress_callback: logProgress,
      }) as Promise<Translator>
    ).catch((e: unknown) => {
      translatorPromise = null;
      const detail = e instanceof Error ? e.message : String(e);
      throw new Error(`[dennoh translate] failed to load translation model: ${detail}`);
    });
  }
  return translatorPromise;
}

// Pre-warm the translation pipeline. Called from `dennoh init` so the model
// is cached before any save happens; can also be called explicitly from
// long-running processes. On successful return, `translateJaToEn` will not
// pay the model-load cost on its first call.
//
// Offline note: once the model files are in `RESOLVED_CACHE_DIR`,
// `@huggingface/transformers` will use the cached copy on subsequent runs
// without a network request. First-call success on an online machine is
// therefore enough to enable offline operation later.
export async function initializeTranslationModel(): Promise<void> {
  if (isDisabled()) {
    process.stderr.write("[dennoh translate] DENNOH_TRANSLATE_DISABLE=1; skipping model init\n");
    return;
  }
  await getTranslator();
}

// Translation policy:
//   - Returns "" when:
//       a) DENNOH_TRANSLATE_DISABLE=1 (explicit opt-out)
//       b) text contains no Japanese codepoints (nothing to translate)
//       c) any pipeline / runtime failure (logged to stderr)
//   - The (c) empty-string-on-failure path is an EXPLICIT product decision:
//     translation is a search-enhancement and a failed call must not block
//     note saves. This is a documented optional-feature absorption at the
//     boundary, not the kind of silent "とりあえず動く" fallback the
//     project policy forbids elsewhere.
export async function translateJaToEn(text: string): Promise<string> {
  if (isDisabled()) {
    return "";
  }
  if (!HAS_JAPANESE.test(text)) {
    return "";
  }
  try {
    const translator = await getTranslator();
    const out = await translator(text);
    const first = out[0]?.translation_text;
    if (typeof first !== "string") {
      process.stderr.write(
        `[dennoh translate] pipeline returned unexpected shape: ${JSON.stringify(out)}\n`
      );
      return "";
    }
    return first;

    const detail = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[dennoh translate] translation failed: ${detail}\n`);
    return "";
  }
}
