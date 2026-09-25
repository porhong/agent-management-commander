export type DiffOp = 'same' | 'added' | 'removed';
export interface DiffLine {
  op: DiffOp;
  text: string;
  /** Line number on the side that has this line. */
  before: number | null;
  after: number | null;
}

/** Above this, the quadratic table is not worth it and the pane shows a summary instead. */
const MAX_LINES = 3000;

/**
 * A line diff over the longest common subsequence. Small on purpose: both sides are one file,
 * and a diff library would be another dependency for something this app needs in two places.
 */
export function diffLines(before: string, after: string): DiffLine[] | null {
  const a = before.length === 0 ? [] : before.split('\n');
  const b = after.length === 0 ? [] : after.split('\n');
  if (a.length + b.length > MAX_LINES) return null;

  // lcs[i][j] = length of the longest common subsequence of a[i…] and b[j…].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) out.push({ op: 'same', text: a[i]!, before: ++i, after: ++j });
    else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!)
      out.push({ op: 'removed', text: a[i]!, before: ++i, after: null });
    else out.push({ op: 'added', text: b[j]!, before: null, after: ++j });
  }
  while (i < a.length) out.push({ op: 'removed', text: a[i]!, before: ++i, after: null });
  while (j < b.length) out.push({ op: 'added', text: b[j]!, before: null, after: ++j });
  return out;
}

const LOOK: Record<DiffOp, { row: string; sign: string }> = {
  same: { row: '', sign: ' ' },
  added: { row: 'bg-in-sync/10 text-in-sync', sign: '+' },
  removed: { row: 'bg-destructive/10 text-destructive', sign: '-' },
};

/** Unified diff. Unchanged runs longer than `context` lines collapse to a single marker. */
export function DiffView({
  before,
  after,
  context = 3,
  emptyLabel = 'No differences.',
}: {
  before: string;
  after: string;
  context?: number;
  emptyLabel?: string;
}) {
  const lines = diffLines(before, after);
  if (lines === null) {
    return <p className="p-3 text-muted-foreground">This file is too large to diff here.</p>;
  }
  if (lines.every((l) => l.op === 'same')) {
    return <p className="p-3 text-muted-foreground">{emptyLabel}</p>;
  }

  const keep = new Set<number>();
  lines.forEach((line, index) => {
    if (line.op === 'same') return;
    for (let k = index - context; k <= index + context; k++) keep.add(k);
  });

  const rows: (DiffLine | 'gap')[] = [];
  lines.forEach((line, index) => {
    if (keep.has(index)) rows.push(line);
    else if (rows.at(-1) !== 'gap') rows.push('gap');
  });

  return (
    <div className="id" data-selectable>
      {rows.map((row, index) =>
        row === 'gap' ? (
          <div key={`gap-${index}`} className="px-3 py-0.5 text-muted-foreground">
            ⋯
          </div>
        ) : (
          <div key={index} className={`flex ${LOOK[row.op].row}`}>
            <span className="w-10 shrink-0 select-none pr-2 text-right text-muted-foreground tabular-nums">
              {row.before ?? ''}
            </span>
            <span className="w-10 shrink-0 select-none pr-2 text-right text-muted-foreground tabular-nums">
              {row.after ?? ''}
            </span>
            <span className="w-4 shrink-0 select-none">{LOOK[row.op].sign}</span>
            <span className="whitespace-pre-wrap break-words">{row.text || ' '}</span>
          </div>
        ),
      )}
    </div>
  );
}
