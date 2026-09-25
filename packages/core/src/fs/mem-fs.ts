import { dirname, relative, resolve, sep } from 'node:path';
import { AmcError } from '../errors';
import type { DirEntry, FsPort, Stat } from './fs-port';

type Node = { kind: 'dir'; mtimeMs: number } | { kind: 'file'; data: Buffer; mtimeMs: number };

export interface FsOp {
  op: 'write' | 'rm' | 'rename' | 'mkdir';
  path: string;
  to?: string;
}

/**
 * In-memory FsPort for tests. Records every mutating operation in `ops` so safety tests can
 * assert exactly which paths were touched.
 */
export class MemFs implements FsPort {
  private readonly nodes = new Map<string, Node>();
  /** Simulated symlinks/junctions (link path → target), honoured only by `realpath`. */
  private readonly links = new Map<string, string>();
  private clock = 1;
  readonly ops: FsOp[] = [];

  constructor(files: Record<string, string | Buffer> = {}) {
    for (const [p, data] of Object.entries(files)) this.putSync(p, data);
  }

  /** Seeds a file without recording an op. */
  putSync(path: string, data: string | Buffer): void {
    const p = resolve(path);
    this.ensureDirs(dirname(p));
    this.nodes.set(p, { kind: 'file', data: Buffer.from(data), mtimeMs: this.clock++ });
  }

  /** Declares `path` a link to `target` for realpath checks (other ops don't follow it). */
  linkSync(path: string, target: string): void {
    this.links.set(resolve(path), resolve(target));
  }

  /** Snapshot of all files (absolute path → utf8 content), useful for before/after assertions. */
  dump(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [p, n] of [...this.nodes].sort(([a], [b]) => a.localeCompare(b))) {
      if (n.kind === 'file') out[p] = n.data.toString('utf8');
    }
    return out;
  }

  async readFile(path: string): Promise<Buffer> {
    const n = this.nodes.get(resolve(path));
    if (!n || n.kind !== 'file') throw new AmcError('FS_NOT_FOUND', `File not found: ${path}`);
    return Buffer.from(n.data);
  }

  async writeFileAtomic(path: string, data: Buffer | string): Promise<void> {
    const p = resolve(path);
    if (this.nodes.get(p)?.kind === 'dir') {
      throw new AmcError('FS_WRITE_FAILED', `Is a directory: ${path}`);
    }
    this.ops.push({ op: 'write', path: p });
    this.ensureDirs(dirname(p));
    this.nodes.set(p, { kind: 'file', data: Buffer.from(data), mtimeMs: this.clock++ });
  }

  async rm(path: string, opts?: { recursive?: boolean }): Promise<void> {
    const p = resolve(path);
    const n = this.nodes.get(p);
    if (!n) return;
    const children = this.descendants(p);
    if (n.kind === 'dir' && children.length > 0 && !opts?.recursive) {
      throw new Error(`ENOTEMPTY: ${path}`);
    }
    this.ops.push({ op: 'rm', path: p });
    for (const c of children) this.nodes.delete(c);
    this.nodes.delete(p);
  }

  async readdir(path: string, opts?: { recursive?: boolean }): Promise<DirEntry[]> {
    const p = resolve(path);
    if (this.nodes.get(p)?.kind !== 'dir') throw new AmcError('FS_NOT_FOUND', `No dir: ${path}`);
    return this.descendants(p)
      .map((c) => ({ rel: relative(p, c).split(sep).join('/'), node: this.nodes.get(c)! }))
      .filter(({ rel }) => opts?.recursive || !rel.includes('/'))
      .map(({ rel, node }) => ({ path: rel, kind: node.kind }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async stat(path: string): Promise<Stat | null> {
    const n = this.nodes.get(resolve(path));
    if (!n) return null;
    return { kind: n.kind, size: n.kind === 'file' ? n.data.length : 0, mtimeMs: n.mtimeMs };
  }

  async mkdirp(path: string): Promise<void> {
    const p = resolve(path);
    if (this.nodes.get(p)?.kind === 'dir') return;
    this.ops.push({ op: 'mkdir', path: p });
    this.ensureDirs(p);
  }

  async rename(from: string, to: string): Promise<void> {
    const src = resolve(from);
    const dst = resolve(to);
    const n = this.nodes.get(src);
    if (!n) throw new AmcError('FS_NOT_FOUND', `Not found: ${from}`);
    this.ops.push({ op: 'rename', path: src, to: dst });
    this.ensureDirs(dirname(dst));
    for (const c of this.descendants(src)) {
      this.nodes.set(dst + c.slice(src.length), this.nodes.get(c)!);
      this.nodes.delete(c);
    }
    this.nodes.delete(src);
    this.nodes.set(dst, n);
  }

  async realpath(path: string): Promise<string> {
    let p = resolve(path);
    for (let hops = 0; hops < 40; hops++) {
      const link = [...this.links.keys()]
        .filter((l) => p === l || p.startsWith(l + sep))
        .sort((a, b) => b.length - a.length)[0];
      if (!link) return p;
      p = this.links.get(link)! + p.slice(link.length);
    }
    throw new Error(`Too many links: ${path}`);
  }

  private descendants(dir: string): string[] {
    const prefix = dir.endsWith(sep) ? dir : dir + sep;
    return [...this.nodes.keys()].filter((k) => k.startsWith(prefix));
  }

  private ensureDirs(dir: string): void {
    let d = dir;
    while (!this.nodes.has(d)) {
      this.nodes.set(d, { kind: 'dir', mtimeMs: this.clock++ });
      const parent = dirname(d);
      if (parent === d) break;
      d = parent;
    }
  }
}
