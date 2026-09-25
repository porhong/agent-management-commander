import { AmcError } from '../errors';
import { detectEol, toLf, withEol } from '../fs/text';

/**
 * Managed regions inside shared files (T1.3.6). AMC owns only the text between its markers; every
 * byte outside them is preserved exactly (invariant S7).
 *
 *   <!-- amc:begin skill.style-guide -->
 *   …managed content…
 *   <!-- amc:end skill.style-guide -->
 */
const begin = (id: string) => `<!-- amc:begin ${id} -->`;
const end = (id: string) => `<!-- amc:end ${id} -->`;
const MARKER = /<!-- amc:(begin|end) (\S+) -->/g;

interface Span {
  id: string;
  /** Index of the begin marker. */
  start: number;
  /** Index just after the begin marker's line break: where content starts. */
  inner: number;
  /** Index of the end marker: where content ends. */
  innerEnd: number;
  /** Index just after the end marker. */
  stop: number;
}

function spans(text: string): Span[] {
  const out: Span[] = [];
  let open: { id: string; start: number; inner: number } | undefined;
  for (const m of text.matchAll(MARKER)) {
    const [marker, which, id] = m as unknown as [string, string, string];
    if (which === 'begin') {
      if (open) throw malformed(`"${open.id}" is not closed before "${id}" begins`);
      const afterMarker = m.index + marker.length;
      const nl = text.startsWith('\r\n', afterMarker) ? 2 : text[afterMarker] === '\n' ? 1 : 0;
      open = { id, start: m.index, inner: afterMarker + nl };
    } else {
      if (!open || open.id !== id) throw malformed(`unexpected end marker for "${id}"`);
      out.push({ ...open, innerEnd: m.index, stop: m.index + marker.length });
      open = undefined;
    }
  }
  if (open) throw malformed(`"${open.id}" is never closed`);
  const ids = out.map((s) => s.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw malformed(`"${dup}" appears twice`);
  return out;
}

const malformed = (msg: string) =>
  new AmcError('REGION_MALFORMED', `Managed region markers are broken: ${msg}`);

/** Ids of all managed regions, in file order. Throws REGION_MALFORMED on broken markers. */
export const listRegions = (text: string): string[] => spans(text).map((s) => s.id);

/** Inner content of a region (LF line endings), or null if absent. */
export function readRegion(text: string, id: string): string | null {
  const s = spans(text).find((x) => x.id === id);
  return s ? toLf(text.slice(s.inner, s.innerEnd)) : null;
}

/**
 * Returns `text` with region `id` set to `content`, or removed when `content` is null. A new
 * region is appended at the end. Uses the file's own line endings. Bytes outside the region's
 * markers never change.
 */
export function spliceRegion(text: string, id: string, content: string | null): string {
  if (/\s/.test(id) || id.includes('-->')) throw malformed(`invalid region id "${id}"`);
  const eol = detectEol(text);
  const s = spans(text).find((x) => x.id === id);
  const inner = content === null ? '' : withEol(content.replace(/\n*$/, '\n'), eol);

  if (s) {
    if (content !== null) return text.slice(0, s.inner) + inner + text.slice(s.innerEnd);
    // Drop the markers and the line break that followed the end marker.
    const after = text.startsWith('\r\n', s.stop) ? 2 : text[s.stop] === '\n' ? 1 : 0;
    return text.slice(0, s.start) + text.slice(s.stop + after);
  }
  if (content === null) return text;
  const sep = text === '' ? '' : text.endsWith('\n') ? eol : eol + eol;
  return `${text}${sep}${begin(id)}${eol}${inner}${end(id)}${eol}`;
}
