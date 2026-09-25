import { describe, expect, it } from 'vitest';
import { isAmcError } from '../errors';
import { mk } from '../test-support';
import { resolveClosure } from './closure';
import { buildGraph, findCycles } from './graph';

// command.review → agent.reviewer → { skill.sec (always) → skill.owasp, skill.style }
const library = [
  mk('skill.owasp'),
  mk('skill.sec', { dependsOn: ['skill.owasp'] }),
  mk('skill.style'),
  mk('agent.reviewer', {
    skills: [
      { ref: 'skill.sec', mode: 'always' },
      { ref: 'skill.style', mode: 'on-demand' },
    ],
  }),
  mk('command.review', { agent: 'agent.reviewer', preloadSkills: ['skill.style'] }),
];

describe('buildGraph (T1.2.1)', () => {
  const g = buildGraph(library);

  it('indexes outgoing edges with relation, field path, and mode', () => {
    expect(g.uses('agent.reviewer')).toEqual([
      {
        from: 'agent.reviewer',
        relation: 'equips',
        to: 'skill.sec',
        path: 'skills.0.ref',
        mode: 'always',
      },
      {
        from: 'agent.reviewer',
        relation: 'equips',
        to: 'skill.style',
        path: 'skills.1.ref',
        mode: 'on-demand',
      },
    ]);
    expect(g.uses('command.review').map((e) => [e.relation, e.to])).toEqual([
      ['uses-agent', 'agent.reviewer'],
      ['preloads', 'skill.style'],
    ]);
  });

  it('keeps a reverse index', () => {
    expect(g.usedBy('skill.style').map((e) => e.from)).toEqual([
      'agent.reviewer',
      'command.review',
    ]);
    expect(g.usedBy('skill.owasp').map((e) => e.from)).toEqual(['skill.sec']);
    expect(g.usedBy('command.review')).toEqual([]);
    expect(g.uses('skill.unknown')).toEqual([]);
  });

  it('collects broken references', () => {
    const b = buildGraph([mk('agent.a', { skills: [{ ref: 'skill.gone' }] })]);
    expect(b.broken).toMatchObject([{ from: 'agent.a', to: 'skill.gone', path: 'skills.0.ref' }]);
    expect(b.usedBy('skill.gone')).toEqual([]);
  });
});

describe('findCycles (T1.2.2)', () => {
  it('finds none in a DAG', () => {
    expect(findCycles(buildGraph(library))).toEqual([]);
  });

  it('reports each cycle with its full path', () => {
    const g = buildGraph([
      mk('skill.a', { dependsOn: ['skill.b'] }),
      mk('skill.b', { dependsOn: ['skill.c'] }),
      mk('skill.c', { dependsOn: ['skill.a', 'skill.d'] }),
      mk('skill.d'),
      mk('skill.self', { dependsOn: ['skill.self'] }),
      mk('agent.x', { delegatesTo: ['agent.y'] }),
      mk('agent.y', { delegatesTo: ['agent.x'] }),
    ]);
    expect(findCycles(g)).toEqual([
      ['agent.x', 'agent.y', 'agent.x'],
      ['skill.a', 'skill.b', 'skill.c', 'skill.a'],
      ['skill.self', 'skill.self'],
    ]);
  });

  it('handles long chains without recursion limits', () => {
    const n = 5000;
    const chain = Array.from({ length: n }, (_, i) =>
      mk(`skill.s${i}`, { dependsOn: [`skill.s${(i + 1) % n}`] }),
    );
    const [cycle] = findCycles(buildGraph(chain));
    expect(cycle).toHaveLength(n + 1);
  });
});

describe('resolveClosure (T1.2.2, T1.2.3)', () => {
  const g = buildGraph(library);

  it('orders dependencies before dependents and embeds referenced items', () => {
    const order = resolveClosure(g, ['command.review']);
    expect(order.map((r) => r.item.manifest.id)).toEqual([
      'skill.owasp',
      'skill.sec',
      'skill.style',
      'agent.reviewer',
      'command.review',
    ]);
    const agent = order[3]!;
    expect(agent.refs.map((r) => [r.relation, r.mode, r.target.item.manifest.id])).toEqual([
      ['equips', 'always', 'skill.sec'],
      ['equips', 'on-demand', 'skill.style'],
    ]);
    // Shared dependencies are the same object.
    expect(order[4]!.refs[1]!.target).toBe(agent.refs[1]!.target);
    expect(agent.refs[0]!.target.refs[0]!.target.item.manifest.id).toBe('skill.owasp');
  });

  it('includes each item once for overlapping selections', () => {
    const ids = resolveClosure(g, ['skill.sec', 'agent.reviewer', 'skill.owasp']).map(
      (r) => r.item.manifest.id,
    );
    expect(ids).toEqual(['skill.owasp', 'skill.sec', 'skill.style', 'agent.reviewer']);
  });

  it('throws on broken references and cycles', () => {
    const broken = buildGraph([mk('agent.a', { skills: [{ ref: 'skill.gone' }] })]);
    expect(() => resolveClosure(broken, ['agent.a'])).toThrow(
      expect.objectContaining({ code: 'REF_BROKEN' }),
    );
    const cyclic = buildGraph([
      mk('skill.a', { dependsOn: ['skill.b'] }),
      mk('skill.b', { dependsOn: ['skill.a'] }),
    ]);
    let err: unknown;
    try {
      resolveClosure(cyclic, ['skill.a']);
    } catch (e) {
      err = e;
    }
    expect(isAmcError(err, 'REF_CYCLE')).toBe(true);
    expect((err as Error).message).toBe('Reference cycle: skill.a → skill.b → skill.a');
  });
});
