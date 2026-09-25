import {
  escapeCanonical,
  parseFrontmatter,
  parseManifest,
  SLUG_PATTERN,
  type LibraryItem,
  type NativeGroup,
  type ParseResult,
} from '@amc/core';
import { ADAPTER_ID, splitToolList, toAbstractTools, toNativeTools, toTier } from './mapping';

/**
 * Per-tool override block stored at `compat.overrides["claude-code"]`. Typed keys hold exact
 * native values for fields AMC models lossily; `raw` holds frontmatter AMC does not model.
 * Together they make parse → compile lossless (P0-07).
 */
export interface ClaudeOverrides {
  raw?: Record<string, unknown>;
  /** Native `name` when it is not a valid slug. */
  name?: string;
  /** Path under the kind folder when it differs from `<slug>.md` (nested or renamed files). */
  path?: string;
  tools?: unknown;
  disallowedTools?: unknown;
  'allowed-tools'?: unknown;
  model?: string;
  skills?: unknown;
  /** The native file had no description; AMC derived one and must not emit it. */
  derivedDescription?: boolean;
}

export function toSlug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
  return SLUG_PATTERN.test(s) ? s : 'item';
}

const text = (b: Buffer) => b.toString('utf8');
const firstLine = (body: string) =>
  body
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .find(Boolean) ?? '(no description)';

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && new Set([...a, ...b]).size === new Set(a).size;

/** Maps a native tool list; keeps the exact original when the abstract mapping is lossy. */
function mapTools(
  value: unknown,
  key: 'tools' | 'disallowedTools' | 'allowed-tools',
  o: ClaudeOverrides,
) {
  if (value === undefined) return undefined;
  const native = splitToolList(value);
  const abstract = toAbstractTools(native);
  if (!sameSet(toNativeTools(abstract), native)) o[key] = value;
  return abstract;
}

function descriptionOf(
  data: Record<string, unknown>,
  body: string,
  o: ClaudeOverrides,
  w: string[],
) {
  const d = data['description'];
  if (typeof d === 'string' && d.trim()) return d;
  o.derivedDescription = true;
  w.push('description missing; derived from first line of body');
  return firstLine(body).slice(0, 1536);
}

function finish(
  manifest: Record<string, unknown>,
  o: ClaudeOverrides,
  raw: Record<string, unknown>,
) {
  if (Object.keys(raw).length) o.raw = raw;
  if (Object.keys(o).length) manifest['compat'] = { overrides: { [ADAPTER_ID]: o } };
  return parseManifest(manifest);
}

const ARG_NAME = /^[a-z][a-z0-9_]*$/;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Native command body → canonical template. `$ARGUMENTS` → `{{args}}`; `$N` (0-based in Claude
 * Code) → `{{arg<N+1>}}` (canonical positions are 1-based); declared `$name` → `{{name}}`.
 */
export function toCanonicalTemplate(body: string, named: readonly string[]) {
  const positions = new Set<number>();
  let out = escapeCanonical(body)
    .replace(/\$ARGUMENTS\b/g, '{{args}}')
    .replace(/\$(\d+)(?!\d)/g, (_m, n: string) => {
      positions.add(Number(n) + 1);
      return `{{arg${Number(n) + 1}}}`;
    });
  // Longest first so `$pr_id` isn't consumed by `$pr`.
  for (const name of [...named].sort((a, b) => b.length - a.length)) {
    out = out.replace(new RegExp(`\\$${escapeRe(name)}(?![A-Za-z0-9_])`, 'g'), `{{${name}}}`);
  }
  return { body: out, positions: [...positions].sort((a, b) => a - b) };
}

export function parseGroup(group: NativeGroup): ParseResult {
  const entry = group.files.find((f) => f.relPath === group.entry);
  if (!entry) throw new Error(`entry ${group.entry} missing from group`);
  const fm = parseFrontmatter(text(entry.content), group.entry);
  const warnings: string[] = [];
  const o: ClaudeOverrides = {};
  const segments = group.entry.split('/');

  if (group.kind === 'agent') {
    const { name, description: _d, tools, disallowedTools, model, skills, ...raw } = fm.data;
    const fileName = segments.slice(1).join('/');
    const slug = toSlug(typeof name === 'string' ? name : fileName.replace(/\.md$/, ''));
    if (name !== undefined && name !== slug) o.name = String(name);
    if (fileName !== `${slug}.md`) o.path = fileName;

    const allow = mapTools(tools, 'tools', o);
    const deny = mapTools(disallowedTools, 'disallowedTools', o);
    let tier;
    if (typeof model === 'string') {
      tier = toTier(model);
      if (!tier) o.model = model;
    }
    const skillNames = skills === undefined ? [] : splitToolList(skills);
    if (skills !== undefined && skillNames.some((s) => toSlug(s) !== s)) o.skills = skills;

    const manifest = {
      id: `agent.${slug}`,
      kind: 'agent',
      name: typeof name === 'string' ? name : slug,
      slug,
      description: descriptionOf(fm.data, fm.body, o, warnings),
      ...(allow || deny ? { tools: { ...(allow && { allow }), deny: deny ?? [] } } : {}),
      ...(tier ? { model: { preferred: tier } } : {}),
      // Claude's `skills:` preloads full skill content at startup = AMC "always" equip mode.
      skills: skillNames.map((s) => ({ ref: `skill.${toSlug(s)}`, mode: 'always' })),
    };
    return { item: { manifest: finish(manifest, o, raw), body: fm.body, files: {} }, warnings };
  }

  if (group.kind === 'skill') {
    const dir = segments[1]!;
    const { name, description: _d, license, 'allowed-tools': allowed, ...raw } = fm.data;
    const slug = toSlug(dir);
    if (dir !== slug) warnings.push(`folder "${dir}" is not a valid slug; using "${slug}"`);
    if (name !== undefined && name !== slug) o.name = String(name);
    const allowedTools = mapTools(allowed, 'allowed-tools', o);

    const files: LibraryItem['files'] = {};
    const prefix = `skills/${dir}/`;
    for (const f of group.files) {
      if (f.relPath !== group.entry) files[f.relPath.slice(prefix.length)] = f.content;
    }
    const manifest = {
      id: `skill.${slug}`,
      kind: 'skill',
      name: typeof name === 'string' ? name : slug,
      slug,
      description: descriptionOf(fm.data, fm.body, o, warnings),
      ...(typeof license === 'string' ? { license } : {}),
      ...(allowedTools ? { allowedTools } : {}),
    };
    if (license !== undefined && typeof license !== 'string') raw['license'] = license;
    return { item: { manifest: finish(manifest, o, raw), body: fm.body, files }, warnings };
  }

  // command
  const fileName = segments.slice(1).join('/');
  const slug = toSlug(segments.at(-1)!.replace(/\.md$/, ''));
  if (fileName !== `${slug}.md`) o.path = fileName;
  const { description: _d, 'allowed-tools': allowed, arguments: args, ...raw } = fm.data;
  const allowedTools = mapTools(allowed, 'allowed-tools', o);

  // Named arguments map only when every name is a canonical identifier; otherwise stay raw.
  const named = args === undefined ? [] : splitToolList(args);
  const mapNamed = named.length > 0 && named.every((n) => ARG_NAME.test(n) && !/^arg\d+$/.test(n));
  if (args !== undefined && !mapNamed) raw['arguments'] = args;
  const template = toCanonicalTemplate(fm.body, mapNamed ? named : []);

  const manifest = {
    id: `command.${slug}`,
    kind: 'command',
    name: slug,
    slug,
    description: descriptionOf(fm.data, fm.body, o, warnings),
    arguments: [
      ...(mapNamed ? named : []).map((name) => ({ name })),
      ...template.positions.map((n) => ({ name: `arg${n}` })),
    ],
    ...(allowedTools ? { allowedTools } : {}),
  };
  return { item: { manifest: finish(manifest, o, raw), body: template.body, files: {} }, warnings };
}
