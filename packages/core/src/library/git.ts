import * as nodeFs from 'node:fs';
import git from 'isomorphic-git';
import { AmcError } from '../errors';

/** One commit in the library history. */
export interface HistoryEntry {
  rev: string;
  /** First line of the commit message. */
  summary: string;
  /** ISO timestamp of the commit. */
  timestamp: string;
  /** Items named in `Amc-Item:` trailers; empty for commits made outside AMC. */
  itemIds: string[];
}

/**
 * Version history of the library folder. LibraryService depends on this interface (not on git
 * directly) so it can run against MemFs in tests with `NoHistory`.
 * All paths are library-relative and `/`-separated.
 */
export interface LibraryHistory {
  /** Stages every change under `paths` (adds, edits, deletions) and commits. Null if no change. */
  commit(paths: string[], message: string, itemIds: string[]): Promise<string | null>;
  /** Newest first. Filters by a path prefix and/or by the item trailer. */
  log(filter?: { path?: string; itemId?: string }): Promise<HistoryEntry[]>;
  /** All files under `path` at `rev`, keyed by path relative to `path`. Empty if absent. */
  readDir(rev: string, path: string): Promise<Record<string, Buffer>>;
}

export const NoHistory: LibraryHistory = {
  commit: async () => null,
  log: async () => [],
  readDir: async () => ({}),
};

const TRAILER = 'Amc-Item';
const trailerIds = (message: string): string[] =>
  [...message.matchAll(new RegExp(`^${TRAILER}: (\\S+)$`, 'gm'))].map((m) => m[1]!);

const under = (file: string, prefix: string): boolean =>
  prefix === '' || file === prefix || file.startsWith(prefix + '/');

export interface GitAuthor {
  name: string;
  email: string;
}

/**
 * LibraryHistory backed by isomorphic-git, so users don't need git installed. This is the one
 * place core touches the disk without FsPort: isomorphic-git needs a full node-style fs client.
 */
export class GitService implements LibraryHistory {
  constructor(
    private readonly dir: string,
    private readonly author: GitAuthor = { name: 'AMC', email: 'amc@localhost' },
    private readonly fs: typeof nodeFs = nodeFs,
  ) {}

  /** Initializes the repo if needed. Idempotent. */
  async init(): Promise<void> {
    await this.run('init', () => git.init({ fs: this.fs, dir: this.dir, defaultBranch: 'main' }));
  }

  async commit(paths: string[], message: string, itemIds: string[]): Promise<string | null> {
    return this.run('commit', async () => {
      const rows = await git.statusMatrix({ fs: this.fs, dir: this.dir, filepaths: paths });
      let changed = false;
      for (const [filepath, head, workdir, stage] of rows) {
        if (workdir === 0) {
          if (head === 0 && stage === 0) continue;
          await git.remove({ fs: this.fs, dir: this.dir, filepath });
          changed ||= head === 1;
        } else {
          if (stage !== (workdir === 1 ? 1 : 2)) {
            await git.add({ fs: this.fs, dir: this.dir, filepath });
          }
          changed ||= workdir === 2;
        }
      }
      if (!changed) return null;
      const trailers = itemIds.map((id) => `${TRAILER}: ${id}`).join('\n');
      return git.commit({
        fs: this.fs,
        dir: this.dir,
        author: this.author,
        message: trailers ? `${message}\n\n${trailers}\n` : `${message}\n`,
      });
    });
  }

  async log(filter: { path?: string; itemId?: string } = {}): Promise<HistoryEntry[]> {
    return this.run('log', async () => {
      let commits;
      try {
        commits = await git.log({ fs: this.fs, dir: this.dir, filepath: filter.path, force: true });
      } catch (err) {
        // An empty repo has no HEAD yet.
        if ((err as { code?: string }).code === 'NotFoundError') return [];
        throw err;
      }
      return commits
        .map(({ oid, commit }) => ({
          rev: oid,
          summary: commit.message.split('\n')[0]!,
          timestamp: new Date(commit.author.timestamp * 1000).toISOString(),
          itemIds: trailerIds(commit.message),
        }))
        .filter((e) => !filter.itemId || e.itemIds.includes(filter.itemId));
    });
  }

  async readDir(rev: string, path: string): Promise<Record<string, Buffer>> {
    return this.run('readDir', async () => {
      const files: Record<string, Buffer> = {};
      await git.walk({
        fs: this.fs,
        dir: this.dir,
        trees: [git.TREE({ ref: rev })],
        map: async (filepath, [entry]) => {
          if (filepath === '.') return true;
          // Returning null prunes subtrees that can't contain `path`.
          if (!under(filepath, path) && !under(path, filepath)) return null;
          if (entry && under(filepath, path) && (await entry.type()) === 'blob') {
            const content = await entry.content();
            const rel = path === '' ? filepath : filepath.slice(path.length + 1);
            if (content) files[rel] = Buffer.from(content);
          }
          return true;
        },
      });
      return files;
    });
  }

  private async run<T>(op: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw new AmcError('GIT_FAILED', `git ${op} failed: ${(err as Error).message}`, err);
    }
  }
}
