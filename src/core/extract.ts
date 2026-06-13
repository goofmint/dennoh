const HASH_PATTERN = /#([\p{L}\p{N}_-]{2,200})(?![\p{L}\p{N}_-])/gu;
const AT_PATTERN = /@([\p{L}\p{N}_-]{2,200})(?![\p{L}\p{N}_-])/gu;
const URL_PATTERN = /https?:\/\/\S+/gu;
const HEADING_PATTERN = /^#(?= )/gmu;
const EMAIL_PATTERN = /[\w.-]+@[\w.-]+/gu;

function collectSkipPositions(body: string, marker: "#" | "@"): Set<number> {
  const skip = new Set<number>();

  if (marker === "#") {
    for (const match of body.matchAll(URL_PATTERN)) {
      if (match.index === undefined) {
        continue;
      }
      const url = match[0];
      const base = match.index;
      for (let i = 0; i < url.length; i++) {
        if (url[i] === "#") {
          skip.add(base + i);
        }
      }
    }
    for (const match of body.matchAll(HEADING_PATTERN)) {
      if (match.index === undefined) {
        continue;
      }
      skip.add(match.index);
    }
  } else {
    for (const match of body.matchAll(EMAIL_PATTERN)) {
      if (match.index === undefined) {
        continue;
      }
      const atIndex = match[0].indexOf("@");
      if (atIndex !== -1) {
        skip.add(match.index + atIndex);
      }
    }
  }

  return skip;
}

function extractWithSkip(body: string, pattern: RegExp, skip: Set<number>): string[] {
  const results: string[] = [];
  for (const match of body.matchAll(pattern)) {
    if (match.index === undefined) {
      continue;
    }
    if (skip.has(match.index)) {
      continue;
    }
    const value = match[1];
    if (value !== undefined && results.indexOf(value) === -1) {
      results.push(value);
    }
  }
  return results;
}

export function extractMentions(body: string): { projects: string[]; tags: string[] } {
  const hashSkip = collectSkipPositions(body, "#");
  const atSkip = collectSkipPositions(body, "@");

  return {
    projects: extractWithSkip(body, HASH_PATTERN, hashSkip),
    tags: extractWithSkip(body, AT_PATTERN, atSkip),
  };
}
