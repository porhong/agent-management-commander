import { z } from 'zod';

/**
 * Single source of truth for renderer ↔ main communication (T1.5.2).
 * Every channel declares its input and output schema; main validates both.
 *
 * There is deliberately **no generic filesystem channel**. The renderer never sends a path:
 * folders are chosen through `dialog.pickFolder`, which returns an opaque token that main
 * resolves back to a path (see `main/path-tokens.ts`).
 */

// ---------- shared shapes ----------

const itemId = z.string().regex(/^(skill|agent|command|workflow)\.[a-z0-9]+(-[a-z0-9]+)*$/);
const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const kind = z.enum(['skill', 'agent', 'command']);

/** A folder the user picked in a native dialog. The renderer only ever sees the token. */
export const pathTokenSchema = z.string().regex(/^tok_[0-9a-f]{32}$/);

export const targetRefSchema = z.union([
  z.object({ toolId: z.string(), scope: z.literal('global') }),
  z.object({ toolId: z.string(), scope: z.literal('project'), token: pathTokenSchema }),
]);
export type TargetRef = z.infer<typeof targetRefSchema>;

const itemRowSchema = z.object({
  id: itemId,
  kind: z.string(),
  slug: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  updatedAt: z.string().nullable(),
});

const libraryItemSchema = z.object({
  manifest: z.record(z.string(), z.unknown()),
  body: z.string(),
  /** Supporting files as base64, so the channel stays JSON-serializable. */
  files: z.record(z.string(), z.string()),
});

const issueSchema = z.object({
  ruleId: z.string(),
  severity: z.enum(['error', 'warning', 'info']),
  message: z.string(),
  itemId: itemId.optional(),
  path: z.string().optional(),
  file: z.string().optional(),
  line: z.number().optional(),
  targetId: z.string().optional(),
  blocking: z.boolean(),
  fix: z
    .object({ label: z.string(), itemId, fields: z.record(z.string(), z.unknown()) })
    .optional(),
});

const adaptationSchema = z.object({ code: z.string(), message: z.string() });

const changeSchema = z.object({
  id: z.string(),
  op: z.enum(['create', 'update', 'delete', 'unchanged', 'conflict']),
  targetId: z.string(),
  root: z.string(),
  relPath: z.string(),
  region: z.string().optional(),
  itemId: z.string(),
  before: z.string().nullable(),
  after: z.string().nullable(),
  /** True when the content is binary and therefore not shown as a diff. */
  binary: z.boolean().optional(),
  adaptations: z.array(adaptationSchema),
  reason: z.enum(['foreign', 'drifted', 'linked']).optional(),
  pending: z.enum(['create', 'update', 'delete']).optional(),
  options: z.array(z.enum(['adopt-replace', 'rename', 'overwrite', 'skip'])).optional(),
});

const planSchema = z.object({
  planId: z.string(),
  kind: z.enum(['deploy', 'rollback']),
  createdAt: z.string(),
  revertsDeployId: z.string().optional(),
  issues: z.array(issueSchema),
  targets: z.array(
    z.object({
      targetId: z.string(),
      label: z.string(),
      status: z.enum(['ok', 'needs-attention']),
      message: z.string().optional(),
      changes: z.array(changeSchema),
    }),
  ),
});

const compiledFileSchema = z.object({
  root: z.string(),
  relPath: z.string(),
  content: z.string(),
  binary: z.boolean(),
  adaptations: z.array(adaptationSchema),
});

export const ipcContract = {
  // ---------- system ----------
  'system.probe': {
    input: z.void(),
    output: z.object({
      versions: z.object({ electron: z.string(), node: z.string(), chrome: z.string() }),
      sqlite: z.object({ ok: z.boolean(), version: z.string().nullable(), fts5: z.boolean() }),
    }),
  },
  'system.diagnostics': { input: z.void(), output: z.object({ text: z.string() }) },
  'system.status': {
    input: z.void(),
    output: z.object({
      ready: z.boolean(),
      home: z.string(),
      warnings: z.array(z.string()),
      counts: z.record(z.string(), z.number()),
    }),
  },

  /** Opens a folder AMC owns in the OS file manager. The renderer names it, never its path. */
  'system.reveal': {
    input: z.object({ what: z.enum(['home', 'library', 'logs']) }),
    output: z.object({ opened: z.boolean() }),
  },
  /** Restarts the app, so a new library location takes effect. */
  'system.relaunch': { input: z.void(), output: z.object({ relaunching: z.boolean() }) },

  // ---------- status (T1.9.3) ----------
  /**
   * Hashes every file AMC owns against the lockfile. Read-only, and cheap enough to run when
   * the window regains focus, so an edit made in a tool folder shows up as drift.
   */
  'status.drift': {
    input: z.void(),
    output: z.object({
      checkedAt: z.string(),
      warnings: z.array(z.string()),
      entries: z.array(
        z.object({
          targetId: z.string(),
          root: z.string(),
          relPath: z.string(),
          region: z.string().optional(),
          itemId: z.string(),
          state: z.enum(['in-sync', 'drifted', 'missing']),
        }),
      ),
    }),
  },

  // ---------- settings ----------
  'settings.get': { input: z.void(), output: z.record(z.string(), z.unknown()) },
  'settings.update': {
    input: z.object({ patch: z.record(z.string(), z.unknown()) }),
    output: z.record(z.string(), z.unknown()),
  },

  // ---------- dialogs: the only way a path enters the app ----------
  'dialog.pickFolder': {
    input: z.object({ title: z.string().max(120).optional() }),
    output: z.object({ token: pathTokenSchema, path: z.string() }).nullable(),
  },

  // ---------- library ----------
  'library.list': {
    input: z.object({ kind: kind.optional(), tag: z.string().optional() }),
    output: z.array(itemRowSchema),
  },
  'library.get': { input: z.object({ id: itemId }), output: libraryItemSchema },
  'library.search': {
    input: z.object({
      query: z.string().max(200),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    output: z.array(itemRowSchema),
  },
  'library.create': {
    input: z.object({
      kind,
      slug,
      name: z.string().max(120).optional(),
      description: z.string().max(1536).optional(),
      template: z.string().max(64).optional(),
      fields: z.record(z.string(), z.unknown()).optional(),
      body: z.string().optional(),
    }),
    output: libraryItemSchema,
  },
  'library.update': {
    input: z.object({
      id: itemId,
      fields: z.record(z.string(), z.unknown()).optional(),
      body: z.string().optional(),
      bump: z.enum(['patch', 'minor', 'major']).optional(),
    }),
    output: libraryItemSchema,
  },
  'library.rename': { input: z.object({ id: itemId, slug }), output: libraryItemSchema },
  'library.duplicate': {
    input: z.object({ id: itemId, slug: slug.optional() }),
    output: libraryItemSchema,
  },
  'library.delete': {
    input: z.object({ id: itemId }),
    output: z.object({ deleted: z.literal(true) }),
  },
  'library.relations': {
    input: z.object({ id: itemId }),
    output: z.object({
      uses: z.array(z.object({ id: itemId, relation: z.string(), mode: z.string().nullable() })),
      usedBy: z.array(z.object({ id: itemId, relation: z.string(), mode: z.string().nullable() })),
    }),
  },
  /** Every reference edge at once, so a list can show "used by" counts without N calls. */
  'library.graph': {
    input: z.void(),
    output: z.object({
      edges: z.array(
        z.object({ from: itemId, to: itemId, relation: z.string(), mode: z.string().nullable() }),
      ),
    }),
  },
  'library.history': {
    input: z.object({ id: itemId }),
    output: z.array(z.object({ rev: z.string(), summary: z.string(), timestamp: z.string() })),
  },
  /** The item as it was at a revision, so History can diff before it restores. Never writes. */
  'library.at': {
    input: z.object({ id: itemId, rev: z.string().max(64) }),
    output: libraryItemSchema,
  },
  'library.restore': {
    input: z.object({ id: itemId, rev: z.string().max(64) }),
    output: libraryItemSchema,
  },
  'library.templates': {
    input: z.void(),
    output: z.array(
      z.object({ id: z.string(), kind: z.string(), title: z.string(), summary: z.string() }),
    ),
  },
  'library.validate': { input: z.void(), output: z.object({ issues: z.array(issueSchema) }) },

  // ---------- tools & targets ----------
  'tools.detect': {
    input: z.void(),
    output: z.array(
      z.object({
        toolId: z.string(),
        displayName: z.string(),
        installed: z.boolean(),
        version: z.string().optional(),
        roots: z.record(z.string(), z.string()),
        notes: z.array(z.string()),
        capabilities: z.record(z.string(), z.unknown()),
      }),
    ),
  },
  'targets.list': {
    input: z.void(),
    output: z.array(
      z.object({
        targetId: z.string(),
        toolId: z.string(),
        scope: z.enum(['global', 'project']),
        label: z.string(),
        root: z.string().optional(),
        /**
         * For project targets: the token that names this root back to main. Main issues it for
         * a root the user already registered, so the renderer still never sends a path.
         */
        token: pathTokenSchema.optional(),
        roots: z.record(z.string(), z.string()),
      }),
    ),
  },
  'targets.addProject': {
    input: z.object({ token: pathTokenSchema }),
    output: z.object({ added: z.boolean(), root: z.string() }),
  },
  /** Stops managing a project target. Never deletes files (T1.7.1). */
  'targets.removeProject': {
    input: z.object({ root: z.string().max(4096) }),
    output: z.object({ removed: z.boolean() }),
  },

  // ---------- compile preview ----------
  'compile.preview': {
    input: z.object({
      id: itemId,
      target: targetRefSchema,
      /**
       * Unsaved editor state. With it, the preview shows what the tool *would* receive without
       * committing anything to the library first; the draft is resolved against the saved
       * library so its references still embed.
       */
      draft: z.object({ manifest: z.record(z.string(), z.unknown()), body: z.string() }).optional(),
    }),
    output: z.object({ files: z.array(compiledFileSchema) }),
  },

  // ---------- import (M1.8) ----------
  /**
   * Reads what the tools already have and proposes library items. Strictly read-only: a scan
   * never writes to a tool folder or to the library.
   */
  'import.scan': {
    input: z.object({ targetIds: z.array(z.string().max(300)).optional() }),
    output: z.object({
      scanId: z.string(),
      fileCount: z.number(),
      durationMs: z.number(),
      warnings: z.array(z.string()),
      groups: z.array(
        z.object({
          key: z.string(),
          kind,
          slug: z.string(),
          name: z.string(),
          description: z.string(),
          body: z.string(),
          /** An item already in the library that this would collide with. */
          existingId: itemId.optional(),
          canonicalId: z.string(),
          sources: z.array(
            z.object({
              candidateId: z.string(),
              targetId: z.string(),
              toolId: z.string(),
              label: z.string(),
              relPath: z.string(),
              linked: z.boolean(),
              reason: z.enum(['same-slug', 'same-content', 'similar']),
              similarity: z.number(),
              warnings: z.array(z.string()),
            }),
          ),
          suggestions: z.array(
            z.object({ to: z.string(), relation: z.string(), evidence: z.string() }),
          ),
        }),
      ),
    }),
  },
  'import.adopt': {
    input: z.object({
      scanId: z.string().max(64),
      items: z
        .array(
          z.object({
            key: z.string().max(200),
            slug,
            candidateId: z.string().max(600).optional(),
            links: z
              .array(z.object({ to: z.string().max(200), relation: z.string().max(40) }))
              .optional(),
          }),
        )
        .min(1),
    }),
    output: z.object({
      created: z.array(itemId),
      skipped: z.array(z.object({ key: z.string(), reason: z.string() })),
      /** References that could not be carried over, so the loss is never silent. */
      notes: z.array(z.string()),
      /** Where the adopted items came from, so the UI can offer to record ownership. */
      targetIds: z.array(z.string()),
    }),
  },

  // ---------- deploy ----------
  'deploy.plan': {
    input: z.object({
      selections: z.array(z.object({ target: targetRefSchema, items: z.array(itemId) })).min(1),
    }),
    output: planSchema,
  },
  'deploy.apply': {
    input: z.object({
      planId: z.string(),
      resolutions: z
        .record(z.string(), z.enum(['adopt-replace', 'rename', 'overwrite', 'skip']))
        .optional(),
    }),
    output: z.object({
      deployId: z.string(),
      written: z.array(z.string()),
      deleted: z.array(z.string()),
      skipped: z.array(z.string()),
    }),
  },
  'deploy.history': {
    input: z.void(),
    output: z.array(
      z.object({
        deployId: z.string(),
        kind: z.enum(['deploy', 'rollback']),
        createdAt: z.string(),
        revertsDeployId: z.string().optional(),
        fileCount: z.number(),
      }),
    ),
  },
  /** What one past deploy actually did, read back from its snapshot manifest (T1.7.5). */
  'deploy.report': {
    input: z.object({ deployId: z.string().max(64) }),
    output: z.object({
      deployId: z.string(),
      kind: z.enum(['deploy', 'rollback']),
      createdAt: z.string(),
      revertsDeployId: z.string().optional(),
      targets: z.array(
        z.object({
          targetId: z.string(),
          files: z.array(
            z.object({
              root: z.string(),
              relPath: z.string(),
              region: z.string().optional(),
              itemId: z.string().optional(),
              op: z.enum(['create', 'update', 'delete']),
            }),
          ),
        }),
      ),
    }),
  },
  'deploy.planRollback': { input: z.object({ deployId: z.string().max(64) }), output: planSchema },
  'deploy.matrix': {
    input: z.void(),
    output: z.array(
      z.object({
        itemId,
        targetId: z.string(),
        deployedVersion: z.string(),
        libraryVersion: z.string().nullable(),
        status: z.enum(['in-sync', 'outdated', 'missing']),
      }),
    ),
  },
  'deploy.incomplete': {
    input: z.void(),
    output: z.array(z.object({ deployId: z.string(), startedAt: z.string() })),
  },
  'deploy.recover': {
    input: z.object({ deployId: z.string().max(64), mode: z.enum(['rollback', 'complete']) }),
    output: z.object({ recovered: z.literal(true) }),
  },

  // ---------- index ----------
  'index.rebuild': {
    input: z.void(),
    output: z.object({ items: z.number(), durationMs: z.number() }),
  },
} as const;

export type IpcContract = typeof ipcContract;
export type Channel = keyof IpcContract;
export type ChannelInput<C extends Channel> = z.input<IpcContract[C]['input']>;
export type ChannelOutput<C extends Channel> = z.output<IpcContract[C]['output']>;

export const CHANNELS = Object.keys(ipcContract) as Channel[];
export const IPC_PREFIX = 'amc:';

/** Errors crossing the IPC boundary are always serialized into this shape. */
export const ipcErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  /** Set for AmcError details the UI can act on (conflict ids, blocking issues…). */
  details: z.unknown().optional(),
});
export type IpcError = z.infer<typeof ipcErrorSchema>;

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: IpcError };

// ---------- events: main → renderer (T1.5.3) ----------

export const eventContract = {
  'scan.progress': z.object({
    toolId: z.string(),
    done: z.number(),
    total: z.number(),
    label: z.string().optional(),
  }),
  'deploy.progress': z.object({
    deployId: z.string().optional(),
    phase: z.string(),
    done: z.number(),
    total: z.number(),
  }),
  'library.changed': z.object({
    ids: z.array(itemId),
    reason: z.enum(['create', 'update', 'rename', 'delete', 'restore', 'rebuild']),
  }),
  'targets.changed': z.object({ targetIds: z.array(z.string()) }),
  /** Settings were written, so screens holding them (theme, onboarding) can catch up. */
  'settings.changed': z.object({ keys: z.array(z.string()) }),
  'log.warning': z.object({ scope: z.string(), message: z.string() }),
} as const;

export type EventContract = typeof eventContract;
export type EventName = keyof EventContract;
export type EventPayload<E extends EventName> = z.output<EventContract[E]>;
export const EVENT_NAMES = Object.keys(eventContract) as EventName[];
/** One channel carries every event, so the preload exposes a single subscribe function. */
export const EVENT_CHANNEL = 'amc:event';

export const eventEnvelopeSchema = z.object({ name: z.string(), payload: z.unknown() });
