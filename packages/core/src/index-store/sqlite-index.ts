import { DatabaseSync } from 'node:sqlite';
import type { Lockfile } from '../deploy/types';
import { sha256 } from '../fs/text';
import type { LibraryItem } from '../library/item-io';
import type { ItemId } from '../model/common';
import { referencesOf, type RefRelation } from '../model/refs';

/**
 * The index is a rebuildable cache over the library and the lockfiles (docs/concept/05 §4). It is
 * never authoritative: deleting `state/index.sqlite` loses nothing.
 */

export interface ItemRow {
  id: ItemId;
  kind: string;
  slug: string;
  name: string;
  version: string;
  description: string;
  tags: string[];
  updatedAt: string | null;
}

export interface RelationRow {
  from: ItemId;
  to: ItemId;
  relation: RefRelation;
  mode: string | null;
  path: string;
}

/** One item deployed to one target, derived from the lockfiles (T1.4.9). */
export interface DeploymentRow {
  itemId: ItemId;
  targetId: string;
  itemVersion: string;
  /** `<rootDir>|<relPath>`, sorted. */
  files: string[];
  deployedAt: string;
  deployId: string | null;
}

export type MatrixStatus = 'in-sync' | 'outdated' | 'missing';

export interface MatrixRow {
  itemId: ItemId;
  targetId: string;
  deployedVersion: string;
  libraryVersion: string | null;
  /** `missing`: the item was deleted from the library but is still deployed. */
  status: MatrixStatus;
}

export interface IndexStore {
  rebuild(input: {
    items: readonly LibraryItem[];
    lockfiles: ReadonlyArray<{ rootDir: string; lock: Lockfile }>;
  }): void;
  upsertItem(item: LibraryItem): void;
  removeItem(id: ItemId): void;
  /** Mirrors a lockfile (null = the root has none), so ownership survives a deleted lockfile. */
  setLockfile(rootDir: string, lock: Lockfile | null): void;
  getLockfile(rootDir: string): Lockfile | undefined;
  listItems(filter?: { kind?: string; tag?: string }): ItemRow[];
  search(query: string, limit?: number): ItemRow[];
  uses(id: ItemId): RelationRow[];
  usedBy(id: ItemId): RelationRow[];
  deployments(filter?: { itemId?: ItemId; targetId?: string }): DeploymentRow[];
  /** Every deployed item × target with its status, in one query (T1.7.4). */
  matrix(): MatrixRow[];
  close(): void;
}

const SCHEMA_VERSION = 1;

const SCHEMA = `
create table items (
  id text primary key, kind text not null, slug text not null, name text not null,
  version text not null, description text not null, tags text not null, updated_at text,
  content_sha text not null
);
create index items_kind on items(kind);
create table relations (
  from_id text not null, to_id text not null, relation text not null, mode text, path text not null,
  primary key (from_id, path)
);
create index relations_to on relations(to_id);
create table lock_files (root_dir text primary key, json text not null);
create table deployments (
  item_id text not null, target_id text not null, item_version text not null, files text not null,
  deployed_at text not null, deploy_id text,
  primary key (item_id, target_id)
);
create index deployments_target on deployments(target_id);
create virtual table items_fts using fts5(
  id unindexed, name, slug, description, tags, body, tokenize = 'unicode61 remove_diacritics 2'
);
`;

/** Turns free text into a safe FTS5 query: every word must match, as a prefix. */
export function ftsQuery(text: string): string | null {
  const words = text.match(/[\p{L}\p{N}_]+/gu) ?? [];
  return words.length ? words.map((w) => `"${w}"*`).join(' AND ') : null;
}

type Row = Record<string, unknown>;

const toItem = (r: Row): ItemRow => ({
  id: r['id'] as ItemId,
  kind: r['kind'] as string,
  slug: r['slug'] as string,
  name: r['name'] as string,
  version: r['version'] as string,
  description: r['description'] as string,
  tags: JSON.parse(r['tags'] as string) as string[],
  updatedAt: (r['updated_at'] as string | null) ?? null,
});

const toRelation = (r: Row): RelationRow => ({
  from: r['from_id'] as ItemId,
  to: r['to_id'] as ItemId,
  relation: r['relation'] as RefRelation,
  mode: (r['mode'] as string | null) ?? null,
  path: r['path'] as string,
});

const toDeployment = (r: Row): DeploymentRow => ({
  itemId: r['item_id'] as ItemId,
  targetId: r['target_id'] as string,
  itemVersion: r['item_version'] as string,
  files: JSON.parse(r['files'] as string) as string[],
  deployedAt: r['deployed_at'] as string,
  deployId: (r['deploy_id'] as string | null) ?? null,
});

export class SqliteIndexStore implements IndexStore {
  private readonly db: DatabaseSync;
  /** True when the file was new or had an old schema, so the caller must `rebuild()`. */
  readonly needsRebuild: boolean;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('pragma journal_mode = wal; pragma foreign_keys = on;');
    const version = (this.db.prepare('pragma user_version').get() as { user_version: number })
      .user_version;
    this.needsRebuild = version !== SCHEMA_VERSION;
    if (this.needsRebuild) this.recreate();
  }

  /** A cache has no migrations: an outdated schema is dropped and rebuilt from the sources. */
  private recreate(): void {
    const tables = this.db
      .prepare(
        `select name from sqlite_master where type in ('table') and name not like 'sqlite_%' and name not like 'items_fts_%'`,
      )
      .all() as Array<{ name: string }>;
    this.tx(() => {
      for (const { name } of tables) this.db.exec(`drop table if exists "${name}"`);
      this.db.exec(SCHEMA);
      this.db.exec(`pragma user_version = ${SCHEMA_VERSION}`);
    });
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('begin');
    try {
      const out = fn();
      this.db.exec('commit');
      return out;
    } catch (err) {
      this.db.exec('rollback');
      throw err;
    }
  }

  rebuild(input: {
    items: readonly LibraryItem[];
    lockfiles: ReadonlyArray<{ rootDir: string; lock: Lockfile }>;
  }): void {
    this.tx(() => {
      for (const t of ['items', 'relations', 'lock_files', 'deployments', 'items_fts'])
        this.db.exec(`delete from ${t}`);
      for (const item of input.items) this.writeItem(item);
      for (const { rootDir, lock } of input.lockfiles) {
        this.db
          .prepare('insert into lock_files (root_dir, json) values (?, ?)')
          .run(rootDir, JSON.stringify(lock));
      }
      this.recomputeDeployments();
    });
  }

  upsertItem(item: LibraryItem): void {
    this.tx(() => {
      this.deleteItem(item.manifest.id);
      this.writeItem(item);
    });
  }

  removeItem(id: ItemId): void {
    this.tx(() => this.deleteItem(id));
  }

  private deleteItem(id: ItemId): void {
    this.db.prepare('delete from items where id = ?').run(id);
    this.db.prepare('delete from relations where from_id = ?').run(id);
    this.db.prepare('delete from items_fts where id = ?').run(id);
  }

  private writeItem(item: LibraryItem): void {
    const m = item.manifest;
    const tags = JSON.stringify(m.tags);
    this.db
      .prepare(
        'insert into items (id, kind, slug, name, version, description, tags, updated_at, content_sha) values (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        m.id,
        m.kind,
        m.slug,
        m.name,
        m.version,
        m.description,
        tags,
        m.updatedAt ?? null,
        sha256(item.body),
      );
    const rel = this.db.prepare(
      'insert into relations (from_id, to_id, relation, mode, path) values (?, ?, ?, ?, ?)',
    );
    for (const r of referencesOf(m)) rel.run(m.id, r.to, r.relation, r.mode ?? null, r.path);
    this.db
      .prepare(
        'insert into items_fts (id, name, slug, description, tags, body) values (?, ?, ?, ?, ?, ?)',
      )
      .run(m.id, m.name, m.slug.replace(/-/g, ' '), m.description, m.tags.join(' '), item.body);
  }

  setLockfile(rootDir: string, lock: Lockfile | null): void {
    this.tx(() => {
      if (lock) {
        this.db
          .prepare(
            'insert into lock_files (root_dir, json) values (?, ?) on conflict(root_dir) do update set json = excluded.json',
          )
          .run(rootDir, JSON.stringify(lock));
      } else {
        this.db.prepare('delete from lock_files where root_dir = ?').run(rootDir);
      }
      this.recomputeDeployments();
    });
  }

  getLockfile(rootDir: string): Lockfile | undefined {
    const row = this.db.prepare('select json from lock_files where root_dir = ?').get(rootDir) as
      { json: string } | undefined;
    return row ? (JSON.parse(row.json) as Lockfile) : undefined;
  }

  /** Deployments are derived, never stored independently, so a rebuild reproduces them exactly. */
  private recomputeDeployments(): void {
    this.db.exec('delete from deployments');
    const acc = new Map<string, DeploymentRow>();
    const rows = this.db
      .prepare('select root_dir, json from lock_files order by root_dir')
      .all() as Array<{ root_dir: string; json: string }>;
    for (const { root_dir, json } of rows) {
      const lock = JSON.parse(json) as Lockfile;
      const entries = [
        ...Object.entries(lock.files).map(([rel, e]) => [rel, e] as const),
        ...Object.entries(lock.regions).flatMap(([rel, r]) =>
          Object.entries(r).map(([id, e]) => [`${rel}#${id}`, e] as const),
        ),
      ];
      for (const [rel, e] of entries) {
        const key = `${e.itemId}\u0000${e.targetId}`;
        const d = acc.get(key) ?? {
          itemId: e.itemId,
          targetId: e.targetId,
          itemVersion: e.itemVersion,
          files: [],
          deployedAt: e.deployedAt,
          deployId: e.deployId ?? null,
        };
        d.files.push(`${root_dir}|${rel}`);
        if (e.deployedAt >= d.deployedAt)
          Object.assign(d, {
            itemVersion: e.itemVersion,
            deployedAt: e.deployedAt,
            deployId: e.deployId ?? null,
          });
        acc.set(key, d);
      }
    }
    const ins = this.db.prepare(
      'insert into deployments (item_id, target_id, item_version, files, deployed_at, deploy_id) values (?, ?, ?, ?, ?, ?)',
    );
    for (const d of acc.values())
      ins.run(
        d.itemId,
        d.targetId,
        d.itemVersion,
        JSON.stringify(d.files.sort()),
        d.deployedAt,
        d.deployId,
      );
  }

  listItems(filter: { kind?: string; tag?: string } = {}): ItemRow[] {
    const rows = this.db
      .prepare(
        `select * from items
         where (?1 is null or kind = ?1)
           and (?2 is null or exists (select 1 from json_each(items.tags) where value = ?2))
         order by kind, slug`,
      )
      .all(filter.kind ?? null, filter.tag ?? null) as Row[];
    return rows.map(toItem);
  }

  search(query: string, limit = 50): ItemRow[] {
    const q = ftsQuery(query);
    if (!q) return [];
    const rows = this.db
      .prepare(
        `select items.* from items_fts join items on items.id = items_fts.id
         where items_fts match ? order by bm25(items_fts, 0, 10, 8, 4, 4, 1), items.id limit ?`,
      )
      .all(q, limit) as Row[];
    return rows.map(toItem);
  }

  uses(id: ItemId): RelationRow[] {
    return (
      this.db.prepare('select * from relations where from_id = ? order by path').all(id) as Row[]
    ).map(toRelation);
  }

  usedBy(id: ItemId): RelationRow[] {
    return (
      this.db
        .prepare('select * from relations where to_id = ? order by from_id, path')
        .all(id) as Row[]
    ).map(toRelation);
  }

  deployments(filter: { itemId?: ItemId; targetId?: string } = {}): DeploymentRow[] {
    const rows = this.db
      .prepare(
        `select * from deployments where (?1 is null or item_id = ?1) and (?2 is null or target_id = ?2)
         order by item_id, target_id`,
      )
      .all(filter.itemId ?? null, filter.targetId ?? null) as Row[];
    return rows.map(toDeployment);
  }

  matrix(): MatrixRow[] {
    const rows = this.db
      .prepare(
        `select d.item_id, d.target_id, d.item_version, i.version as library_version,
           case when i.id is null then 'missing'
                when i.version = d.item_version then 'in-sync'
                else 'outdated' end as status
         from deployments d left join items i on i.id = d.item_id
         order by d.item_id, d.target_id`,
      )
      .all() as Row[];
    return rows.map((r) => ({
      itemId: r['item_id'] as ItemId,
      targetId: r['target_id'] as string,
      deployedVersion: r['item_version'] as string,
      libraryVersion: (r['library_version'] as string | null) ?? null,
      status: r['status'] as MatrixStatus,
    }));
  }

  close(): void {
    this.db.close();
  }
}
