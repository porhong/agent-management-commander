import {
  parseFrontmatter,
  parseManifest,
  SLUG_PATTERN,
  stripBom,
  type LibraryItem,
  type ModelTier,
  type NativeGroup,
  type ParseResult,
} from '@amc/core';
import { ADAPTER_ID, toCanonicalTemplate, type CodexOverrides, type ModelMap } from './mapping';
import { parseToml } from './toml';

export function toSlug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
  return SLUG_PATTERN.test(s) ? s : 'item';
}

const firstLine = (body: string) =>
  body
    .split('\n')
    .map((l) => l.replace(/^#+\s*/, '').trim())
    .find(Boolean) ?? '(no description)';

function descriptionOf(value: unknown, body: string, o: CodexOverrides, w: string[]): string {
  if (typeof value === 'string' && value.trim()) return value;
  o.derivedDescription = true;
  w.push('description missing; derived from first line of body');
  return firstLine(body).slice(0, 1536);
}

function finish(
  manifest: Record<string, unknown>,
  o: CodexOverrides,
  raw: Record<string, unknown>,
) {
  if (Object.keys(raw).length) o.raw = raw;
  if (Object.keys(o).length) manifest['compat'] = { overrides: { [ADAPTER_ID]: o } };
  return parseManifest(manifest);
}

const baseName = (relPath: string, ext: string) => relPath.split('/').pop()!.slice(0, -ext.length);

export function parseGroup(group: NativeGroup, models: ModelMap = {}): ParseResult {
  const entry = group.files.find((f) => f.relPath === group.entry);
  if (!entry) throw new Error(`entry ${group.entry} missing from group`);
  const text = entry.content.toString('utf8');
  const warnings: string[] = [];
  const o: CodexOverrides = {};

  if (group.kind === 'agent') {
    const data = parseToml(stripBom(text), group.entry);
    const { name, description, developer_instructions, model, sandbox_mode, ...raw } = data;
    const file = baseName(group.entry, '.toml');
    const slug = toSlug(typeof name === 'string' ? name : file);
    if (name !== undefined && name !== slug) o.name = String(name);
    if (file !== slug) o.path = `${file}.toml`;
    const body = typeof developer_instructions === 'string' ? developer_instructions : '';
    if (typeof developer_instructions !== 'string') warnings.push('developer_instructions missing');

    let tier: ModelTier | undefined;
    if (typeof model === 'string') {
      tier = (Object.keys(models) as ModelTier[]).find((t) => models[t] === model);
      if (!tier) o.model = model;
    } else if (model !== undefined) raw['model'] = model;
    // Sandbox mode is coarser than AMC's tool list, so it is kept exactly rather than guessed.
    if (typeof sandbox_mode === 'string') o.sandbox_mode = sandbox_mode;
    else if (sandbox_mode !== undefined) raw['sandbox_mode'] = sandbox_mode;

    const manifest = {
      id: `agent.${slug}`,
      kind: 'agent',
      name: typeof name === 'string' ? name : slug,
      slug,
      description: descriptionOf(description, body, o, warnings),
      ...(tier ? { model: { preferred: tier } } : {}),
    };
    return { item: { manifest: finish(manifest, o, raw), body, files: {} }, warnings };
  }

  const fm = parseFrontmatter(text, group.entry);

  if (group.kind === 'skill') {
    const dir = group.entry.split('/')[1]!;
    const { name, description, license, ...raw } = fm.data;
    const slug = toSlug(dir);
    if (dir !== slug) warnings.push(`folder "${dir}" is not a valid slug; using "${slug}"`);
    if (name !== undefined && name !== slug) o.name = String(name);
    const files: LibraryItem['files'] = {};
    const prefix = `skills/${dir}/`;
    for (const f of group.files) {
      if (f.relPath !== group.entry) files[f.relPath.slice(prefix.length)] = f.content;
    }
    if (license !== undefined && typeof license !== 'string') raw['license'] = license;
    const manifest = {
      id: `skill.${slug}`,
      kind: 'skill',
      name: typeof name === 'string' ? name : slug,
      slug,
      description: descriptionOf(description, fm.body, o, warnings),
      ...(typeof license === 'string' ? { license } : {}),
    };
    return { item: { manifest: finish(manifest, o, raw), body: fm.body, files }, warnings };
  }

  // command (a custom prompt)
  const file = baseName(group.entry, '.md');
  const slug = toSlug(file);
  if (file !== slug) o.path = `${file}.md`;
  const { description, ...raw } = fm.data;
  const template = toCanonicalTemplate(fm.body);
  const manifest = {
    id: `command.${slug}`,
    kind: 'command',
    name: slug,
    slug,
    description: descriptionOf(description, fm.body, o, warnings),
    arguments: [
      ...template.named.map((name) => ({ name })),
      ...template.positions.map((n) => ({ name: `arg${n}` })),
    ],
  };
  return { item: { manifest: finish(manifest, o, raw), body: template.body, files: {} }, warnings };
}
