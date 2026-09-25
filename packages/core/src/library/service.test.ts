import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAmcError } from '../errors';
import { MemFs } from '../fs/mem-fs';
import { amcPaths, bootstrapHome } from './bootstrap';
import { LibraryService } from './service';
import { ITEM_TEMPLATES } from './templates';
import { bumpVersion } from './versioning';

const HOME = join('/', 'home', 'u', '.amc');
const LIB = join(HOME, 'library');

function setup() {
  const fs = new MemFs();
  let t = Date.parse('2026-09-25T10:00:00Z');
  const lib = new LibraryService({ fs, root: LIB, now: () => new Date((t += 1000)) });
  return { fs, lib };
}

const code = (c: Parameters<typeof isAmcError>[1]) => (e: unknown) => isAmcError(e, c);

describe('bootstrapHome', () => {
  it('creates the layout, is idempotent, and honours a custom root', async () => {
    const fs = new MemFs();
    const custom = join('/', 'data', 'amc');
    const paths = await bootstrapHome(fs, custom);
    expect(paths).toEqual(amcPaths(custom));
    for (const d of ['library/skills', 'library/agents', 'library/commands', 'state', 'logs']) {
      expect((await fs.stat(join(custom, d)))?.kind).toBe('dir');
    }
    fs.putSync(join(custom, 'library', 'skills', 'keep.txt'), 'x');
    const opsBefore = fs.ops.length;
    await bootstrapHome(fs, custom);
    expect(fs.ops.length).toBe(opsBefore);
    expect((await fs.readFile(join(custom, 'library', 'skills', 'keep.txt'))).toString()).toBe('x');
  });
});

describe('LibraryService CRUD', () => {
  it('creates an item with a stable id, 0.1.0, and timestamps', async () => {
    const { lib } = setup();
    const s = await lib.create({ kind: 'skill', slug: 'sec-check', description: 'Security.' });
    expect(s.manifest).toMatchObject({
      id: 'skill.sec-check',
      name: 'Sec Check',
      version: '0.1.0',
      createdAt: '2026-09-25T10:00:01.000Z',
      updatedAt: '2026-09-25T10:00:01.000Z',
    });
    expect(await lib.get('skill.sec-check')).toEqual(s);
    expect(await lib.list('skill')).toHaveLength(1);
    expect(await lib.list('agent')).toHaveLength(0);
  });

  it('enforces slug uniqueness per kind and rejects unsafe slugs', async () => {
    const { lib } = setup();
    await lib.create({ kind: 'skill', slug: 'a', description: 'x' });
    await expect(lib.create({ kind: 'skill', slug: 'a', description: 'y' })).rejects.toSatisfy(
      code('SLUG_TAKEN'),
    );
    // Same slug, other kind, is fine.
    await lib.create({ kind: 'agent', slug: 'a', description: 'x' });
    for (const bad of ['../evil', 'A', 'a/b', '', 'a--b']) {
      await expect(lib.create({ kind: 'skill', slug: bad, description: 'x' })).rejects.toSatisfy(
        code('MANIFEST_INVALID'),
      );
    }
  });

  it('rename moves the folder, keeps the id, and references still resolve (T1.1.3)', async () => {
    const { fs, lib } = setup();
    await lib.create({ kind: 'skill', slug: 'sec', description: 'x' });
    await lib.create({
      kind: 'agent',
      slug: 'reviewer',
      description: 'x',
      fields: { skills: [{ ref: 'skill.sec', mode: 'always' }] },
    });
    const renamed = await lib.rename('skill.sec', 'security-checklist');
    expect(renamed.manifest.id).toBe('skill.sec');
    expect(renamed.manifest.slug).toBe('security-checklist');
    expect(await fs.stat(join(LIB, 'skills', 'sec'))).toBeNull();
    expect(await fs.stat(join(LIB, 'skills', 'security-checklist', 'amc.yaml'))).not.toBeNull();

    const agent = await lib.get('agent.reviewer');
    const ref = agent.manifest.kind === 'agent' ? agent.manifest.skills[0]!.ref : '';
    expect((await lib.get(ref)).manifest.slug).toBe('security-checklist');
    expect((await lib.usedBy('skill.sec')).map((i) => i.manifest.id)).toEqual(['agent.reviewer']);

    // The freed slug gets a new, non-colliding id.
    const again = await lib.create({ kind: 'skill', slug: 'sec', description: 'x' });
    expect(again.manifest.id).toBe('skill.sec-2');
  });

  it('refuses to delete a referenced item and deletes it once unreferenced', async () => {
    const { fs, lib } = setup();
    await lib.create({ kind: 'agent', slug: 'rev', description: 'x' });
    await lib.create({
      kind: 'command',
      slug: 'review',
      description: 'x',
      fields: { agent: 'agent.rev' },
    });
    await expect(lib.delete('agent.rev')).rejects.toSatisfy(
      (e) => isAmcError(e, 'ITEM_REFERENCED') && (e.details as string[])[0] === 'command.review',
    );
    await lib.update('command.review', { fields: { agent: undefined } });
    await lib.delete('agent.rev');
    expect(await fs.stat(join(LIB, 'agents', 'rev'))).toBeNull();
    await expect(lib.get('agent.rev')).rejects.toSatisfy(code('ITEM_NOT_FOUND'));
  });

  it('duplicates with a fresh slug, id, and version', async () => {
    const { lib } = setup();
    const src = await lib.create({
      kind: 'skill',
      slug: 'sec',
      description: 'x',
      files: { 'references/a.md': Buffer.from('a') },
    });
    await lib.update(src.manifest.id, { body: 'changed' });
    const a = await lib.duplicate('skill.sec');
    const b = await lib.duplicate('skill.sec');
    expect([a.manifest.slug, b.manifest.slug]).toEqual(['sec-copy', 'sec-copy-2']);
    expect(a.manifest).toMatchObject({
      id: 'skill.sec-copy',
      version: '0.1.0',
      name: 'Sec (copy)',
    });
    expect(a.files['references/a.md']?.toString()).toBe('a');
    expect(a.body).toBe('changed');
  });

  it('reports unreadable folders instead of failing the whole library', async () => {
    const { fs, lib } = setup();
    await lib.create({ kind: 'skill', slug: 'ok', description: 'x' });
    fs.putSync(join(LIB, 'skills', 'broken', 'amc.yaml'), 'id: [');
    const { items, problems } = await lib.load();
    expect(items.map((i) => i.manifest.id)).toEqual(['skill.ok']);
    expect(problems).toEqual([{ path: 'skills/broken', message: expect.any(String) }]);
  });
});

describe('LibraryService versioning (T1.1.4)', () => {
  it('bumps patch on content change only', async () => {
    const { lib } = setup();
    await lib.create({ kind: 'skill', slug: 's', description: 'x' });
    const tagged = await lib.update('skill.s', { fields: { tags: ['sec'] } });
    expect(tagged.manifest.version).toBe('0.1.0');
    expect(tagged.manifest.updatedAt).not.toBe(tagged.manifest.createdAt);

    expect((await lib.update('skill.s', { body: 'new' })).manifest.version).toBe('0.1.1');
    expect((await lib.update('skill.s', { fields: { description: 'y' } })).manifest.version).toBe(
      '0.1.2',
    );
    expect(
      (await lib.update('skill.s', { files: { 'scripts/x.ps1': Buffer.from('x') } })).manifest
        .version,
    ).toBe('0.1.3');
  });

  it('supports explicit bumps and versions, and ignores no-op updates', async () => {
    const { fs, lib } = setup();
    await lib.create({ kind: 'skill', slug: 's', description: 'x' });
    expect((await lib.update('skill.s', { bump: 'minor' })).manifest.version).toBe('0.2.0');
    expect((await lib.update('skill.s', { body: 'b', bump: 'major' })).manifest.version).toBe(
      '1.0.0',
    );
    expect((await lib.update('skill.s', { fields: { version: '3.0.0' } })).manifest.version).toBe(
      '3.0.0',
    );
    const ops = fs.ops.length;
    const same = await lib.update('skill.s', { body: 'b' });
    expect(same.manifest.version).toBe('3.0.0');
    expect(fs.ops.length).toBe(ops);
  });

  it('refuses to change id, kind, or slug through update', async () => {
    const { lib } = setup();
    await lib.create({ kind: 'skill', slug: 's', description: 'x' });
    for (const fields of [{ id: 'skill.t' }, { kind: 'agent' }, { slug: 't' }]) {
      await expect(lib.update('skill.s', { fields })).rejects.toSatisfy(code('MANIFEST_INVALID'));
    }
  });

  it.each([
    ['1.2.3', 'patch', '1.2.4'],
    ['1.2.3', 'minor', '1.3.0'],
    ['1.2.3', 'major', '2.0.0'],
    ['1.2.3-beta.1', 'patch', '1.2.3'],
    ['1.2.0-rc.1', 'minor', '1.2.0'],
    ['2.0.0-rc.1', 'major', '2.0.0'],
  ] as const)('bumpVersion(%s, %s) = %s', (v, level, want) => {
    expect(bumpVersion(v, level)).toBe(want);
  });
});

describe('item templates (T1.1.6)', () => {
  it.each(ITEM_TEMPLATES.map((t) => [t.id, t] as const))('%s yields a valid item', async (_, t) => {
    const { lib } = setup();
    const item = await lib.create({ kind: t.kind, slug: 'from-template', template: t.id });
    expect(item.manifest.description).toBe(t.description);
    expect(item.body).toBe(t.body);
    expect(await lib.get(item.manifest.id)).toEqual(item);
  });

  it('rejects unknown or mismatched templates', async () => {
    const { lib } = setup();
    for (const template of ['nope', 'reviewer-agent']) {
      await expect(lib.create({ kind: 'skill', slug: 's', template })).rejects.toSatisfy(
        code('TEMPLATE_NOT_FOUND'),
      );
    }
  });
});
