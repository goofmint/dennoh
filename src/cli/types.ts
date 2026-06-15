export type CliIO = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

// Normalize an unknown caught value into a printable message: an Error instance
// surfaces its `.message`, anything else is coerced via String(). Shared by the
// CLI commands so every `catch (e)` renders consistent, human-readable stderr.
export function readError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
