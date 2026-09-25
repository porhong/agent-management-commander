import {
  AmcError,
  adoptCandidates,
  CORE_RULES,
  ITEM_TEMPLATES,
  Validator,
  buildGraph,
  checkDrift,
  looksBinary,
  parseManifest,
  resolveClosure,
  scanTargets,
  targetId,
  type Content,
  type DeployPlan,
  type LibraryItem,
  type PlannedChange,
  type RefRelation,
  type Target,
} from '@amc/core';
import type { Channel, ChannelInput, ChannelOutput, TargetRef } from '../shared/ipc-contract';
import { targetLabel, type AppServices } from './app-services';

/** Native dialogs, injected so handlers stay free of Electron and testable. */
export interface DialogPort {
  pickFolder(title?: string): Promise<string | null>;
}

/** The two things only the shell can do, injected for the same reason. */
export interface ShellPort {
  openPath(path: string): Promise<boolean>;
  relaunch(): void;
}

/**
 * Release checks (T1.10.4). Injected so the handlers stay Electron-free and so a test can drive
 * every branch without a network or a published release.
 */
export interface UpdaterPort {
  /** The newer version, or null when this build is current. Throws if the check fails. */
  check(): Promise<{ version: string } | null>;
  /** Downloads what `check` found. Throws if there is nothing to download. */
  download(): Promise<void>;
  /** Quits and installs. Returns false when there is nothing downloaded to install. */
  install(): boolean;
}

export type HandlerMap = {
  [C in Channel]: (input: ChannelInput<C>) => Promise<ChannelOutput<C>> | ChannelOutput<C>;
};

export interface HandlerDeps {
  services: AppServices;
  dialog: DialogPort;
  probe: () => ChannelOutput<'system.probe'>;
  /** Omitted in tests, where revealing a folder and restarting are both no-ops. */
  shell?: ShellPort;
  /** `app.getVersion()`; only main can ask Electron for it. */
  version?: string;
  /** Omitted in development and in tests, where there is no packaged build to update. */
  updater?: UpdaterPort;
}

const toBase64 = (files: Record<string, Buffer>): Record<string, string> =>
  Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.toString('base64')]));

const wireItem = (item: LibraryItem): ChannelOutput<'library.get'> => ({
  manifest: item.manifest as unknown as Record<string, unknown>,
  body: item.body,
  files: toBase64(item.files),
});

const contentToWire = (c: Content | null): { text: string | null; binary: boolean } => {
  if (c === null) return { text: null, binary: false };
  if (typeof c === 'string') return { text: c, binary: false };
  return looksBinary(c)
    ? { text: null, binary: true }
    : { text: c.toString('utf8'), binary: false };
};

function wireChange(c: PlannedChange) {
  const before = contentToWire(c.before);
  const after = contentToWire(c.after);
  return {
    id: c.id,
    op: c.op,
    targetId: c.targetId,
    root: c.root,
    relPath: c.relPath,
    ...(c.region && { region: c.region }),
    itemId: c.itemId,
    before: before.text,
    after: after.text,
    ...(before.binary || after.binary ? { binary: true } : {}),
    adaptations: c.adaptations,
    ...(c.op === 'conflict' && { reason: c.reason, pending: c.pending, options: c.options }),
  };
}

export function createHandlers({
  services,
  dialog,
  probe,
  shell,
  version = '0.0.0',
  updater,
}: HandlerDeps): HandlerMap {
  const { library, deploy, index, settings, logger, adapters, tokens } = services;
  const log = logger.child('ipc');

  /** Resolves a renderer target reference, turning a folder token back into a path. */
  const toTarget = (ref: TargetRef): Target =>
    ref.scope === 'global'
      ? { toolId: ref.toolId, scope: 'global' }
      : { toolId: ref.toolId, scope: 'project', root: tokens.resolve(ref.token) };

  const displayName = (toolId: string) => adapters.get(toolId).displayName;

  const wirePlan = (plan: DeployPlan): ChannelOutput<'deploy.plan'> => ({
    planId: plan.planId,
    kind: plan.kind,
    createdAt: plan.createdAt,
    ...(plan.revertsDeployId && { revertsDeployId: plan.revertsDeployId }),
    issues: plan.issues,
    targets: plan.targets.map((t) => ({
      targetId: t.targetId,
      label: targetLabel(t.target, displayName(t.target.toolId)),
      status: t.status,
      ...(t.message && { message: t.message }),
      changes: t.changes.map(wireChange),
    })),
  });

  /** Plans are kept in main and pruned, so a planId can't be guessed or replayed forever. */
  const remember = (plan: DeployPlan): DeployPlan => {
    services.plans.set(plan.planId, plan);
    if (services.plans.size > 20) services.plans.delete(services.plans.keys().next().value!);
    return plan;
  };

  const loadLibrary = async () => (await library.load()).items;

  return {
    // ---------- system ----------
    'system.probe': () => probe(),

    'system.diagnostics': async () => {
      const { formatDiagnostics } = await import('@amc/core');
      const tools = await Promise.all(
        adapters.list().map(async (a) => {
          const d = await a.detect();
          return {
            id: a.id,
            installed: d.installed,
            ...(d.version && { version: d.version }),
            roots: d.roots,
          };
        }),
      );
      return {
        text: formatDiagnostics({
          generatedAt: new Date().toISOString(),
          versions: probe().versions,
          paths: services.paths as unknown as Record<string, string>,
          settings: settings.get() as unknown as Record<string, unknown>,
          tools,
          counts: {
            items: index.listItems().length,
            deployments: index.deployments().length,
            targets: services.targets().length,
          },
          warnings: services.warnings,
          recentLogs: logger.recent.slice(-50),
        }),
      };
    },

    'system.status': () => ({
      ready: true,
      version,
      home: services.paths.home,
      warnings: services.warnings,
      counts: {
        items: index.listItems().length,
        deployments: index.deployments().length,
        targets: services.targets().length,
      },
    }),

    'system.reveal': async ({ what }) => {
      const { home, library: libraryDir, logs } = services.paths;
      const path = { home, library: libraryDir, logs }[what];
      return { opened: (await shell?.openPath(path)) ?? false };
    },

    'system.relaunch': () => {
      log.info('relaunching');
      shell?.relaunch();
      return { relaunching: shell !== undefined };
    },

    // ---------- updates (T1.10.4) ----------
    'updates.check': async () => {
      if (settings.get().updates === 'off') return { state: 'off' as const };
      if (!updater) return { state: 'unsupported' as const };
      try {
        const found = await updater.check();
        log.info('update check', { found: found?.version ?? null });
        return found
          ? { state: 'available' as const, version: found.version }
          : { state: 'current' as const, version };
      } catch (err) {
        return { state: 'error' as const, message: (err as Error).message };
      }
    },

    'updates.download': async () => {
      if (!updater) return { downloaded: false, message: 'Updates are not available here.' };
      try {
        await updater.download();
        return { downloaded: true };
      } catch (err) {
        return { downloaded: false, message: (err as Error).message };
      }
    },

    'updates.install': () => ({ installing: updater?.install() ?? false }),

    // ---------- status (T1.9.3) ----------
    'status.drift': async () => {
      const report = await checkDrift({ fs: services.fs, adapters }, services.targets());
      return {
        checkedAt: report.checkedAt,
        warnings: report.warnings,
        entries: report.entries
          .filter((e) => e.state !== 'in-sync')
          .map((e) => ({
            targetId: e.targetId,
            root: e.root,
            relPath: e.relPath,
            ...(e.region && { region: e.region }),
            itemId: e.itemId,
            state: e.state,
          })),
      };
    },

    // ---------- settings ----------
    'settings.get': () => settings.get() as unknown as Record<string, unknown>,
    'settings.update': async ({ patch }) => {
      const next = await settings.update(patch as never);
      logger.level = next.logLevel;
      services.emit('settings.changed', { keys: Object.keys(patch) });
      return next as unknown as Record<string, unknown>;
    },

    // ---------- dialogs ----------
    'dialog.pickFolder': async ({ title }) => {
      const path = await dialog.pickFolder(title);
      return path === null ? null : { token: tokens.issue(path), path };
    },

    // ---------- library ----------
    'library.list': ({ kind, tag }) =>
      index.listItems({ ...(kind && { kind }), ...(tag && { tag }) }),
    'library.search': ({ query, limit }) => index.search(query, limit),
    'library.get': async ({ id }) => wireItem(await library.get(id)),

    'library.templates': () =>
      ITEM_TEMPLATES.map((t) => ({ id: t.id, kind: t.kind, title: t.title, summary: t.summary })),

    'library.create': async (input) => {
      const item = await library.create(input as never);
      index.upsertItem(item);
      log.info('item created', { id: item.manifest.id });
      services.emit('library.changed', { ids: [item.manifest.id], reason: 'create' });
      return wireItem(item);
    },

    'library.update': async ({ id, fields, body, bump }) => {
      const item = await library.update(id, {
        ...(fields && { fields }),
        ...(body !== undefined && { body }),
        ...(bump && { bump }),
      });
      index.upsertItem(item);
      services.emit('library.changed', { ids: [id], reason: 'update' });
      return wireItem(item);
    },

    'library.rename': async ({ id, slug }) => {
      const item = await library.rename(id, slug);
      index.upsertItem(item);
      services.emit('library.changed', { ids: [id], reason: 'rename' });
      return wireItem(item);
    },

    'library.duplicate': async ({ id, slug }) => {
      const item = await library.duplicate(id, slug);
      index.upsertItem(item);
      services.emit('library.changed', { ids: [item.manifest.id], reason: 'create' });
      return wireItem(item);
    },

    'library.delete': async ({ id }) => {
      await library.delete(id);
      index.removeItem(id);
      log.info('item deleted', { id });
      services.emit('library.changed', { ids: [id], reason: 'delete' });
      return { deleted: true as const };
    },

    'library.relations': ({ id }) => ({
      uses: index.uses(id).map((r) => ({ id: r.to, relation: r.relation, mode: r.mode })),
      usedBy: index.usedBy(id).map((r) => ({ id: r.from, relation: r.relation, mode: r.mode })),
    }),

    'library.graph': () => ({
      edges: index
        .listItems()
        .flatMap((row) => index.uses(row.id))
        .map((r) => ({ from: r.from, to: r.to, relation: r.relation, mode: r.mode })),
    }),

    'library.history': async ({ id }) =>
      (await library.history(id)).map((h) => ({
        rev: h.rev,
        summary: h.summary,
        timestamp: h.timestamp,
      })),

    'library.at': async ({ id, rev }) => wireItem(await library.at(id, rev)),

    'library.restore': async ({ id, rev }) => {
      const item = await library.restore(id, rev);
      index.upsertItem(item);
      services.emit('library.changed', { ids: [id], reason: 'restore' });
      return wireItem(item);
    },

    'library.validate': async () => {
      const { items, problems } = await library.load();
      const validator = new Validator([...CORE_RULES, ...adapters.rules()]);
      return {
        issues: validator.validate({
          items,
          problems,
          targets: services.targets().map((t) => ({ id: targetId(t), toolId: t.toolId })),
          deployed: new Set(index.deployments().map((d) => d.itemId)),
        }),
      };
    },

    // ---------- tools & targets ----------
    'tools.detect': async () =>
      Promise.all(
        adapters.list().map(async (a) => {
          const d = await a.detect();
          return {
            toolId: a.id,
            displayName: a.displayName,
            installed: d.installed,
            ...(d.version && { version: d.version }),
            roots: d.roots,
            notes: d.notes,
            capabilities: a.capabilities as unknown as Record<string, unknown>,
          };
        }),
      ),

    'targets.list': () =>
      services.targets().map((t) => ({
        targetId: targetId(t),
        toolId: t.toolId,
        scope: t.scope,
        label: targetLabel(t, displayName(t.toolId)),
        ...(t.scope === 'project' && { root: t.root, token: tokens.issue(t.root) }),
        roots: adapters.get(t.toolId).paths(t),
      })),

    'targets.addProject': async ({ token }) => {
      const root = tokens.resolve(token);
      const roots = settings.get().projectRoots;
      if (roots.includes(root)) return { added: false, root };
      await settings.update({ projectRoots: [...roots, root] });
      log.info('project target registered', { root });
      services.emit('targets.changed', { targetIds: services.targets().map((t) => targetId(t)) });
      await services.refreshIndex();
      return { added: true, root };
    },

    // Removing a project only stops managing it; files on disk are left alone (T1.7.1).
    'targets.removeProject': async ({ root }) => {
      const roots = settings.get().projectRoots;
      if (!roots.includes(root)) return { removed: false };
      await settings.update({ projectRoots: roots.filter((r) => r !== root) });
      services.emit('targets.changed', { targetIds: services.targets().map((t) => targetId(t)) });
      await services.refreshIndex();
      return { removed: true };
    },

    // ---------- compile preview ----------
    'compile.preview': async ({ id, target, draft }) => {
      const t = toTarget(target);
      const items = await loadLibrary();
      // An unsaved draft replaces its saved self in the graph, so the preview reflects the
      // editor while its references still resolve against the real library.
      const withDraft = draft
        ? items.map((item) =>
            item.manifest.id === id
              ? {
                  ...item,
                  // Identity stays the saved one: a preview can't rename or re-kind an item.
                  manifest: parseManifest({
                    ...draft.manifest,
                    id: item.manifest.id,
                    kind: item.manifest.kind,
                    slug: item.manifest.slug,
                  }),
                  body: draft.body,
                }
              : item,
          )
        : items;
      const resolved = resolveClosure(buildGraph(withDraft), [id]).at(-1)!;
      return {
        files: adapters
          .get(t.toolId)
          .compile(resolved, t)
          .map((f) => {
            const wire = contentToWire(f.content);
            return {
              root: f.root,
              relPath: f.relPath,
              content: wire.text ?? '',
              binary: wire.binary,
              adaptations: f.adaptations,
            };
          }),
      };
    },

    // ---------- import (M1.8) ----------
    'import.scan': async ({ targetIds }) => {
      const started = Date.now();
      const all = services.targets();
      const chosen = targetIds?.length ? all.filter((t) => targetIds.includes(targetId(t))) : all;
      const existing = new Set(index.listItems().map((row) => row.id));
      const scan = await scanTargets(
        {
          adapters,
          onProgress: (p) =>
            services.emit('scan.progress', {
              toolId: p.toolId,
              done: p.done,
              total: p.total,
              ...(p.label && { label: p.label }),
            }),
        },
        chosen,
        existing,
      );

      const scanId = `scan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      services.scans.set(scanId, scan);
      if (services.scans.size > 5) {
        services.scans.delete(services.scans.keys().next().value!);
      }

      const byId = new Map(scan.candidates.map((c) => [c.id, c]));
      const labelOf = (tid: string) =>
        all
          .filter((t) => targetId(t) === tid)
          .map((t) => targetLabel(t, displayName(t.toolId)))[0] ?? tid;

      log.info('import scan', { targets: chosen.length, groups: scan.groups.length });

      return {
        scanId,
        fileCount: scan.fileCount,
        durationMs: Date.now() - started,
        warnings: scan.warnings,
        groups: scan.groups.map((group) => {
          const canonical = byId.get(group.canonicalId)!;
          return {
            key: group.key,
            kind: group.kind,
            slug: group.slug,
            name: canonical.item.manifest.name,
            description: canonical.item.manifest.description,
            body: canonical.item.body,
            ...(group.existingId && { existingId: group.existingId }),
            canonicalId: group.canonicalId,
            sources: group.sources.flatMap((source) => {
              const candidate = byId.get(source.candidateId);
              if (!candidate) return [];
              return [
                {
                  candidateId: candidate.id,
                  targetId: candidate.targetId,
                  toolId: candidate.toolId,
                  label: labelOf(candidate.targetId),
                  relPath: candidate.entry,
                  linked: candidate.linked,
                  reason: source.reason,
                  similarity: source.similarity,
                  warnings: candidate.warnings,
                },
              ];
            }),
            suggestions: group.suggestions,
          };
        }),
      };
    },

    'import.adopt': async ({ scanId, items }) => {
      const scan = services.scans.get(scanId);
      if (!scan) {
        throw new AmcError('SCAN_STALE', 'That scan is no longer available. Scan again.');
      }
      const result = await adoptCandidates(
        library,
        scan,
        items.map((item) => ({
          key: item.key,
          slug: item.slug,
          ...(item.candidateId && { candidateId: item.candidateId }),
          ...(item.links && {
            links: item.links.map((l) => ({ to: l.to, relation: l.relation as RefRelation })),
          }),
        })),
      );
      if (result.created.length > 0) {
        await services.refreshIndex();
        services.emit('library.changed', { ids: result.created, reason: 'create' });
      }
      log.info('import adopted', {
        created: result.created.length,
        skipped: result.skipped.length,
      });
      return result;
    },

    // ---------- deploy ----------
    'deploy.plan': async ({ selections }) => {
      const { items, problems } = await library.load();
      const plan = remember(
        await deploy.plan({
          items,
          problems,
          selections: selections.map((s) => ({ target: toTarget(s.target), items: s.items })),
        }),
      );
      log.info('plan created', {
        planId: plan.planId,
        targets: plan.targets.length,
        changes: plan.targets.reduce((n, t) => n + t.changes.length, 0),
      });
      return wirePlan(plan);
    },

    'deploy.apply': async ({ planId, resolutions }) => {
      const plan = services.plans.get(planId);
      if (!plan)
        throw new AmcError('PLAN_STALE', 'That plan is no longer available. Create a new one.');
      services.emit('deploy.progress', { phase: 'applying', done: 0, total: 1 });
      const report = await deploy.apply(plan, resolutions ?? {});
      services.plans.delete(planId);
      for (const dir of new Set(plan.targets.flatMap((t) => Object.values(t.roots)))) {
        const lock = index.getLockfile(dir);
        if (lock) index.setLockfile(dir, lock);
      }
      await services.refreshIndex();
      await deploy.prune(settings.get().snapshots);
      log.info('plan applied', {
        deployId: report.deployId,
        written: report.written.length,
        deleted: report.deleted.length,
      });
      services.emit('deploy.progress', {
        deployId: report.deployId,
        phase: 'done',
        done: 1,
        total: 1,
      });
      return {
        deployId: report.deployId,
        written: report.written,
        deleted: report.deleted,
        skipped: report.skipped,
      };
    },

    'deploy.history': async () =>
      (await deploy.history()).map((m) => ({
        deployId: m.deployId,
        kind: m.kind,
        createdAt: m.createdAt,
        ...(m.revertsDeployId && { revertsDeployId: m.revertsDeployId }),
        fileCount: m.entries.filter((e) => e.relPath !== '.amc-lock.json').length,
      })),

    // Read-only: the snapshot manifest records what each op did, per target.
    'deploy.report': async ({ deployId }) => {
      const manifest = await deploy.readManifest(deployId);
      const byTarget = new Map<string, ChannelOutput<'deploy.report'>['targets'][number]>();
      for (const entry of manifest.entries) {
        // Lockfiles carry no item and are bookkeeping, not something the user deployed.
        if (entry.relPath === '.amc-lock.json') continue;
        const group = byTarget.get(entry.targetId) ?? { targetId: entry.targetId, files: [] };
        group.files.push({
          root: entry.root,
          relPath: entry.relPath,
          ...(entry.itemId && { itemId: entry.itemId }),
          op: !entry.afterFile ? 'delete' : entry.existed ? 'update' : 'create',
        });
        byTarget.set(entry.targetId, group);
      }
      return {
        deployId: manifest.deployId,
        kind: manifest.kind,
        createdAt: manifest.createdAt,
        ...(manifest.revertsDeployId && { revertsDeployId: manifest.revertsDeployId }),
        targets: [...byTarget.values()],
      };
    },

    'deploy.planRollback': async ({ deployId }) =>
      wirePlan(remember(await deploy.planRollback(deployId))),

    'deploy.matrix': () => index.matrix(),

    'deploy.incomplete': async () =>
      (await deploy.incomplete()).map((j) => ({ deployId: j.deployId, startedAt: j.startedAt })),

    'deploy.recover': async ({ deployId, mode }) => {
      await deploy.recover(deployId, mode);
      await services.refreshIndex();
      log.warn('recovered an interrupted deploy', { deployId, mode });
      return { recovered: true as const };
    },

    // ---------- index ----------
    'index.rebuild': () => services.refreshIndex(),
  };
}
