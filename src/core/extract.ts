// Main extraction patterns. The negative lookahead enforces the upper bound:
// a 201-character run does not match a {2,200} capture truncated to 200, it
// matches nothing — so over-length identifiers are rejected, not silently cut.
const HASH_PATTERN = /#([\p{L}\p{N}_-]{2,200})(?![\p{L}\p{N}_-])/gu;
const AT_PATTERN = /@([\p{L}\p{N}_-]{2,200})(?![\p{L}\p{N}_-])/gu;
// False-positive sources scanned in the pre-pass.
const URL_PATTERN = /https?:\/\/\S+/gu;
const HEADING_PATTERN = /^#(?= )/gmu;
const EMAIL_PATTERN = /[\w.-]+@[\w.-]+/gu;

function collectSkipPositions(body: string, marker: "#" | "@"): Set<number> {
  const skip = new Set<number>();

  if (marker === "#") {
    // URL fragments: every "#" inside an `https?://...` token is a false
    // positive (e.g. `https://example.com#foo` or `https://a#b#c`). Walk each
    // URL match character-by-character and record every "#" position — this
    // handles multi-fragment URLs that a single-anchor regex would miss.
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
    // Markdown headings: `# H1` at line start is heading syntax, not a tag.
    // HEADING_PATTERN already anchors to line start with `m` flag and requires
    // a following space via lookahead, so match.index is exactly the "#" pos.
    for (const match of body.matchAll(HEADING_PATTERN)) {
      if (match.index === undefined) {
        continue;
      }
      skip.add(match.index);
    }
  } else {
    // Email addresses: the "@" in `user@example.com` is not a tag marker.
    // EMAIL_PATTERN matches the full token (local + "@" + domain); we add the
    // offset of the "@" within the match, not match.index (which points at the
    // local part). indexOf is safe — the pattern guarantees "@" is present.
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
