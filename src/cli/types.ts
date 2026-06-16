export type CliIO = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

// CLI process exit codes. The three-way split lets scripts distinguish a
// caller mistake from an environmental/internal failure:
//   0 — success
//   1 — user error: bad/missing arguments, unknown id, content validation,
//       unknown command. The user can fix the invocation and retry.
//   2 — internal error: the database could not be opened, or an unexpected
//       exception escaped. Not the caller's fault; usually needs operator
//       attention (permissions, disk, a bug).
export const EXIT_SUCCESS = 0;
export const EXIT_USER_ERROR = 1;
export const EXIT_INTERNAL_ERROR = 2;

// Normalize an unknown caught value into a printable message: an Error instance
// surfaces its `.message`, anything else is coerced via String(). Shared by the
// CLI commands so every `catch (e)` renders consistent, human-readable stderr.
export function readError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// The core update/delete helpers throw a plain Error whose message contains
// "not found or already deleted" when an id does not resolve to a live note.
// `update`/`delete` pre-check existence for the common case, but the note can
// be removed in the TOCTOU window between that check and the mutation; this
// predicate lets the catch path still classify that race as a user error
// (exit 1) rather than an internal one (exit 2). It deliberately matches only
// the not-found phrasing, so a mid-mutation failure (e.g. a git error after a
// soft delete) still falls through to the internal-error code.
export function isNotFoundError(e: unknown): boolean {
  return e instanceof Error && /not found or already deleted/.test(e.message);
}
