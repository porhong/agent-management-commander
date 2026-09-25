import {
  AmcError,
  CORE_RULES,
  ITEM_TEMPLATES,
  Validator,
  buildGraph,
  looksBinary,
  resolveClosure,
  targetId,
  type Content,
  type DeployPlan,
  type LibraryItem,
  type PlannedChange,
  type Target,
} from '@amc/core';
import type { Channel, ChannelInput, ChannelOutput, TargetRef } from '../shared/ipc-contract';
import { targetLabel, type AppServices } from './app-services';

/** Native dialogs, injected so handlers stay free of Electron and testable. */
export interface DialogPort {
  pickFolder(title?: string): Promise<string | null>;
}

export type HandlerMap = {
  [C in Channel]: (input: ChannelInput<C>) => Promise<ChannelOutput<C>> | ChannelOutput<C>;
};

export interface HandlerDeps {
  services: AppServices;
  dialog: DialogPort;
  probe: () => ChannelOutput<'system.probe'>;
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

export function createHandlers({ services, dialog, probe }: HandlerDeps): HandlerMap {
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
      home: services.paths.home,
      warnings: services.warnings,
      counts: {
        items: index.listItems().length,
        deployments: index.deployments().length,
        targets: services.targets().length,
      },
    }),

    // ---------- settings ----------
    'settings.get': () => settings.get() as unknown as Record<string, unknown>,
    'settings.update': async ({ patch }) => {
      const next = await settings.update(patch as never);
      logger.level = next.logLevel;
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
        ...(t.scope === 'project' && { root: t.root }),
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
    'compile.preview': async ({ id, target }) => {
      const t = toTarget(target);
      const resolved = resolveClosure(buildGraph(await loadLibrary()), [id]).at(-1)!;
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
