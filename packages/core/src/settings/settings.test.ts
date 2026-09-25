import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAmcError } from '../errors';
import { MemFs } from '../fs/mem-fs';
import { Logger, formatDiagnostics, redact } from '../log/logger';
import { SettingsStore, defaultSettings } from './settings';

const STATE = join('/', 'h', '.amc', 'state');
const LOGS = join('/', 'h', '.amc', 'logs');
const path = join(STATE, 'settings.json');

describe('SettingsStore (T1.5.6)', () => {
  it('starts from defaults and writes only validated values', async () => {
    const fs = new MemFs();
    const s = new SettingsStore(fs, STATE);
    expect(await s.load()).toEqual(defaultSettings());
    await s.update({ theme: 'dark', projectRoots: [join('/', 'work', 'api')] });
    expect(s.get().theme).toBe('dark');
    expect(JSON.parse((await fs.readFile(path)).toString('utf8'))).toMatchObject({
      schemaVersion: 1,
      theme: 'dark',
      autoApply: 'ask',
    });
    const reloaded = new SettingsStore(fs, STATE);
    expect((await reloaded.load()).projectRoots).toEqual([join('/', 'work', 'api')]);
  });

  it('rejects an invalid patch without writing', async () => {
    const fs = new MemFs();
    const s = new SettingsStore(fs, STATE);
    await s.load();
    await expect(s.update({ theme: 'neon' as 'dark' })).rejects.toSatisfy((e) =>
      isAmcError(e, 'SETTINGS_INVALID'),
    );
    expect(await fs.stat(path)).toBeNull();
    expect(s.get()).toEqual(defaultSettings());
  });

  it('keeps valid fields when the file is partly invalid, and survives broken JSON', async () => {
    const fs = new MemFs({
      [path]: JSON.stringify({ theme: 'dark', autoApply: 'always', snapshots: { keep: 9 } }),
    });
    const s = new SettingsStore(fs, STATE);
    const loaded = await s.load();
    expect(loaded.theme).toBe('dark');
    expect(loaded.autoApply).toBe('ask');
    expect(loaded.snapshots.keep).toBe(9);
    expect(s.warnings[0]).toContain('autoApply');

    const broken = new SettingsStore(new MemFs({ [path]: '{ oops' }), STATE);
    expect(await broken.load()).toEqual(defaultSettings());
    expect(broken.warnings).toHaveLength(1);
  });

  it('refuses to answer before loading', () => {
    expect(() => new SettingsStore(new MemFs(), STATE).get()).toThrow(
      expect.objectContaining({ code: 'SETTINGS_NOT_LOADED' }),
    );
  });
});

describe('Logger (T1.5.6)', () => {
  const makeLogger = (fs: MemFs, extra: Partial<ConstructorParameters<typeof Logger>[0]> = {}) => {
    let t = Date.parse('2026-09-25T10:00:00Z');
    return new Logger({ fs, dir: LOGS, now: () => new Date((t += 1000)), ...extra });
  };
  const lines = async (fs: MemFs, name = 'amc.log') =>
    (await fs.readFile(join(LOGS, name)))
      .toString('utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));

  it('writes ordered JSON lines and honours the level', async () => {
    const fs = new MemFs();
    const log = makeLogger(fs, { level: 'info' });
    const scoped = log.child('deploy');
    scoped.debug('hidden');
    scoped.info('planned', { targetId: 'claude-code:global', changes: 3 });
    scoped.error('failed', { code: 'PLAN_STALE' });
    await log.flush();
    expect(await lines(fs)).toEqual([
      {
        ts: '2026-09-25T10:00:01.000Z',
        level: 'info',
        scope: 'deploy',
        message: 'planned',
        fields: { targetId: 'claude-code:global', changes: 3 },
      },
      {
        ts: '2026-09-25T10:00:02.000Z',
        level: 'error',
        scope: 'deploy',
        message: 'failed',
        fields: { code: 'PLAN_STALE' },
      },
    ]);
  });

  it('never logs file contents, only paths and hashes', async () => {
    const fs = new MemFs();
    const log = makeLogger(fs);
    log.child('deploy').info('wrote file', {
      path: 'skills/a/SKILL.md',
      sha256: 'a'.repeat(64),
      content: 'SECRET BODY TEXT',
      after: 'SECRET BODY TEXT',
      note: 'x'.repeat(500),
    });
    await log.flush();
    const text = (await fs.readFile(join(LOGS, 'amc.log'))).toString('utf8');
    expect(text).not.toContain('SECRET BODY TEXT');
    expect(text).toContain('skills/a/SKILL.md');
    expect(text).toContain('a'.repeat(64));
    const [record] = await lines(fs);
    expect(record.fields).toMatchObject({ content: '[redacted]', after: '[redacted]' });
    expect((record.fields.note as string).endsWith('…[500]')).toBe(true);
    expect(redact({ Body: 'x' })).toEqual({ Body: '[redacted]' });
  });

  it('rotates by size and keeps a bounded number of files', async () => {
    const fs = new MemFs();
    const log = makeLogger(fs, { maxBytes: 200, maxFiles: 2 });
    for (let i = 0; i < 12; i++) log.child('s').info(`message number ${i}`);
    await log.flush();
    expect((await fs.readdir(LOGS)).map((e) => e.path).sort()).toEqual([
      'amc.1.log',
      'amc.2.log',
      'amc.log',
    ]);
    const current = await lines(fs);
    expect(current.at(-1)!.message).toBe('message number 11');
    expect(log.recent).toHaveLength(12);
  });

  it('formats diagnostics without contents', () => {
    const text = formatDiagnostics({
      generatedAt: '2026-09-25T10:00:00Z',
      versions: { electron: '44.4.5' },
      paths: { library: 'C:/Users/u/.amc/library' },
      settings: { theme: 'dark' },
      tools: [
        {
          id: 'claude-code',
          installed: true,
          version: '3.1.0',
          roots: { claude: 'C:/Users/u/.claude' },
        },
      ],
      counts: { items: 12, deployments: 4 },
      warnings: ['settings.json: autoApply'],
      recentLogs: [{ ts: '2026-09-25T10:00:00Z', level: 'info', scope: 'app', message: 'ready' }],
    });
    expect(text).toContain('# AMC diagnostics');
    expect(text).toContain('- claude-code: installed (3.1.0)');
    expect(text).toContain('- items: 12');
    expect(text).toContain('settings.json: autoApply');
  });
});
