import { execFile } from 'node:child_process';

/** Runs a fixed system command (never built from user input) and returns stdout, or null on failure. */
export type CommandRunner = (bin: string, args: string[]) => Promise<string | null>;

export const runCommand: CommandRunner = (bin, args) =>
  new Promise((resolve) => {
    execFile(bin, args, { timeout: 8000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : stdout));
  });
