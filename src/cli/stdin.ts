// Read the whole of stdin to a string for the data-entry commands
// (`add` / `update`) when content is piped instead of passed as an argument.
//
// Callers gate this behind `process.stdin.isTTY !== true`: `isTTY` is `true`
// only for an interactive terminal and `undefined` for a pipe (never `false`),
// so `!== true` is what detects piped/redirected input. When stdin is a
// terminal there is no piped payload, so reading would block forever waiting
// for the user to type EOF. The TTY check is the caller's responsibility, not
// this helper's, so the function stays a plain "drain stdin" primitive.
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
