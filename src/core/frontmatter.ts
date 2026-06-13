import { parse as yamlParse, stringify as yamlStringify } from "yaml";

import type { NoteFrontmatter, NoteSource } from "./types";

const DELIMITER = "---";

const ISO_8601_WITH_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|[+-]\d{2}:\d{2})$/;

function yearIsLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

function maxDaysForMonth(year: number, month: number): number {
  const daysInMonth = [31, yearIsLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return daysInMonth[month - 1] ?? 31;
}

function assertIsoWithOffset(value: string, field: string): void {
  const match = ISO_8601_WITH_OFFSET.exec(value);
  if (!match) {
    throw new Error(
      `Frontmatter '${field}' must be an ISO 8601 string with offset (got ${JSON.stringify(value)}).`
    );
  }

  const year = parseInt(match[1] ?? "", 10);
  const month = parseInt(match[2] ?? "", 10);
  const day = parseInt(match[3] ?? "", 10);
  const hour = parseInt(match[4] ?? "", 10);
  const minute = parseInt(match[5] ?? "", 10);
  const second = parseInt(match[6] ?? "", 10);
  const fraction = match[7]; // optional fractional seconds

  // Validate month
  if (month < 1 || month > 12) {
    throw new Error(`Frontmatter '${field}' is not a valid timestamp: ${JSON.stringify(value)}.`);
  }

  // Validate day
  const maxDay = maxDaysForMonth(year, month);
  if (day < 1 || day > maxDay) {
    throw new Error(`Frontmatter '${field}' is not a valid timestamp: ${JSON.stringify(value)}.`);
  }

  // Validate hour
  if (hour < 0 || hour > 23) {
    throw new Error(`Frontmatter '${field}' is not a valid timestamp: ${JSON.stringify(value)}.`);
  }

  // Validate minute
  if (minute < 0 || minute > 59) {
    throw new Error(`Frontmatter '${field}' is not a valid timestamp: ${JSON.stringify(value)}.`);
  }

  // Validate second
  if (second < 0 || second > 59) {
    throw new Error(`Frontmatter '${field}' is not a valid timestamp: ${JSON.stringify(value)}.`);
  }

  // Validate fractional seconds if present
  if (fraction !== undefined) {
    const fractionNum = parseInt(fraction, 10);
    if (Number.isNaN(fractionNum) || fractionNum < 0) {
      throw new Error(`Frontmatter '${field}' is not a valid timestamp: ${JSON.stringify(value)}.`);
    }
  }

  // Final check with Date.parse
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`Frontmatter '${field}' is not a valid timestamp: ${JSON.stringify(value)}.`);
  }
}

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
  assertIsoWithOffset(parsed.createdAt, "createdAt");
  if (typeof parsed.updatedAt !== "string") {
    throw new Error("Frontmatter must include an 'updatedAt' string in ISO 8601 format.");
  }
  assertIsoWithOffset(parsed.updatedAt, "updatedAt");
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
