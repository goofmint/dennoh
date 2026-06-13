import * as path from "node:path";

export const DENNOH_DIR = ".dennoh";

const MD_EXT = ".md";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function buildNoteDir(vaultPath: string, date: Date): string {
  const yyyy = String(date.getFullYear());
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  return path.join(vaultPath, yyyy, mm, dd);
}

function assertSafeNoteId(id: string): void {
  if (id.length === 0) {
    throw new Error("Note id must not be empty.");
  }
  if (/[/\\\0]/.test(id)) {
    throw new Error(
      `Note id must not contain path separators or null bytes: ${JSON.stringify(id)}`
    );
  }
  if (id === "." || id === "..") {
    throw new Error(`Note id must not be a relative path segment: ${JSON.stringify(id)}`);
  }
}

export function buildNotePath(vaultPath: string, id: string, date: Date): string {
  assertSafeNoteId(id);
  return path.join(buildNoteDir(vaultPath, date), `${id}${MD_EXT}`);
}

export function isNotePath(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === MD_EXT;
}

export function parseIdFromPath(filePath: string): string | null {
  if (!isNotePath(filePath)) return null;
  const base = path.basename(filePath, path.extname(filePath));
  if (base.length === 0) return null;
  return base;
}
