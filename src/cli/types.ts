export type CliIO = {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
};
