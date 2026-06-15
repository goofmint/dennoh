export type { CliIO } from "./types";
export { configCommand, configGet, configList, configSet } from "./commands/config";
export { historyCommand } from "./commands/history";
export { restoreCommand } from "./commands/restore";
export { serveCommand } from "./commands/serve";
export { statusCommand } from "./commands/status";
export {
  type CloudMatch,
  type CloudService,
  type InitDeps,
  type PromptVaultPathFn,
  defaultPromptVaultPath,
  detectCloudSync,
  ensureVaultDirs,
  expandTilde,
  formatCloudWarning,
  initCommand,
  initGitRepo,
  resolveVaultPath,
  updateGitignore,
} from "./commands/init";
