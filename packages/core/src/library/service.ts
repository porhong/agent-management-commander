import { join } from 'node:path';
import { AmcError } from '../errors';
import type { FsPort } from '../fs/fs-port';
import { stripBom } from '../fs/text';
import { kindOfId, slugSchema, type ItemId } from '../model/common';
import { BODY_FILE, manifestSchemas, type Manifest, type ModeledKind } from '../model/manifests';
import { parseManifest } from '../model/parse';
import { referencesOf } from '../model/refs';
import { NoHistory, type HistoryEntry, type LibraryHistory } from './git';
import {
  MANIFEST_FILE,
  deserializeManifest,
  itemDir,
  kindDir,
  readItem,
  writeItem,
  type LibraryItem,
} from './item-io';
import { findTemplate } from './templates';
import { anyChanged, bumpVersion, contentChanged, type BumpLevel } from './versioning';

const KINDS = Object.keys(manifestSchemas) as ModeledKind[];
const MAX_SLUG = 64;

export interface CreateDraft {
  kind: ModeledKind;
  slug: string;
  name?: string;
  description?: string;
  /** Built-in template id (see ITEM_TEMPLATES); its kind must match. */
  template?: string;
  /** Other manifest fields (tags, skills, arguments, …). */
  fields?: Record<string, unknown>;
  body?: string;
  files?: Record<string, Buffer>;
}

export interface ItemPatch {
  /** Manifest fields to replace (shallow). `id`, `kind`, and `slug` can't change here. */
  fields?: Record<string, unknown>;
  body?: string;
  /** Replaces the full set of supporting files. */
  files?: Record<string, Buffer>;
  /** Explicit bump. Without it, a content change bumps patch; `fields.version` sets it exactly. */
  bump?: BumpLevel;
}

export interface LoadProblem {
  /** Library-relative folder, e.g. `skills/broken`. */
  path: string;
  message: string;
}

export interface LibraryServiceOptions {
  fs: FsPort;
  /** The library folder (`~/.amc/library`). */
  root: string;
  history?: LibraryHistory;
  now?: () => Date;
}

const LOCKED_FIELDS = ['id', 'kind', 'slug'] as const;
const STAMP_FIELDS = ['createdAt', 'updatedAt'] as const;

/**
 * CRUD over the library folder (T1.1.2). The folder is the source of truth; every successful
 * change is committed to history. Operations are serialized so git never sees interleaved writes.
 */
export class LibraryService {
  private readonly fs: FsPort;
  private readonly root: string;
  private readonly git: LibraryHistory;
  private readonly now: () => Date;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(opts: LibraryServiceOptions) {
    this.fs = opts.fs;
    this.root = opts.root;
    this.git = opts.history ?? NoHistory;
    this.now = opts.now ?? (() => new Date());
  }

  // ---------- reads ----------

  /** Reads every item. Folders that fail to parse are reported, not thrown. */
  async load(): Promise<{ items: LibraryItem[]; problems: LoadProblem[] }> {
    const items: LibraryItem[] = [];
    const problems: LoadProblem[] = [];
    const seen = new Map<string, string>();
    for (const kind of KINDS) {
      const dir = join(this.root, kindDir(kind));
      if (!(await this.fs.stat(dir))) continue;
      for (const entry of await this.fs.readdir(dir)) {
        if (entry.kind !== 'dir' || entry.path.startsWith('.')) continue;
        const rel = `${kindDir(kind)}/${entry.path}`;
        try {
          const item = await readItem(this.fs, join(dir, entry.path));
          if (item.manifest.kind !== kind) {
            throw new AmcError(
              'ITEM_LAYOUT_INVALID',
              `A ${item.manifest.kind} in ${kindDir(kind)}/`,
            );
          }
          const dup = seen.get(item.manifest.id);
          if (dup) throw new AmcError('ITEM_LAYOUT_INVALID', `Duplicate id, also in ${dup}`);
          seen.set(item.manifest.id, rel);
          items.push(item);
        } catch (err) {
          problems.push({ path: rel, message: (err as Error).message });
        }
      }
    }
    return { items, problems };
  }

  async list(kind?: ModeledKind): Promise<LibraryItem[]> {
    const { items } = await this.load();
    return items.filter((i) => !kind || i.manifest.kind === kind);
  }

  async get(id: ItemId): Promise<LibraryItem> {
    const kind = kindOfId(id) as ModeledKind;
    const item = (await this.list(kind)).find((i) => i.manifest.id === id);
    if (!item) throw new AmcError('ITEM_NOT_FOUND', `No item ${id}`);
    return item;
  }

  /** Items whose manifests reference `id`. */
  async usedBy(id: ItemId): Promise<LibraryItem[]> {
    return (await this.list()).filter(
      (i) => i.manifest.id !== id && referencesOf(i.manifest).some((r) => r.to === id),
    );
  }

  /** Commits that touched `id`, newest first. Follows the item across renames. */
  history(id: ItemId): Promise<HistoryEntry[]> {
    return this.git.log({ itemId: id });
  }

  // ---------- writes ----------

  create(draft: CreateDraft): Promise<LibraryItem> {
    return this.serial(async () => {
      const tpl = draft.template ? findTemplate(draft.template) : undefined;
      if (draft.template && (!tpl || tpl.kind !== draft.kind)) {
        throw new AmcError('TEMPLATE_NOT_FOUND', `No ${draft.kind} template "${draft.template}"`);
      }
      const slug = this.checkSlug(draft.slug);
      await this.ensureSlugFree(draft.kind, slug);
      const stamp = this.stamp();
      const manifest = parseManifest({
        ...tpl?.fields,
        ...draft.fields,
        id: await this.freshId(draft.kind, slug),
        kind: draft.kind,
        slug,
        name: draft.name ?? titleCase(slug),
        description: draft.description ?? tpl?.description,
        version: '0.1.0',
        createdAt: stamp,
        updatedAt: stamp,
      });
      const item = { manifest, body: draft.body ?? tpl?.body ?? '', files: draft.files ?? {} };
      await this.save(item, `amc: create ${manifest.id} (${manifest.version})`);
      return item;
    });
  }

  update(id: ItemId, patch: ItemPatch): Promise<LibraryItem> {
    return this.serial(async () => {
      const current = await this.get(id);
      const fields = { ...patch.fields };
      for (const k of LOCKED_FIELDS) {
        if (k in fields && fields[k] !== current.manifest[k]) {
          const hint = k === 'slug' ? ' (use rename)' : '';
          throw new AmcError('MANIFEST_INVALID', `${k} can't be changed${hint}`);
        }
      }
      for (const k of STAMP_FIELDS) delete fields[k];

      const next: LibraryItem = {
        manifest: parseManifest({ ...current.manifest, ...fields }),
        body: patch.body ?? current.body,
        files: patch.files ?? current.files,
      };
      if (!anyChanged(current, next) && !patch.bump) return current;
      next.manifest = this.nextVersion(current, next, patch.bump);
      await this.save(next, `amc: update ${id} (${next.manifest.version})`);
      return next;
    });
  }

  /** Moves the folder to `newSlug`. The id never changes, so references keep resolving. */
  rename(id: ItemId, newSlug: string): Promise<LibraryItem> {
    return this.serial(async () => {
      const current = await this.get(id);
      const slug = this.checkSlug(newSlug);
      if (slug === current.manifest.slug) return current;
      await this.ensureSlugFree(current.manifest.kind, slug);
      const moved = { ...current, manifest: { ...current.manifest, slug } as Manifest };
      moved.manifest = this.nextVersion(current, moved);
      const from = itemDir(this.root, current.manifest);
      await this.fs.rename(from, itemDir(this.root, moved.manifest));
      await this.save(moved, `amc: rename ${id} (${current.manifest.slug} → ${slug})`, [
        this.relDir(current.manifest),
      ]);
      return moved;
    });
  }

  /** Refused while another item references this one (ITEM_REFERENCED lists them). */
  delete(id: ItemId): Promise<void> {
    return this.serial(async () => {
      const current = await this.get(id);
      const users = await this.usedBy(id);
      if (users.length > 0) {
        const ids = users.map((u) => u.manifest.id);
        throw new AmcError('ITEM_REFERENCED', `${id} is used by ${ids.join(', ')}`, ids);
      }
      await this.fs.rm(itemDir(this.root, current.manifest), { recursive: true });
      await this.git.commit([this.relDir(current.manifest)], `amc: delete ${id}`, [id]);
    });
  }

  /** Copies an item under a new slug and id, starting again at 0.1.0. */
  duplicate(id: ItemId, newSlug?: string): Promise<LibraryItem> {
    return this.serial(async () => {
      const src = await this.get(id);
      const { kind } = src.manifest;
      const slug = newSlug ? this.checkSlug(newSlug) : await this.copySlug(kind, src.manifest.slug);
      await this.ensureSlugFree(kind, slug);
      const stamp = this.stamp();
      const manifest = parseManifest({
        ...src.manifest,
        id: await this.freshId(kind, slug),
        slug,
        name: `${src.manifest.name} (copy)`.slice(0, 120),
        version: '0.1.0',
        createdAt: stamp,
        updatedAt: stamp,
      });
      const copy = { manifest, body: src.body, files: { ...src.files } };
      await this.save(copy, `amc: create ${manifest.id} (${manifest.version}) from ${id}`);
      return copy;
    });
  }

  /**
   * Brings back the content `id` had at `rev`, as a new commit and a new version. The item keeps
   * its current slug even if it was renamed since.
   */
  restore(id: ItemId, rev: string): Promise<LibraryItem> {
    return this.serial(async () => {
      const current = await this.get(id);
      const old = await this.readAtRev(id, rev);
      const next: LibraryItem = {
        manifest: parseManifest({
          ...old.manifest,
          slug: current.manifest.slug,
          version: current.manifest.version,
          createdAt: current.manifest.createdAt,
          updatedAt: current.manifest.updatedAt,
        }),
        body: old.body,
        files: old.files,
      };
      if (!anyChanged(current, next)) return current;
      next.manifest = this.nextVersion(current, next);
      await this.save(next, `amc: restore ${id} to ${rev.slice(0, 7)} (${next.manifest.version})`);
      return next;
    });
  }

  // ---------- helpers ----------

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private stamp(): string {
    return this.now().toISOString();
  }

  private relDir(m: Pick<Manifest, 'kind' | 'slug'>): string {
    return `${kindDir(m.kind)}/${m.slug}`;
  }

  private async save(item: LibraryItem, message: string, extraPaths: string[] = []) {
    await writeItem(this.fs, itemDir(this.root, item.manifest), item);
    await this.git.commit([...extraPaths, this.relDir(item.manifest)], message, [item.manifest.id]);
  }

  /** Applies the explicit/auto version rules and refreshes `updatedAt`. */
  private nextVersion(current: LibraryItem, next: LibraryItem, bump?: BumpLevel): Manifest {
    let version = next.manifest.version;
    if (version === current.manifest.version) {
      if (bump) version = bumpVersion(version, bump);
      else if (contentChanged(current, next)) version = bumpVersion(version, 'patch');
    }
    return parseManifest({ ...next.manifest, version, updatedAt: this.stamp() });
  }

  private checkSlug(slug: string): string {
    const r = slugSchema.safeParse(slug);
    if (!r.success) {
      throw new AmcError(
        'MANIFEST_INVALID',
        `Invalid slug "${slug}": ${r.error.issues[0]!.message}`,
      );
    }
    return r.data;
  }

  /** Checks the folder, so even an unreadable item blocks its slug. */
  private async ensureSlugFree(kind: ModeledKind, slug: string): Promise<void> {
    if (await this.fs.stat(itemDir(this.root, { kind, slug }))) {
      throw new AmcError('SLUG_TAKEN', `A ${kind} named "${slug}" already exists`);
    }
  }

  /** `<kind>.<slug>`, suffixed if a renamed item already holds that id. */
  private async freshId(kind: ModeledKind, slug: string): Promise<ItemId> {
    const taken = new Set((await this.list(kind)).map((i) => i.manifest.id));
    for (let n = 1; ; n++) {
      const id = n === 1 ? `${kind}.${slug}` : `${kind}.${slug}-${n}`;
      if (!taken.has(id)) return id;
    }
  }

  private async copySlug(kind: ModeledKind, slug: string): Promise<string> {
    for (let n = 1; ; n++) {
      const suffix = n === 1 ? '-copy' : `-copy-${n}`;
      const candidate = slug.slice(0, MAX_SLUG - suffix.length).replace(/-$/, '') + suffix;
      if (!(await this.fs.stat(itemDir(this.root, { kind, slug: candidate })))) return candidate;
    }
  }

  /** Finds `id` at `rev` by its manifest, since the folder may have had another name then. */
  private async readAtRev(id: ItemId, rev: string): Promise<LibraryItem> {
    const kind = kindOfId(id) as ModeledKind;
    const files = await this.git.readDir(rev, kindDir(kind));
    const folders = new Set(Object.keys(files).map((p) => p.split('/')[0]!));
    for (const folder of folders) {
      const yaml = files[`${folder}/${MANIFEST_FILE}`];
      if (!yaml) continue;
      let manifest: Manifest;
      try {
        manifest = deserializeManifest(yaml.toString('utf8'));
      } catch {
        continue; // an unreadable manifest at that revision can't be the item we want
      }
      if (manifest.id !== id) continue;
      const bodyFile = BODY_FILE[kind];
      const rest: Record<string, Buffer> = {};
      for (const [p, data] of Object.entries(files)) {
        const rel = p.slice(folder.length + 1);
        if (!p.startsWith(`${folder}/`) || rel === MANIFEST_FILE || rel === bodyFile) continue;
        if (rel.split('/').some((s) => s.startsWith('.'))) continue;
        rest[rel] = data;
      }
      const body = files[`${folder}/${bodyFile}`];
      return { manifest, body: body ? stripBom(body.toString('utf8')) : '', files: rest };
    }
    throw new AmcError('ITEM_NOT_FOUND', `${id} does not exist at ${rev.slice(0, 7)}`);
  }
}

const titleCase = (slug: string): string =>
  slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
