import type { ItemId } from '../model/common';
import { BODY_FILE, type Manifest, type ModeledKind } from '../model/manifests';
import { MANIFEST_FILE, kindDir, serializeManifest, type LibraryItem } from '../library/item-io';
import { findCycles } from '../resolver/graph';
import { looksBinary, scanForSecrets } from './secrets';
import type { IssueFix, Rule, RuleFinding, Severity, ValidationContext } from './types';

const relDir = (m: Manifest): string => `${kindDir(m.kind)}/${m.slug}`;

/** Folders whose `amc.yaml` fails to parse or validate. */
export const manifestSchemaRule: Rule = {
  id: 'manifest-schema',
  severity: 'error',
  description: 'Manifest matches schema',
  check: (ctx) =>
    ctx.problems.map((p) => ({ message: p.message, file: `${p.path}/${MANIFEST_FILE}` })),
};

/** Fix for a broken reference: drop just that entry. */
function removeRefFix(item: LibraryItem, path: string, to: ItemId): IssueFix {
  const [field, index] = path.split('.') as [keyof Manifest, string | undefined];
  const current = item.manifest[field];
  const fields =
    index === undefined || !Array.isArray(current)
      ? { [field]: undefined }
      : { [field]: current.filter((_, i) => i !== Number(index)) };
  return { label: `Remove reference to ${to}`, itemId: item.manifest.id, fields };
}

export const refResolvesRule: Rule = {
  id: 'ref-resolves',
  severity: 'error',
  description: 'Every reference resolves to an existing item',
  check: (ctx) =>
    ctx.graph.broken.map((e) => ({
      itemId: e.from,
      path: e.path,
      message: `References ${e.to}, which doesn't exist`,
      fix: removeRefFix(ctx.graph.items.get(e.from)!, e.path, e.to),
    })),
};

export const noCyclesRule: Rule = {
  id: 'no-cycles',
  severity: 'error',
  description: 'No reference cycles',
  check: (ctx) =>
    findCycles(ctx.graph).map((cycle) => ({
      itemId: cycle[0],
      message: `Reference cycle: ${cycle.join(' → ')}`,
    })),
};

export const slugUniqueRule: Rule = {
  id: 'slug-unique',
  severity: 'error',
  description: 'Slug unique per kind',
  check: (ctx) => {
    const byKey = new Map<string, LibraryItem[]>();
    for (const i of ctx.items) {
      const key = `${i.manifest.kind}/${i.manifest.slug}`;
      (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(i);
    }
    return [...byKey.values()]
      .filter((g) => g.length > 1)
      .flatMap((g) =>
        g.map((i) => ({
          itemId: i.manifest.id,
          path: 'slug',
          message: `Slug "${i.manifest.slug}" is also used by ${g
            .filter((o) => o !== i)
            .map((o) => o.manifest.id)
            .join(', ')}`,
        })),
      );
  },
};

/** Windows device names can't be file or folder names, with or without an extension. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/;

export const slugPathSafeRule: Rule = {
  id: 'slug-path-safe',
  severity: 'error',
  description: 'Slug is a safe file name on every OS',
  check: (ctx) =>
    ctx.items
      .filter((i) => WINDOWS_RESERVED.test(i.manifest.slug))
      .map((i) => ({
        itemId: i.manifest.id,
        path: 'slug',
        message: `"${i.manifest.slug}" is a reserved device name on Windows`,
      })),
};

export const MIN_DESCRIPTION = 20;

export const descriptionMinRule: Rule = {
  id: 'description-min',
  severity: 'warning',
  description: `Description has at least ${MIN_DESCRIPTION} characters`,
  check: (ctx) =>
    ctx.items
      .filter((i) => i.manifest.description.trim().length < MIN_DESCRIPTION)
      .map((i) => ({
        itemId: i.manifest.id,
        path: 'description',
        message: `Description is shorter than ${MIN_DESCRIPTION} characters. Tools use it to decide when to use this ${i.manifest.kind}.`,
      })),
};

/** ~10k tokens. Beyond this an always-on prompt crowds the context window. */
export const INLINE_PROMPT_LIMIT = 40_000;

/** Size of what an agent carries in its prompt: its body plus every always-equipped skill. */
function inlinedSize(ctx: ValidationContext, agentId: ItemId): number {
  const seen = new Set<ItemId>();
  const walk = (id: ItemId): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    const item = ctx.graph.items.get(id);
    if (!item) return 0;
    const deps = ctx.graph
      .uses(id)
      .filter(
        (e) => e.relation === 'depends-on' || (e.relation === 'equips' && e.mode === 'always'),
      );
    return item.body.length + deps.reduce((n, e) => n + walk(e.to), 0);
  };
  return walk(agentId);
}

export const inlinePromptSizeRule: Rule = {
  id: 'inline-prompt-size',
  severity: 'warning',
  description: `Inlined agent prompt stays under ${INLINE_PROMPT_LIMIT} characters`,
  check: (ctx) =>
    ctx.items
      .filter((i) => i.manifest.kind === 'agent')
      .map((i) => ({ i, size: inlinedSize(ctx, i.manifest.id) }))
      .filter(({ size }) => size > INLINE_PROMPT_LIMIT)
      .map(({ i, size }) => ({
        itemId: i.manifest.id,
        message: `Prompt with always-on skills is ${size} characters (limit ${INLINE_PROMPT_LIMIT}). Consider equipping some skills on demand.`,
      })),
};

export const untrustedScriptsRule: Rule = {
  id: 'untrusted-scripts',
  severity: 'warning',
  description: 'Skill scripts marked untrusted block deploy until reviewed',
  check: (ctx) =>
    ctx.items
      .filter(
        (i) =>
          i.manifest.kind === 'skill' &&
          i.manifest.scripts?.trust === 'untrusted' &&
          Object.keys(i.files).some((f) => f.startsWith('scripts/')),
      )
      .map((i) => ({
        itemId: i.manifest.id,
        path: 'scripts.trust',
        blocking: true,
        message: 'Has untrusted scripts. Review them before this skill can be deployed.',
      })),
};

export const unusedItemRule: Rule = {
  id: 'unused-item',
  severity: 'info',
  description: 'Item is deployed or referenced',
  check: (ctx) =>
    ctx.deployed === undefined
      ? []
      : ctx.items
          .filter(
            (i) =>
              !ctx.deployed!.has(i.manifest.id) && ctx.graph.usedBy(i.manifest.id).length === 0,
          )
          .map((i) => ({
            itemId: i.manifest.id,
            message: 'Not deployed and not used by any item',
          })),
};

export const secretScanRule: Rule = {
  id: 'secret-scan',
  severity: 'warning',
  description: 'No key-like secrets in the library',
  check: (ctx) =>
    ctx.items.flatMap((i) => {
      const dir = relDir(i.manifest);
      const sources: Array<[string, string]> = [
        [MANIFEST_FILE, serializeManifest(i.manifest)],
        [BODY_FILE[i.manifest.kind as ModeledKind], i.body],
        ...Object.entries(i.files)
          .filter(([, data]) => !looksBinary(data))
          .map(([rel, data]): [string, string] => [rel, data.toString('utf8')]),
      ];
      return sources.flatMap(([rel, text]) =>
        scanForSecrets(text).map((h) => ({
          itemId: i.manifest.id,
          file: `${dir}/${rel}`,
          line: h.line,
          message: `Looks like a ${h.name} (${h.preview}). The library is a git repo; keep secrets out of it.`,
        })),
      );
    }),
};

/** Per-target: description length limit of one tool (registered by that tool's adapter). */
export function descriptionLimitRule(toolId: string, limit: number, severity: Severity): Rule {
  return {
    id: `description-limit:${toolId}`,
    severity,
    description: `Description fits ${toolId}'s ${limit}-character limit`,
    check: (ctx) =>
      ctx.targets
        .filter((t) => t.toolId === toolId)
        .flatMap((t) =>
          ctx.items
            .filter((i) => i.manifest.description.length > limit)
            .map((i) => ({
              itemId: i.manifest.id,
              targetId: t.id,
              path: 'description',
              message: `Description is ${i.manifest.description.length} characters; ${toolId} allows ${limit}`,
            })),
        ),
  };
}

/** Per-target: a tool's naming rules. `check` returns a reason when the slug is invalid. */
export function slugNamingRule(
  toolId: string,
  check: (slug: string, kind: ModeledKind) => string | null,
): Rule {
  return {
    id: `slug-naming:${toolId}`,
    severity: 'error',
    description: `Slug is valid for ${toolId}`,
    check: (ctx) =>
      ctx.targets
        .filter((t) => t.toolId === toolId)
        .flatMap((t) =>
          ctx.items.flatMap((i): RuleFinding[] => {
            const reason = check(i.manifest.slug, i.manifest.kind as ModeledKind);
            return reason
              ? [{ itemId: i.manifest.id, targetId: t.id, path: 'slug', message: reason }]
              : [];
          }),
        ),
  };
}

/** The core rule set from docs/concept/05 §6 plus the secret scanner and path-safety check. */
export const CORE_RULES: readonly Rule[] = [
  manifestSchemaRule,
  refResolvesRule,
  noCyclesRule,
  slugUniqueRule,
  slugPathSafeRule,
  descriptionMinRule,
  inlinePromptSizeRule,
  untrustedScriptsRule,
  unusedItemRule,
  secretScanRule,
];
