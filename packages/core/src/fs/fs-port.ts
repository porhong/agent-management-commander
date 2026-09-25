/**
 * All core file I/O goes through FsPort so that core can run against an in-memory FS in tests
 * and so safety tests can observe every write (docs/plan/engineering-practices.md §5).
 * Paths are absolute, OS-native paths.
 */
export interface FsPort {
  readFile(path: string): Promise<Buffer>;
  /** Writes via a temp file in the same directory followed by rename; creates parent dirs. */
  writeFileAtomic(path: string, data: Buffer | string): Promise<void>;
  rm(path: string, opts?: { recursive?: boolean }): Promise<void>;
  /** Lists direct children, or all descendants (relative paths, `/`-separated) when recursive. */
  readdir(path: string, opts?: { recursive?: boolean }): Promise<DirEntry[]>;
  /** Returns null when the path does not exist. */
  stat(path: string): Promise<Stat | null>;
  mkdirp(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /**
   * Canonical path with symlinks and junctions resolved. Works for paths that don't exist yet by
   * resolving the deepest existing ancestor, so write targets can be checked before writing (S4).
   */
  realpath(path: string): Promise<string>;
}

export interface DirEntry {
  /** Relative to the listed directory, always `/`-separated. */
  path: string;
  kind: 'file' | 'dir' | 'symlink';
}

export interface Stat {
  kind: 'file' | 'dir' | 'symlink';
  size: number;
  mtimeMs: number;
}
