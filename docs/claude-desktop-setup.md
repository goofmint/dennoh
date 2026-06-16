# Connecting dennoh to Claude Desktop

`dennoh serve` runs an [MCP](https://modelcontextprotocol.io) server over stdio,
exposing seven tools (`save_memory`, `update_memory`, `delete_memory`,
`search_memory`, `list_recent`, `get_note`, `status`). This guide wires it into
Claude Desktop.

## Prerequisites

1. Install dependencies (from the repo root):

   ```sh
   bun install
   ```

2. Initialize a vault and write the dennoh config. This creates the vault
   directory, a git repo, and `~/Library/Application Support/dennoh/config.json`
   (which `serve` reads to find your vault):

   ```sh
   bun run src/cli/main.ts init
   ```

   `dennoh serve` does **not** take the vault path as an argument — it always
   reads it from that config file, so `init` must run first.

## Configure Claude Desktop

Claude Desktop reads MCP servers from:

```text
~/Library/Application Support/Claude/claude_desktop_config.json
```

Add a `dennoh` entry under `mcpServers`. Use an **absolute path** to this
repository — Claude Desktop launches the command from its own working
directory, so relative paths will not resolve.

### Option A — run from source (development)

```json
{
  "mcpServers": {
    "dennoh": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/dennoh/src/cli/main.ts", "serve"]
    }
  }
}
```

### Option B — run a built bundle

Build a single-file bundle first:

```sh
bun run build   # emits dist/cli.js
```

```json
{
  "mcpServers": {
    "dennoh": {
      "command": "bun",
      "args": ["/absolute/path/to/dennoh/dist/cli.js", "serve"]
    }
  }
}
```

Notes:

- `command` must be resolvable on Claude Desktop's `PATH` (use the absolute path
  to `bun` — e.g. `/Users/you/.bun/bin/bun` — if `bun` is not found).
- No `env` block is required: `serve` locates the vault through the config file
  under your home directory. To force a language, add
  `"env": { "DENNOH_LANG": "en" }`.
- stdout carries only the JSON-RPC protocol stream; all logs go to stderr, so
  they will not corrupt the MCP connection.

Restart Claude Desktop after editing the file so it re-reads the config.

## Verify it works

1. Open Claude Desktop. The `dennoh` tools should appear in the tools menu
   (the hammer/▶ icon). If they do not, check Claude Desktop's MCP logs at
   `~/Library/Logs/Claude/`.

2. Ask Claude to save something, e.g.:

   > Save a memory: "Trying out dennoh #demo @setup"

   Claude calls `save_memory`, which returns the new note's metadata.

3. Confirm the markdown file was created on disk. Notes live under
   `<vault>/YYYY/MM/DD/<uuid>.md`:

   ```sh
   # Replace <vault> with your configured vaultPath
   ls "<vault>/$(date +%Y/%m/%d)/"
   cat "<vault>/$(date +%Y/%m/%d)/"*.md
   ```

   You should see the note with YAML frontmatter (`createdAt`, `updatedAt`,
   `source`, `projects`, `tags`) followed by your text. The `#demo` mention is
   captured under `projects` and `@setup` under `tags`.

4. (Optional) Ask Claude to `search_memory` for `demo` or call `status` to see
   the indexed note count.

## Troubleshooting

- **Tools don't appear / server fails to start** — run the same command in a
  terminal to see the error on stderr:

  ```sh
  echo '' | bun run /absolute/path/to/dennoh/src/cli/main.ts serve
  ```

  A `dennoh config not found …` message means `init` has not been run.

- **`bun: command not found` in Claude Desktop** — set `command` to the absolute
  path of the `bun` binary (`which bun`).
