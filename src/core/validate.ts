import { Buffer } from "node:buffer";

// Stable identifiers consumed by the future i18n layer to localize messages.
// Kept as a string union so downstream `instanceof + code` checks are exhaustive.
export type ContentValidationCode = "validate.content.binary" | "validate.content.too_large";

// Custom Error subclass to carry a machine-readable `code` and structured
// `details`. The project guideline permits extending Error specifically for
// this kind of instanceof-based handling; the i18n layer keys off `code` while
// the English `.message` stays as a useful fallback for logs and stderr.
export class ContentValidationError extends Error {
  readonly code: ContentValidationCode;
  readonly details: Record<string, number>;

  constructor(code: ContentValidationCode, message: string, details: Record<string, number> = {}) {
    super(message);
    this.name = "ContentValidationError";
    this.code = code;
    this.details = details;
  }
}

// Lightweight pre-write validator. Two responsibilities:
//   1. Reject binary blobs — a stray NULL byte in user-supplied "text" almost
//      always indicates a paste from a non-text source (image bytes, an opened
//      DB file, etc.). Catching it here keeps it out of FTS and out of git.
//   2. Cap file size — user-supplied content above the configured ceiling is
//      refused outright rather than streamed; the cap is passed in (sourced
//      from Config.maxFileSizeBytes) so tests can drive it deterministically.
//
// Throws `ContentValidationError` with a stable `code` so callers — and the
// i18n layer — can react without parsing the message string.
export function validateContent(content: string, maxSizeBytes: number): void {
  if (content.includes("\0")) {
    throw new ContentValidationError(
      "validate.content.binary",
      "Content contains a NULL byte, which is not allowed in note bodies."
    );
  }

  const sizeBytes = Buffer.byteLength(content, "utf8");
  if (sizeBytes > maxSizeBytes) {
    throw new ContentValidationError(
      "validate.content.too_large",
      `Content size ${sizeBytes} bytes exceeds the configured maximum of ${maxSizeBytes} bytes.`,
      { sizeBytes, maxSizeBytes }
    );
  }
}
