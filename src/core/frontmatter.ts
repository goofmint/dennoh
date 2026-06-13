import { parse as yamlParse, stringify as yamlStringify } from "yaml";

import type { NoteFrontmatter, NoteSource } from "./types";

const DELIMITER = "---";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function isoWithLocalOffset(date: Date): string {
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const offsetH = pad2(Math.floor(abs / 60));
  const offsetM = pad2(abs % 60);
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}` +
    `${sign}${offsetH}:${offsetM}`
  );
}

export function serializeFrontmatter(frontmatter: NoteFrontmatter, body: string): string {
  const obj: NoteFrontmatter = {
    createdAt: frontmatter.createdAt,
    updatedAt: frontmatter.updatedAt,
    source: frontmatter.source,
    ...(frontmatter.title !== undefined ? { title: frontmatter.title } : {}),
    projects: frontmatter.projects,
    tags: frontmatter.tags,
  };
  const yaml = yamlStringify(obj);
  return `${DELIMITER}\n${yaml}${DELIMITER}\n\n${body}`;
}

export function parseFrontmatter(content: string): {
  frontmatter: NoteFrontmatter;
  body: string;
} {
  const normalized = content.replace(/\r\n/g, "\n");

  if (!normalized.startsWith(`${DELIMITER}\n`)) {
    throw new Error("Frontmatter delimiter '---' not found at the start of the file.");
  }

  const afterOpening = normalized.slice(DELIMITER.length + 1);
  const closingIdx = afterOpening.indexOf(`\n${DELIMITER}`);
  if (closingIdx === -1) {
    throw new Error("Closing frontmatter delimiter '---' not found.");
  }

  const yamlSource = afterOpening.slice(0, closingIdx);
  let body = afterOpening.slice(closingIdx + 1 + DELIMITER.length);
  // Skip the newline that terminates the closing delimiter line.
  if (body.startsWith("\n")) {
    body = body.slice(1);
  }
  // Skip a single blank-line separator (the standard frontmatter convention).
  if (body.startsWith("\n")) {
    body = body.slice(1);
  }

  const parsed = (() => {
    try {
      return yamlParse(yamlSource);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      throw new Error(`Invalid YAML in frontmatter: ${detail}`);
    }
  })();

  if (
    parsed === null ||
    parsed === undefined ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new Error("Frontmatter must be a non-empty YAML mapping.");
  }

  if (typeof parsed.createdAt !== "string") {
    throw new Error("Frontmatter must include a 'createdAt' string in ISO 8601 format.");
  }
  if (typeof parsed.updatedAt !== "string") {
    throw new Error("Frontmatter must include an 'updatedAt' string in ISO 8601 format.");
  }
  if (parsed.source !== undefined && parsed.source !== "note") {
    throw new Error(`Unsupported source: ${String(parsed.source)}`);
  }
  const source: NoteSource = "note";

  const projects: string[] = [];
  if (parsed.projects !== undefined) {
    if (!Array.isArray(parsed.projects)) {
      throw new Error("Frontmatter 'projects' must be a YAML sequence.");
    }
    for (const item of parsed.projects) {
      if (typeof item !== "string") {
        throw new Error("Frontmatter 'projects' must contain only strings.");
      }
      projects.push(item);
    }
  }

  const tags: string[] = [];
  if (parsed.tags !== undefined) {
    if (!Array.isArray(parsed.tags)) {
      throw new Error("Frontmatter 'tags' must be a YAML sequence.");
    }
    for (const item of parsed.tags) {
      if (typeof item !== "string") {
        throw new Error("Frontmatter 'tags' must contain only strings.");
      }
      tags.push(item);
    }
  }

  const frontmatter: NoteFrontmatter = {
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
    source,
    projects,
    tags,
  };
  if (typeof parsed.title === "string") {
    frontmatter.title = parsed.title;
  }

  return { frontmatter, body };
}

export type UpdateFrontmatterOptions = {
  bumpUpdatedAt?: boolean;
};

export function updateFrontmatter(
  existing: NoteFrontmatter,
  updates: Partial<NoteFrontmatter>,
  options: UpdateFrontmatterOptions = {}
): NoteFrontmatter {
  const next: NoteFrontmatter = {
    ...existing,
    ...updates,
    createdAt: existing.createdAt,
  };
  if (options.bumpUpdatedAt) {
    next.updatedAt = isoWithLocalOffset(new Date());
  }
  return next;
}
