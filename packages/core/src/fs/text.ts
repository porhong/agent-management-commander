import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';
import { AmcError } from '../errors';

export const sha256 = (data: Buffer | string): string =>
  createHash('sha256').update(data).digest('hex');

export type Eol = '\n' | '\r\n';

/** Detects the dominant line ending; defaults to LF for new or single-line content. */
export function detectEol(text: string): Eol {
  const crlf = text.match(/\r\n/g)?.length ?? 0;
  const lf = (text.match(/\n/g)?.length ?? 0) - crlf;
  return crlf > lf ? '\r\n' : '\n';
}

export const toLf = (text: string): string => text.replace(/\r\n/g, '\n');

export const withEol = (text: string, eol: Eol): string =>
  eol === '\n' ? toLf(text) : toLf(text).replace(/\n/g, '\r\n');

/** Strips a UTF-8 BOM; AMC writes UTF-8 without BOM. */
export const stripBom = (text: string): string =>
  text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

/**
 * Resolves `rel` under `root` and guarantees the result stays inside root (invariant S4).
 * Rejects absolute paths and any `..` escape.
 */
export function safeJoin(root: string, rel: string): string {
  if (isAbsolute(rel)) throw new AmcError('PATH_OUTSIDE_ROOT', `Absolute path not allowed: ${rel}`);
  const full = resolve(root, rel);
  const r = relative(resolve(root), full);
  if (r === '' || r.startsWith('..') || isAbsolute(r)) {
    throw new AmcError('PATH_OUTSIDE_ROOT', `Path escapes root: ${rel}`);
  }
  return full;
}
