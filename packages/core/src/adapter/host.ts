import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { NodeFs } from '../fs/node-fs';
import type { AdapterHost } from './types';

/**
 * Runs `cmd --version`-style probes with a hard timeout. Never throws. `cmd` and `args` must be
 * constants from adapter code, never user input, because Windows runs them through a shell.
 */
export function runVersion(cmd: string, args: string[], timeoutMs = 3000): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      // `shell` lets Windows resolve npm-style `.cmd` shims on PATH.
      execFile(
        cmd,
        args,
        { timeout: timeoutMs, windowsHide: true, shell: process.platform === 'win32' },
        (err, stdout) => resolve(err ? null : cleanVersion(stdout)),
      );
    } catch {
      resolve(null);
    }
  });
}

/**
 * Tools print their version differently — `2.1.282 (Claude Code)`, `codex-cli 0.156.1` — and the
 * UI shows it beside the tool's name, where repeating the name reads like a stutter. Keep the
 * number; keep the whole line only when there is no number to find.
 */
export function cleanVersion(stdout: string): string | null {
  const text = stdout.trim();
  if (!text) return null;
  return /\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?/.exec(text)?.[0] ?? text;
}

/** The real machine: NodeFs, the user's home, and process.env. */
export const nodeAdapterHost = (): AdapterHost => ({
  fs: new NodeFs(),
  home: homedir(),
  env: process.env,
  runVersion: (cmd, args) => runVersion(cmd, args),
});
