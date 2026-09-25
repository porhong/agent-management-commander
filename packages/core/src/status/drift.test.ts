import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../adapter/registry';
import type { Target, ToolAdapter } from '../adapter/types';
import { serializeLockfile, type Lockfile } from '../deploy';
import { MemFs } from '../fs/mem-fs';
import { sha256 } from '../fs/text';
import { checkDrift } from './drift';

const MAIN = join('/', 'h', 'tool');
const SHARED = join('/', 'h', 'shared');
const T: Target = { toolId: 'fake', scope: 'global' };
const TID = 'fake:global';

const fake: ToolAdapter = {
  id: 'fake',
  displayName: 'Fake',
  capabilities: {} as ToolAdapter['capabilities'],
  rules: [],
  detect: async () => ({ installed: true, roots: {}, notes: [] }),
  paths: () => ({ main: MAIN, shared: SHARED }),
  scan: async () => [],
  parse: () => {
    throw new Error('unused');
  },
  compile: () => [],
};

const adapters = new AdapterRegistry([fake]);

const entry = (itemId: string, content: string) => ({
  itemId,
  itemVersion: '1.0.0',
  targetId: TID,
  sha256: sha256(content),
  deployedAt: '2026-09-25T10:00:00.000Z',
});

const lockfile = (files: Record<string, ReturnType<typeof entry>>, regions = {}): Lockfile => ({
  schemaVersion: 1,
  amcVersion: '0.1.0',
  files,
  regions,
});

const run = (fs: MemFs) => checkDrift({ fs, adapters, now: () => new Date(0) }, [T]);

describe('drift check (T1.9.3)', () => {
  it('says nothing is wrong when every owned file still hashes the same', async () => {
    const fs = new MemFs({
      [join(MAIN, 'skills', 'a', 'SKILL.md')]: '# A\n',
      [join(MAIN, '.amc-lock.json')]: serializeLockfile(
        lockfile({ 'skills/a/SKILL.md': entry('skill.a', '# A\n') }),
      ),
    });
    const report = await run(fs);
    expect(report.entries.map((e) => e.state)).toEqual(['in-sync']);
    expect(report.warnings).toEqual([]);
  });

  it('notices a file edited outside AMC', async () => {
    const fs = new MemFs({
      [join(MAIN, 'skills', 'a', 'SKILL.md')]: '# A, edited by hand\n',
      [join(MAIN, '.amc-lock.json')]: serializeLockfile(
        lockfile({ 'skills/a/SKILL.md': entry('skill.a', '# A\n') }),
      ),
    });
    const [drifted] = (await run(fs)).entries;
    expect(drifted).toMatchObject({
      state: 'drifted',
      itemId: 'skill.a',
      relPath: 'skills/a/SKILL.md',
      targetId: TID,
    });
  });

  it('notices a file that was deleted', async () => {
    const fs = new MemFs({
      [join(MAIN, '.amc-lock.json')]: serializeLockfile(
        lockfile({ 'skills/a/SKILL.md': entry('skill.a', '# A\n') }),
      ),
    });
    expect((await run(fs)).entries[0]).toMatchObject({ state: 'missing', itemId: 'skill.a' });
  });

  it('checks a managed region rather than the whole shared file', async () => {
    const inner = 'Run the checklist.\n';
    const shared =
      `# Team notes\n\n<!-- amc:begin command.review -->\n${inner}<!-- amc:end command.review -->\n` +
      `\nEverything down here is mine.\n`;
    const fs = new MemFs({
      [join(SHARED, 'AGENTS.md')]: shared,
      [join(SHARED, '.amc-lock.json')]: serializeLockfile(
        lockfile({}, { 'AGENTS.md': { 'command.review': entry('command.review', inner) } }),
      ),
    });
    expect((await run(fs)).entries[0]).toMatchObject({
      state: 'in-sync',
      region: 'command.review',
    });

    // Editing outside the markers is the user's business and must not count as drift.
    fs.putSync(join(SHARED, 'AGENTS.md'), `${shared}\nAnother note of mine.\n`);
    expect((await run(fs)).entries[0]!.state).toBe('in-sync');

    // Editing inside them does.
    fs.putSync(join(SHARED, 'AGENTS.md'), shared.replace(inner, 'Run something else entirely.\n'));
    expect((await run(fs)).entries[0]!.state).toBe('drifted');
  });

  it('reports a region whose markers were removed as missing', async () => {
    const fs = new MemFs({
      [join(SHARED, 'AGENTS.md')]: '# Team notes\n',
      [join(SHARED, '.amc-lock.json')]: serializeLockfile(
        lockfile({}, { 'AGENTS.md': { 'command.review': entry('command.review', 'x') } }),
      ),
    });
    expect((await run(fs)).entries[0]!.state).toBe('missing');
  });

  it('ignores files AMC does not own', async () => {
    const fs = new MemFs({
      [join(MAIN, 'skills', 'theirs', 'SKILL.md')]: 'not mine\n',
      [join(MAIN, '.amc-lock.json')]: serializeLockfile(lockfile({})),
    });
    expect((await run(fs)).entries).toEqual([]);
  });

  it('reports an unreadable lockfile instead of guessing', async () => {
    const fs = new MemFs({ [join(MAIN, '.amc-lock.json')]: '{ oops' });
    const report = await run(fs);
    expect(report.entries).toEqual([]);
    expect(report.warnings[0]).toMatch(/not valid JSON/);
  });
});
