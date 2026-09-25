import { join } from 'node:path';
import { z } from 'zod';
import { AmcError } from '../errors';
import type { FsPort } from '../fs/fs-port';
import { stripBom } from '../fs/text';

/** `~/.amc/state/settings.json` (T1.5.6). Unknown keys are dropped, never trusted. */
export const settingsSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  /** Ask before applying a plan, or apply automatically when it has no conflicts. */
  autoApply: z.enum(['ask', 'when-no-conflicts']).default('ask'),
  /** Registered project targets (absolute paths), shown alongside the global scopes. */
  projectRoots: z.array(z.string()).default([]),
  /** Tool ids the user switched off even though they were detected. */
  disabledTools: z.array(z.string()).default([]),
  snapshots: z
    .object({
      keep: z.number().int().min(1).max(500).default(50),
      maxAgeDays: z.number().int().min(1).max(3650).default(30),
    })
    .default({ keep: 50, maxAgeDays: 30 }),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  /** Seen the onboarding flow; it can be re-run from Settings. */
  onboarded: z.boolean().default(false),
});

export type Settings = z.infer<typeof settingsSchema>;

export const defaultSettings = (): Settings => settingsSchema.parse({});

export const SETTINGS_FILE = 'settings.json';

/**
 * Settings are a convenience, never a source of truth: an unreadable or invalid file falls back
 * to defaults (with a warning) rather than blocking startup.
 */
export class SettingsStore {
  private current: Settings = defaultSettings();
  private loaded = false;
  readonly warnings: string[] = [];

  constructor(
    private readonly fs: FsPort,
    private readonly stateDir: string,
  ) {}

  private get path(): string {
    return join(this.stateDir, SETTINGS_FILE);
  }

  async load(): Promise<Settings> {
    this.loaded = true;
    if (!(await this.fs.stat(this.path))) return this.current;
    try {
      const raw: unknown = JSON.parse(
        stripBom((await this.fs.readFile(this.path)).toString('utf8')),
      );
      const parsed = settingsSchema.safeParse(raw);
      if (parsed.success) this.current = parsed.data;
      else {
        // Keep whatever fields are valid; fall back to the default for the rest.
        this.current = settingsSchema.parse({
          ...(typeof raw === 'object' && raw !== null ? raw : {}),
          ...invalidKeys(parsed.error),
        });
        this.warnings.push(
          `${SETTINGS_FILE}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
        );
      }
    } catch (err) {
      this.warnings.push(`${SETTINGS_FILE}: ${(err as Error).message}; using defaults`);
    }
    return this.current;
  }

  get(): Settings {
    if (!this.loaded)
      throw new AmcError('SETTINGS_NOT_LOADED', 'SettingsStore.load() must run first');
    return this.current;
  }

  /** Merges a partial patch, validates the result, and writes it atomically. */
  async update(patch: Partial<Settings>): Promise<Settings> {
    const next = settingsSchema.safeParse({ ...this.current, ...patch });
    if (!next.success) {
      throw new AmcError(
        'SETTINGS_INVALID',
        next.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
        next.error.issues,
      );
    }
    this.current = next.data;
    this.loaded = true;
    await this.fs.writeFileAtomic(this.path, JSON.stringify(this.current, null, 2) + '\n');
    return this.current;
  }
}

/** Replaces only the fields Zod rejected, so one bad value doesn't reset everything. */
function invalidKeys(error: z.ZodError): Record<string, undefined> {
  const out: Record<string, undefined> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === 'string') out[key] = undefined;
  }
  return out;
}
