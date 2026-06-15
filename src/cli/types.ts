export type CliIO = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};

export function readError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
