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

export function buildNotePath(vaultPath: string, id: string, date: Date): string {
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
