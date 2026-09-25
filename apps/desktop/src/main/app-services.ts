import { join } from 'node:path';
import {
  AdapterRegistry,
  CORE_RULES,
  DeployService,
  GitService,
  LibraryService,
  Logger,
  NodeFs,
  SettingsStore,
  SqliteIndexStore,
  Validator,
  bootstrapHome,
  defaultAmcHome,
  nodeAdapterHost,
  readLockfile,
  targetId,
  type AdapterHost,
  type AmcPaths,
  type DeployPlan,
  type ScanResult,
  type FsPort,
  type Lockfile,
  type Target,
} from '@amc/core';
import { createClaudeCodeAdapter } from '@amc/adapter-claude-code';
import { createCodexAdapter } from '@amc/adapter-codex-cli';
import type { EventName, EventPayload } from '../shared/ipc-contract';
import { PathTokenRegistry } from './path-tokens';
import { WorkerClient, type SpawnWorker } from './worker/client';
import { fromWire } from './worker/protocol';

export type Emit = <E extends EventName>(name: E, payload: EventPayload<E>) => void;

export interface AppServices {
  fs: FsPort;
  paths: AmcPaths;
  settings: SettingsStore;
  logger: Logger;
  index: SqliteIndexStore;
  library: LibraryService;
  deploy: DeployService;
  adapters: AdapterRegistry;
  tokens: PathTokenRegistry;
  emit: Emit;
  worker: WorkerClient;
  /** Plans live in main; the renderer only ever holds a planId (T1.5.2). */
  plans: Map<string, DeployPlan>;
  /** Import scans, held here so the renderer only ever passes a scanId. */
  scans: Map<string, ScanResult>;
  warnings: string[];
  /** Every target the user has: global scopes plus registered projects. */
  targets(): Target[];
  /** Reloads the index from the library and the lockfiles. */
  refreshIndex(): Promise<{ items: number; durationMs: number }>;
  close(): void;
}

export interface CreateServicesOptions {
  home?: string;
  fs?: FsPort;
  host?: AdapterHost;
  emit?: Emit;
  /** `:memory:` in tests. */
  indexPath?: string;
  /** Omitted means library scans run in-process (tests, and as a fallback). */
  spawnWorker?: SpawnWorker;
  /** Called when the utility process could not be used and the work ran in-process instead. */
  onWorkerFallback?: (reason: string) => void;
}

export const targetLabel = (t: Target, displayName: string): string =>
  t.scope === 'global' ? `${displayName} · Global` : `${displayName} · ${t.root}`;

export async function createAppServices(opts: CreateServicesOptions = {}): Promise<AppServices> {
  const fs = opts.fs ?? new NodeFs();
  const paths = await bootstrapHome(fs, opts.home ?? defaultAmcHome());
  const emit: Emit = opts.emit ?? (() => undefined);

  const settings = new SettingsStore(fs, paths.state);
  await settings.load();

  const logger = new Logger({ fs, dir: paths.logs, level: settings.get().logLevel });
  const log = logger.child('app');

  const host = opts.host ?? nodeAdapterHost();
  const adapters = new AdapterRegistry([createClaudeCodeAdapter(host), createCodexAdapter(host)]);

  const index = new SqliteIndexStore(opts.indexPath ?? join(paths.state, 'index.sqlite'));

  const git = new GitService(paths.library);
  await git.init();
  const library = new LibraryService({ fs, root: paths.library, history: git });

  const deploy = new DeployService({
    fs,
    paths,
    adapters,
    validator: new Validator([...CORE_RULES, ...adapters.rules()]),
    lockMirror: {
      get: (dir) => index.getLockfile(dir),
      set: (dir, lock) => index.setLockfile(dir, lock),
    },
  });

  const worker = new WorkerClient({
    ...(opts.spawnWorker && { spawn: opts.spawnWorker }),
    onFallback: (reason) => {
      log.warn('utility process unavailable; scanning in-process', { reason });
      opts.onWorkerFallback?.(reason);
    },
  });

  const tokens = new PathTokenRegistry();
  const warnings = [...settings.warnings];

  const services: AppServices = {
    fs,
    paths,
    settings,
    logger,
    index,
    library,
    deploy,
    adapters,
    tokens,
    emit,
    worker,
    plans: new Map(),
    scans: new Map(),
    warnings,

    targets(): Target[] {
      const enabled = adapters.list().filter((a) => !settings.get().disabledTools.includes(a.id));
      return [
        ...enabled.map((a): Target => ({ toolId: a.id, scope: 'global' })),
        ...settings
          .get()
          .projectRoots.flatMap((root) =>
            enabled.map((a): Target => ({ toolId: a.id, scope: 'project', root })),
          ),
      ];
    },

    async refreshIndex() {
      const started = Date.now();
      // Reading and parsing every item is the slow part, so it runs off the main event loop.
      const loaded = await worker.run('library.load', { root: paths.library });
      const items = loaded.items.map(fromWire);
      for (const p of loaded.problems) {
        log.warn('library item could not be read', { path: p.path, reason: p.message });
        emit('log.warning', { scope: 'library', message: `${p.path}: ${p.message}` });
      }

      // One lockfile per distinct root folder across every target.
      const lockfiles: Array<{ rootDir: string; lock: Lockfile }> = [];
      const seen = new Set<string>();
      for (const target of services.targets()) {
        for (const dir of Object.values(adapters.get(target.toolId).paths(target))) {
          if (seen.has(dir)) continue;
          seen.add(dir);
          try {
            const read = await readLockfile(fs, dir);
            if (read.hash !== null) lockfiles.push({ rootDir: dir, lock: read.lock });
          } catch (err) {
            log.warn('lockfile unreadable', { rootDir: dir, reason: (err as Error).message });
            emit('log.warning', {
              scope: 'lockfile',
              message: `${dir}: ${(err as Error).message}`,
            });
          }
        }
      }
      index.rebuild({ items, lockfiles });
      const durationMs = Date.now() - started;
      log.info('index rebuilt', { items: items.length, lockfiles: lockfiles.length, durationMs });
      emit('library.changed', { ids: [], reason: 'rebuild' });
      return { items: items.length, durationMs };
    },

    close() {
      worker.dispose();
      index.close();
    },
  };

  await services.refreshIndex();
  log.info('services ready', {
    home: paths.home,
    targets: services.targets().map((t) => targetId(t)),
  });
  return services;
}
