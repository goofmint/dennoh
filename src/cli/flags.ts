// Minimal flag parsing shared by the read-side CLI commands. These commands
// take a mix of positional arguments and `--flag` / `--option value` tokens;
// rather than pull in a parser dependency, each command pulls the flags it
// knows about off the arg list and treats whatever remains as positionals.
//
// Both `--name value` and `--name=value` spellings are accepted so the
// commands behave the way users expect regardless of which form they type.

// Remove every occurrence of a boolean flag (e.g. `--json`) from `args`.
// Returns whether it was present at least once and the remaining args.
export function takeBooleanFlag(
  args: string[],
  name: string
): { present: boolean; rest: string[] } {
  const rest: string[] = [];
  let present = false;
  for (const arg of args) {
    if (arg === name) {
      present = true;
      continue;
    }
    rest.push(arg);
  }
  return { present, rest };
}

// Remove a valued option (e.g. `--limit 20` or `--limit=20`) from `args`,
// returning the last value seen (undefined if absent), whether the option token
// appeared at all (`present`), and the remaining args.
//
// `present` lets callers distinguish "flag absent" from "flag given without a
// value" so the latter can be reported as a usage error instead of silently
// falling back to a default.
//
// In the space-separated form the next token is taken as the value ONLY when it
// is not itself a flag (does not start with `-`). A `-`-prefixed next token (or
// end of args) means the value was omitted: it is left in place so the
// following option / positional still sees it, and `value` stays undefined. A
// negative numeric value must therefore use the `--name=-3` form.
export function takeOption(
  args: string[],
  name: string
): { value: string | undefined; present: boolean; rest: string[] } {
  const rest: string[] = [];
  let value: string | undefined;
  let present = false;
  const prefix = `${name}=`;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === name) {
      present = true;
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        value = next;
        i++;
      }
      continue;
    }
    if (arg.startsWith(prefix)) {
      // `--name=value`: the value is the remainder after `=` (may be empty).
      present = true;
      value = arg.slice(prefix.length);
      continue;
    }
    rest.push(arg);
  }
  return { value, present, rest };
}
