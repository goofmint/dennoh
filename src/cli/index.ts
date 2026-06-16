export type { CliIO } from "./types";
export { EXIT_INTERNAL_ERROR, EXIT_SUCCESS, EXIT_USER_ERROR } from "./types";
export { addCommand } from "./commands/add";
export { configCommand, configGet, configList, configSet } from "./commands/config";
export { deleteCommand } from "./commands/delete";
export { getCommand } from "./commands/get";
export { historyCommand } from "./commands/history";
export { recentCommand } from "./commands/recent";
export { reindexCommand } from "./commands/reindex";
export { restoreCommand } from "./commands/restore";
export { searchCommand } from "./commands/search";
export { updateCommand } from "./commands/update";
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
