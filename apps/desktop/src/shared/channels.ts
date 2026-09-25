/**
 * Channel names as plain data, with no Zod import, so the sandboxed preload can build the
 * `window.amc` surface without pulling the schemas in. A test asserts this list matches
 * `ipcContract` exactly, so the two can never drift.
 */
export const CHANNEL_NAMES = [
  'system.probe',
  'system.diagnostics',
  'system.status',
  'settings.get',
  'settings.update',
  'dialog.pickFolder',
  'library.list',
  'library.get',
  'library.search',
  'library.create',
  'library.update',
  'library.rename',
  'library.duplicate',
  'library.delete',
  'library.relations',
  'library.history',
  'library.restore',
  'library.templates',
  'library.validate',
  'tools.detect',
  'targets.list',
  'targets.addProject',
  'targets.removeProject',
  'compile.preview',
  'deploy.plan',
  'deploy.apply',
  'deploy.history',
  'deploy.planRollback',
  'deploy.matrix',
  'deploy.incomplete',
  'deploy.recover',
  'index.rebuild',
] as const;

export type ChannelName = (typeof CHANNEL_NAMES)[number];
