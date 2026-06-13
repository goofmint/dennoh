export type { CliIO } from "./types";
export { configCommand, configGet, configList, configSet } from "./commands/config";
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
