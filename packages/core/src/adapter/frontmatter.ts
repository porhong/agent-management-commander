import YAML from 'yaml';
import { AmcError } from '../errors';
import { stripBom, toLf } from '../fs/text';

export interface Frontmatter {
  data: Record<string, unknown>;
  /** Body with leading blank lines removed, LF line endings. */
  body: string;
  hasFrontmatter: boolean;
}

/**
 * Splits a Markdown file with optional YAML frontmatter. Only the first `---` block counts;
 * later `---` lines (e.g. horizontal rules or pasted frontmatter) stay in the body.
 */
export function parseFrontmatter(text: string, source = 'file'): Frontmatter {
  const lf = toLf(stripBom(text));
  if (!lf.startsWith('---\n'))
    return { data: {}, body: lf.replace(/^\n+/, ''), hasFrontmatter: false };
  const end = lf.indexOf('\n---', 3);
  // Closing fence must be a whole line: "---" followed by newline or EOF.
  const after = end === -1 ? -1 : end + 4;
  if (end === -1 || (lf[after] !== undefined && lf[after] !== '\n')) {
    throw new AmcError('NATIVE_PARSE_FAILED', `${source}: unterminated frontmatter`);
  }
  let data: unknown;
  try {
    data = YAML.parse(lf.slice(4, end + 1)) ?? {};
  } catch (err) {
    throw new AmcError('NATIVE_PARSE_FAILED', `${source}: ${(err as Error).message}`);
  }
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new AmcError('NATIVE_PARSE_FAILED', `${source}: frontmatter is not a mapping`);
  }
  return {
    data: data as Record<string, unknown>,
    body: lf.slice(after + 1).replace(/^\n+/, ''),
    hasFrontmatter: true,
  };
}

/** Emits `---\n<yaml>---\n\n<body>` with deterministic YAML (no line folding). */
export function stringifyFrontmatter(data: Record<string, unknown>, body: string): string {
  const entries = Object.entries(data).filter(([, v]) => v !== undefined);
  const yaml = entries.length ? YAML.stringify(Object.fromEntries(entries), { lineWidth: 0 }) : '';
  const text = body.replace(/^\n+/, '');
  return `---\n${yaml}---\n${text ? '\n' + text : ''}`;
}
