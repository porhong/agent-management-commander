import { join } from 'node:path';
import type { FsPort } from '../fs/fs-port';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogFields {
  [key: string]: string | number | boolean | null | undefined | string[];
}

export interface LogRecord {
  ts: string;
  level: LogLevel;
  scope: string;
  message: string;
  fields?: LogFields;
}

/**
 * Field names whose values are file *contents*, which must never reach a log file
 * (T1.5.6: logs hold paths and hashes only). Dropped even if a caller passes them.
 */
const CONTENT_KEYS = new Set([
  'content',
  'body',
  'before',
  'after',
  'text',
  'data',
  'prompt',
  'description',
  'secret',
  'token',
]);

const MAX_VALUE = 200;

export function redact(fields: LogFields | undefined): LogFields | undefined {
  if (!fields) return undefined;
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (CONTENT_KEYS.has(k.toLowerCase())) {
      out[k] = '[redacted]';
      continue;
    }
    if (typeof v === 'string' && v.length > MAX_VALUE)
      out[k] = `${v.slice(0, MAX_VALUE)}…[${v.length}]`;
    else if (Array.isArray(v))
      out[k] = v.slice(0, 20).map((s) => (s.length > MAX_VALUE ? `${s.slice(0, MAX_VALUE)}…` : s));
    else out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export interface LoggerOptions {
  fs: FsPort;
  dir: string;
  level?: LogLevel;
  /** Rotate once the current file passes this size. */
  maxBytes?: number;
  /** Rotated files kept besides the current one. */
  maxFiles?: number;
  now?: () => Date;
  /** Also mirror records here (the terminal in dev). */
  sink?: (record: LogRecord, line: string) => void;
}

export const LOG_FILE = 'amc.log';

/**
 * Line-delimited JSON log with size-based rotation (`amc.log` → `amc.1.log` → …). Writes are
 * queued, so records keep their order and a failing write never rejects into a caller.
 */
export class Logger {
  private readonly fs: FsPort;
  private readonly dir: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private readonly now: () => Date;
  private readonly sink: LoggerOptions['sink'];
  private queue: Promise<void> = Promise.resolve();
  private size: number | null = null;
  level: LogLevel;
  /** Kept in memory for "Copy diagnostics", so it never has to read the log back. */
  readonly recent: LogRecord[] = [];

  constructor(opts: LoggerOptions) {
    this.fs = opts.fs;
    this.dir = opts.dir;
    this.level = opts.level ?? 'info';
    this.maxBytes = opts.maxBytes ?? 2_000_000;
    this.maxFiles = opts.maxFiles ?? 5;
    this.now = opts.now ?? (() => new Date());
    this.sink = opts.sink;
  }

  child(scope: string) {
    return {
      debug: (message: string, fields?: LogFields) => this.log('debug', scope, message, fields),
      info: (message: string, fields?: LogFields) => this.log('info', scope, message, fields),
      warn: (message: string, fields?: LogFields) => this.log('warn', scope, message, fields),
      error: (message: string, fields?: LogFields) => this.log('error', scope, message, fields),
    };
  }

  log(level: LogLevel, scope: string, message: string, fields?: LogFields): void {
    if (RANK[level] < RANK[this.level]) return;
    const record: LogRecord = {
      ts: this.now().toISOString(),
      level,
      scope,
      message,
      ...(redact(fields) && { fields: redact(fields) }),
    };
    this.recent.push(record);
    if (this.recent.length > 500) this.recent.shift();
    const line = JSON.stringify(record) + '\n';
    this.sink?.(record, line);
    this.queue = this.queue.then(() => this.append(line)).catch(() => undefined);
  }

  /** Resolves once every queued record is on disk. */
  flush(): Promise<void> {
    return this.queue;
  }

  private async append(line: string): Promise<void> {
    const path = join(this.dir, LOG_FILE);
    if (this.size === null) this.size = (await this.fs.stat(path))?.size ?? 0;
    const bytes = Buffer.byteLength(line);
    if (this.size > 0 && this.size + bytes > this.maxBytes) {
      await this.rotate();
      this.size = 0;
    }
    const existing = this.size > 0 ? await this.fs.readFile(path) : Buffer.alloc(0);
    await this.fs.writeFileAtomic(path, Buffer.concat([existing, Buffer.from(line)]));
    this.size += bytes;
  }

  private async rotate(): Promise<void> {
    const name = (n: number) => join(this.dir, n === 0 ? LOG_FILE : `amc.${n}.log`);
    await this.fs.rm(name(this.maxFiles));
    for (let n = this.maxFiles - 1; n >= 0; n--) {
      if (await this.fs.stat(name(n))) await this.fs.rename(name(n), name(n + 1));
    }
  }
}

export interface Diagnostics {
  generatedAt: string;
  versions: Record<string, string>;
  paths: Record<string, string>;
  settings: Record<string, unknown>;
  tools: Array<{ id: string; installed: boolean; version?: string; roots: Record<string, string> }>;
  counts: Record<string, number>;
  warnings: string[];
  recentLogs: LogRecord[];
}

/** Text for the "Copy diagnostics" action: no file contents, just paths, versions, and counts. */
export function formatDiagnostics(d: Diagnostics): string {
  const section = (title: string, body: string) => `## ${title}\n${body}\n`;
  const kv = (o: Record<string, unknown>) =>
    Object.entries(o)
      .map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`)
      .join('\n') || '- (none)';
  return [
    `# AMC diagnostics (${d.generatedAt})`,
    '',
    section('Versions', kv(d.versions)),
    section('Paths', kv(d.paths)),
    section('Settings', kv(d.settings)),
    section(
      'Tools',
      d.tools
        .map(
          (t) =>
            `- ${t.id}: ${t.installed ? 'installed' : 'not found'}${t.version ? ` (${t.version})` : ''} ${JSON.stringify(t.roots)}`,
        )
        .join('\n') || '- (none)',
    ),
    section('Counts', kv(d.counts)),
    section('Warnings', d.warnings.map((w) => `- ${w}`).join('\n') || '- (none)'),
    section('Recent logs', d.recentLogs.map((r) => JSON.stringify(r)).join('\n') || '(none)'),
  ].join('\n');
}
