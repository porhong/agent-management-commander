import { mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isAmcError } from '../errors';
import type { FsPort } from './fs-port';
import { MemFs } from './mem-fs';
import { NodeFs } from './node-fs';
import { detectEol, safeJoin, sha256, stripBom, withEol } from './text';

// One contract suite, run against both implementations, keeps MemFs honest.
const impls: Array<
  [string, () => Promise<{ fs: FsPort; root: string; cleanup(): Promise<void> }>]
> = [
  [
    'NodeFs',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'amc-fs-'));
      return { fs: new NodeFs(), root, cleanup: () => rm(root, { recursive: true, force: true }) };
    },
  ],
  [
    'MemFs',
    async () => {
      const root = join(tmpdir(), 'amc-mem-root');
      const fs = new MemFs();
      await fs.mkdirp(root);
      return { fs, root, cleanup: async () => undefined };
    },
  ],
];

describe.each(impls)('FsPort contract: %s', (_name, make) => {
  let fs: FsPort;
  let root: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ fs, root, cleanup } = await make());
  });
  afterEach(() => cleanup());

  it('writes atomically, creating parent dirs, and reads back', async () => {
    const p = join(root, 'a', 'b', 'file.md');
    await fs.writeFileAtomic(p, 'hello');
    expect((await fs.readFile(p)).toString()).toBe('hello');
    await fs.writeFileAtomic(p, 'replaced');
    expect((await fs.readFile(p)).toString()).toBe('replaced');
  });

  it('leaves no temp files behind', async () => {
    await fs.writeFileAtomic(join(root, 'x.md'), '1');
    expect(await fs.readdir(root)).toEqual([{ path: 'x.md', kind: 'file' }]);
  });

  it('throws FS_NOT_FOUND for missing files and returns null stat', async () => {
    await expect(fs.readFile(join(root, 'nope'))).rejects.toSatisfy((e) =>
      isAmcError(e, 'FS_NOT_FOUND'),
    );
    expect(await fs.stat(join(root, 'nope'))).toBeNull();
  });

  it('lists recursively with / separators, sorted', async () => {
    await fs.writeFileAtomic(join(root, 'skills', 's1', 'SKILL.md'), 'x');
    await fs.writeFileAtomic(join(root, 'agents', 'a.md'), 'y');
    const all = await fs.readdir(root, { recursive: true });
    expect(all).toEqual([
      { path: 'agents', kind: 'dir' },
      { path: 'agents/a.md', kind: 'file' },
      { path: 'skills', kind: 'dir' },
      { path: 'skills/s1', kind: 'dir' },
      { path: 'skills/s1/SKILL.md', kind: 'file' },
    ]);
    expect(await fs.readdir(root)).toEqual([
      { path: 'agents', kind: 'dir' },
      { path: 'skills', kind: 'dir' },
    ]);
  });

  it('renames directories with their contents', async () => {
    await fs.writeFileAtomic(join(root, 'old', 'f.md'), 'z');
    await fs.rename(join(root, 'old'), join(root, 'new'));
    expect(await fs.stat(join(root, 'old'))).toBeNull();
    expect((await fs.readFile(join(root, 'new', 'f.md'))).toString()).toBe('z');
  });

  it('removes files and directories recursively; rm of missing path is a no-op', async () => {
    await fs.writeFileAtomic(join(root, 'd', 'f.md'), 'z');
    await fs.rm(join(root, 'd'), { recursive: true });
    expect(await fs.stat(join(root, 'd'))).toBeNull();
    await expect(fs.rm(join(root, 'missing'))).resolves.toBeUndefined();
  });
});

describe('realpath (S4)', () => {
  it('NodeFs resolves junctions, including for paths that do not exist yet', async () => {
    const root = await mkdtemp(join(tmpdir(), 'amc-real-'));
    try {
      const fs = new NodeFs();
      const outside = join(root, 'outside');
      await fs.mkdirp(outside);
      await symlink(outside, join(root, 'link'), 'junction');
      const real = await fs.realpath(join(root, 'link', 'new', 'file.md'));
      expect(real).toBe(join(await realpath(outside), 'new', 'file.md'));
      expect(await fs.realpath(join(root, 'missing', 'x'))).toBe(
        join(await realpath(root), 'missing', 'x'),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('MemFs honours simulated links for realpath only', async () => {
    const fs = new MemFs();
    fs.linkSync(join('/', 'a', 'link'), join('/', 'b'));
    expect(await fs.realpath(join('/', 'a', 'link', 'x'))).toBe(resolve('/', 'b', 'x'));
    expect(await fs.realpath(join('/', 'a', 'linkage'))).toBe(resolve('/', 'a', 'linkage'));
  });
});

describe('MemFs op log', () => {
  it('records mutations but not seeds', async () => {
    const fs = new MemFs({ [join(tmpdir(), 'seed.md')]: 'seed' });
    await fs.writeFileAtomic(join(tmpdir(), 'w.md'), 'w');
    expect(fs.ops).toEqual([{ op: 'write', path: join(tmpdir(), 'w.md') }]);
  });
});

describe('text helpers', () => {
  it('detects and converts line endings', () => {
    expect(detectEol('a\r\nb\r\nc')).toBe('\r\n');
    expect(detectEol('a\nb')).toBe('\n');
    expect(detectEol('single')).toBe('\n');
    expect(withEol('a\nb\r\nc', '\r\n')).toBe('a\r\nb\r\nc');
    expect(withEol('a\r\nb', '\n')).toBe('a\nb');
  });

  it('strips BOM and hashes deterministically', () => {
    expect(stripBom('﻿hi')).toBe('hi');
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('safeJoin blocks traversal and absolute paths (S4)', () => {
    const root = join(tmpdir(), 'target');
    expect(safeJoin(root, 'skills/x/SKILL.md')).toBe(join(root, 'skills', 'x', 'SKILL.md'));
    for (const bad of ['../evil', 'skills/../../evil', join(tmpdir(), 'abs'), '.', '']) {
      expect(() => safeJoin(root, bad)).toThrow(/root|Absolute/);
    }
  });
});
