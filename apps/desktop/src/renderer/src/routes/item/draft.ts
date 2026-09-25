import YAML from 'yaml';
import type { ChannelOutput } from '../../../../shared/ipc-contract';
import { fieldsFor } from '@/lib/manifest-fields';
import type { EditableKind } from '@/lib/kinds';

/** The in-progress edit. `manifest` mirrors `amc.yaml`; `body` is the kind's content file. */
export interface Draft {
  manifest: Record<string, unknown>;
  body: string;
}

export const cloneDraft = (draft: Draft): Draft => ({
  manifest: structuredClone(draft.manifest),
  body: draft.body,
});

/** Stamps are maintained by the library, so a change to them is never the user's edit. */
const STAMPS = ['createdAt', 'updatedAt', 'version'];

/**
 * Key order must not count as a change, and it has to be ignored at every depth: an equipped
 * skill written `{mode, ref}` is the same edit as `{ref, mode}`.
 */
const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable);
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return Object.fromEntries(entries.map(([key, inner]) => [key, stable(inner)]));
};

const comparable = (manifest: Record<string, unknown>): string => {
  const rest = { ...manifest };
  for (const key of STAMPS) delete rest[key];
  return JSON.stringify(stable(rest));
};

export const isDirty = (draft: Draft, saved: Draft): boolean =>
  draft.body !== saved.body || comparable(draft.manifest) !== comparable(saved.manifest);

/** Same key order as the library writes, so raw mode shows the file as it is on disk. */
export function toYaml(manifest: Record<string, unknown>, kind: EditableKind): string {
  const order = fieldsFor(kind).map((f) => f.key);
  const ordered: Record<string, unknown> = {};
  for (const key of order) if (key in manifest) ordered[key] = manifest[key];
  for (const key of Object.keys(manifest)) if (!(key in ordered)) ordered[key] = manifest[key];
  return YAML.stringify(ordered, { lineWidth: 100 });
}

export type ParseResult =
  { ok: true; manifest: Record<string, unknown> } | { ok: false; message: string };

/** Parses raw mode back into a manifest. The message is shown verbatim, so it must be readable. */
export function fromYaml(text: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = YAML.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message.split('\n')[0]! : String(err);
    return { ok: false, message: `That isn't valid YAML: ${message}` };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, message: 'The manifest must be a set of keys and values.' };
  }
  return { ok: true, manifest: parsed as Record<string, unknown> };
}

/** Reads a dotted path out of a manifest, so a validator issue can point at the right field. */
export function atPath(manifest: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (value, key) => (value == null ? undefined : (value as Record<string, unknown>)[key]),
      manifest,
    );
}

/** A rough size, shown so a long prompt's cost is visible before it is deployed. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

/** Everything a tab needs: the draft, two setters, and the issues that point at its fields. */
export interface TabProps {
  draft: Draft;
  setManifest: (patch: Record<string, unknown>) => void;
  setBody: (body: string) => void;
  issues: Issue[];
}

export type Issue = ChannelOutput<'library.validate'>['issues'][number];

/** The issues whose `path` points at this field (or into it, e.g. `skills.0.ref`). */
export const issuesFor = (issues: Issue[], field: string): Issue[] =>
  issues.filter((i) => i.path === field || i.path?.startsWith(`${field}.`));
