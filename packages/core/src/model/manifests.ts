import { z } from 'zod';
import {
  baseManifestShape,
  modelTierSchema,
  refTo,
  toolPermissionSchema,
  type ItemKind,
} from './common';

const withIdPrefix =
  (kind: ItemKind) =>
  (m: { id: string }, ctx: z.RefinementCtx): void => {
    if (!m.id.startsWith(`${kind}.`)) {
      ctx.addIssue({ code: 'custom', path: ['id'], message: `id must start with "${kind}."` });
    }
  };

// ---------- Skill ----------
export const skillManifestSchema = z
  .object({
    ...baseManifestShape,
    kind: z.literal('skill'),
    /** Hints for "when to use"; compiled into the description where a tool needs it. */
    triggers: z.array(z.string().min(1)).default([]),
    dependsOn: z.array(refTo('skill')).default([]),
    allowedTools: z.array(toolPermissionSchema).optional(),
    scripts: z
      .object({ trust: z.enum(['untrusted', 'reviewed', 'owned']).default('owned') })
      .optional(),
  })
  .superRefine(withIdPrefix('skill'));
export type SkillManifest = z.infer<typeof skillManifestSchema>;

// ---------- Agent ----------
export const equipModeSchema = z.enum(['on-demand', 'always']);

export const agentManifestSchema = z
  .object({
    ...baseManifestShape,
    kind: z.literal('agent'),
    model: z
      .object({ preferred: modelTierSchema, fallback: modelTierSchema.optional() })
      .optional(),
    tools: z
      .object({
        allow: z.array(toolPermissionSchema).optional(),
        deny: z.array(toolPermissionSchema).default([]),
      })
      .optional(),
    skills: z
      .array(z.object({ ref: refTo('skill'), mode: equipModeSchema.default('on-demand') }))
      .default([]),
    delegatesTo: z.array(refTo('agent')).default([]),
  })
  .superRefine(withIdPrefix('agent'));
export type AgentManifest = z.infer<typeof agentManifestSchema>;

// ---------- Command ----------
const ARG_NAME = /^[a-z][a-z0-9_]*$/;

export const commandArgumentSchema = z.object({
  name: z.string().regex(ARG_NAME, 'lowercase identifier, e.g. pr or ticket_id'),
  description: z.string().optional(),
  required: z.boolean().default(false),
  default: z.string().optional(),
});

export const commandManifestSchema = z
  .object({
    ...baseManifestShape,
    kind: z.literal('command'),
    arguments: z.array(commandArgumentSchema).default([]),
    agent: refTo('agent').optional(),
    preloadSkills: z.array(refTo('skill')).default([]),
    allowedTools: z.array(toolPermissionSchema).optional(),
  })
  .superRefine(withIdPrefix('command'))
  .superRefine((m, ctx) => {
    const seen = new Set<string>();
    m.arguments.forEach((a, i) => {
      if (seen.has(a.name)) {
        ctx.addIssue({ code: 'custom', path: ['arguments', i, 'name'], message: 'duplicate' });
      }
      seen.add(a.name);
    });
  });
export type CommandManifest = z.infer<typeof commandManifestSchema>;

// ---------- Any ----------
export const manifestSchemas = {
  skill: skillManifestSchema,
  agent: agentManifestSchema,
  command: commandManifestSchema,
} as const;

/** Kinds whose schemas exist today; workflow arrives in Phase 2 (M2.1). */
export type ModeledKind = keyof typeof manifestSchemas;
export type Manifest = SkillManifest | AgentManifest | CommandManifest;

/** Content file holding each kind's body in the library folder. */
export const BODY_FILE: Record<ModeledKind, string> = {
  skill: 'SKILL.md',
  agent: 'prompt.md',
  command: 'template.md',
};
