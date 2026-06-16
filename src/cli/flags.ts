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
// returning the last value seen (undefined if absent) and the remaining args.
// The space-separated form consumes the following token as the value; a
// trailing `--name` with no value yields undefined and is left for the caller
// to treat as a usage error if the value was required.
export function takeOption(
  args: string[],
  name: string
): { value: string | undefined; rest: string[] } {
  const rest: string[] = [];
  let value: string | undefined;
  const prefix = `${name}=`;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === name) {
      // `--name value`: the next token is the value, if there is one.
      const next = args[i + 1];
      if (next !== undefined) {
        value = next;
        i++;
      }
      continue;
    }
    if (arg.startsWith(prefix)) {
      // `--name=value`: the value is the remainder after `=`.
      value = arg.slice(prefix.length);
      continue;
    }
    rest.push(arg);
  }
  return { value, rest };
}
