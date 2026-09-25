import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { AmcError } from '../errors';
import type { DirEntry, FsPort, Stat } from './fs-port';

/** Windows commonly reports these transiently when antivirus/indexers hold a file. */
const RETRYABLE = new Set(['EBUSY', 'EPERM', 'EACCES']);

async function withRetry<T>(op: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await op();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (i >= attempts - 1 || !code || !RETRYABLE.has(code)) throw err;
      await new Promise((r) => setTimeout(r, 25 * 2 ** i));
    }
  }
}

const kindOf = (s: {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}): DirEntry['kind'] => (s.isSymbolicLink() ? 'symlink' : s.isDirectory() ? 'dir' : 'file');

export class NodeFs implements FsPort {
  async readFile(path: string): Promise<Buffer> {
    try {
      return await fs.readFile(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new AmcError('FS_NOT_FOUND', `File not found: ${path}`);
      }
      throw err;
    }
  }

  async writeFileAtomic(path: string, data: Buffer | string): Promise<void> {
    const dir = dirname(path);
    await fs.mkdir(dir, { recursive: true });
    const tmp = join(dir, `.${basename(path)}.amc-tmp-${randomBytes(6).toString('hex')}`);
    try {
      await fs.writeFile(tmp, data);
      await withRetry(() => fs.rename(tmp, path));
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw new AmcError('FS_WRITE_FAILED', `Failed to write ${path}`, err);
    }
  }

  async rm(path: string, opts?: { recursive?: boolean }): Promise<void> {
    await withRetry(() => fs.rm(path, { force: true, recursive: opts?.recursive ?? false }));
  }

  async readdir(path: string, opts?: { recursive?: boolean }): Promise<DirEntry[]> {
    const entries = await fs.readdir(path, {
      withFileTypes: true,
      recursive: opts?.recursive ?? false,
    });
    return entries
      .map((e) => ({
        path: relative(path, join(e.parentPath, e.name)).split(sep).join('/'),
        kind: kindOf(e),
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async stat(path: string): Promise<Stat | null> {
    try {
      const s = await fs.lstat(path);
      return { kind: kindOf(s), size: s.size, mtimeMs: s.mtimeMs };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async mkdirp(path: string): Promise<void> {
    await fs.mkdir(path, { recursive: true });
  }

  async rename(from: string, to: string): Promise<void> {
    await fs.mkdir(dirname(to), { recursive: true });
    await withRetry(() => fs.rename(from, to));
  }

  async realpath(path: string): Promise<string> {
    const missing: string[] = [];
    let p = resolve(path);
    for (;;) {
      try {
        return join(await fs.realpath(p), ...missing.reverse());
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        const parent = dirname(p);
        if (parent === p) return resolve(path);
        missing.push(basename(p));
        p = parent;
      }
    }
  }
}
