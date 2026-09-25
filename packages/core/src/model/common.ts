import { z } from 'zod';

export const ITEM_KINDS = ['skill', 'agent', 'command', 'workflow'] as const;
export const itemKindSchema = z.enum(ITEM_KINDS);
export type ItemKind = z.infer<typeof itemKindSchema>;

/**
 * Slug rules follow the Agent Skills spec (the strictest target): 1–64 chars, lowercase
 * alphanumerics and single hyphens, no leading/trailing hyphen. Valid in every supported tool.
 */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const slugSchema = z
  .string()
  .max(64)
  .regex(SLUG_PATTERN, 'lowercase letters, digits and single hyphens only');

/** Stable reference `kind.slug-at-creation`, e.g. `skill.security-checklist`. Never changes. */
export const ID_PATTERN = /^(skill|agent|command|workflow)\.[a-z0-9]+(-[a-z0-9]+)*$/;
export const itemIdSchema = z.string().max(80).regex(ID_PATTERN, 'expected <kind>.<slug>');
export type ItemId = z.infer<typeof itemIdSchema>;

export const refTo = (kind: ItemKind) =>
  itemIdSchema.refine((id) => id.startsWith(`${kind}.`), { message: `must reference a ${kind}` });

export const kindOfId = (id: ItemId): ItemKind => id.slice(0, id.indexOf('.')) as ItemKind;

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
export const semverSchema = z.string().regex(SEMVER, 'expected semver, e.g. 1.0.0');

export const toolIdSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

/**
 * Abstract tool-permission vocabulary, mapped per adapter (e.g. `search` → Grep+Glob in Claude
 * Code). Forms: `read`, `shell:readonly`, `mcp:github`.
 */
export const toolPermissionSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]*(:[a-z0-9*_.-]+)?$/, 'expected e.g. read, search, shell:readonly');

/** Abstract model tier; adapters map it. Exact per-tool values live in compat.overrides. */
export const modelTierSchema = z.enum(['inherit', 'fast', 'balanced', 'powerful']);
export type ModelTier = z.infer<typeof modelTierSchema>;

/**
 * Per-tool escape hatch. `raw` carries native frontmatter/config keys verbatim, so importing and
 * re-deploying an item never loses tool-specific fields AMC does not model.
 */
export const toolOverrideSchema = z
  .object({ raw: z.record(z.string(), z.unknown()).optional() })
  .catchall(z.unknown());

export const compatSchema = z.object({
  exclude: z.array(toolIdSchema).default([]),
  overrides: z.record(toolIdSchema, toolOverrideSchema).default({}),
});

/** Fields shared by every item manifest (`amc.yaml`). */
export const baseManifestShape = {
  id: itemIdSchema,
  name: z.string().min(1).max(120),
  slug: slugSchema,
  version: semverSchema.default('0.1.0'),
  // Tools use the description to decide when to auto-invoke. 1536 is the largest known tool
  // limit (Claude Code); stricter per-tool limits (Agent Skills spec: 1024) are validator rules.
  description: z.string().trim().min(1).max(1536),
  tags: z.array(z.string().min(1).max(40)).default([]),
  author: z.string().optional(),
  license: z.string().optional(),
  compat: compatSchema.optional(),
};
