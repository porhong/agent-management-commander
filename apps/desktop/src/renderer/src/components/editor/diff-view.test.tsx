import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DiffView, diffLines } from './diff-view';

describe('line diff', () => {
  it('keeps common lines and marks only what moved', () => {
    const diff = diffLines('a\nb\nc\n', 'a\nB\nc\n')!;
    expect(diff.map((l) => `${l.op[0]}${l.text}`)).toEqual(['sa', 'rb', 'aB', 'sc', 's']);
  });

  it('numbers each side independently', () => {
    const diff = diffLines('a\nc', 'a\nb\nc')!;
    expect(diff.map((l) => [l.op, l.before, l.after])).toEqual([
      ['same', 1, 1],
      ['added', null, 2],
      ['same', 2, 3],
    ]);
  });

  it('treats an empty side as a whole-file add or delete', () => {
    expect(diffLines('', 'x')!.every((l) => l.op === 'added')).toBe(true);
    expect(diffLines('x', '')!.every((l) => l.op === 'removed')).toBe(true);
  });

  it('refuses files too large to diff rather than hanging', () => {
    const big = 'line\n'.repeat(2000);
    expect(diffLines(big, `${big}extra`)).toBeNull();
  });
});

describe('unified view', () => {
  it('says plainly when there is nothing to show', () => {
    render(<DiffView before="same\n" after="same\n" emptyLabel="Nothing changed." />);
    expect(screen.getByText('Nothing changed.')).toBeInTheDocument();
  });

  it('collapses long runs of unchanged lines', () => {
    const before = `${'x\n'.repeat(20)}old`;
    const after = `${'x\n'.repeat(20)}new`;
    const { container } = render(<DiffView before={before} after={after} context={2} />);
    expect(container.textContent).toContain('⋯');
    expect(screen.getByText('old')).toBeInTheDocument();
    expect(screen.getByText('new')).toBeInTheDocument();
  });
});
