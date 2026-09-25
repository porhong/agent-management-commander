import type { ItemId } from './common';
import type { Manifest } from './manifests';

/** How one item points at another. Mirrors the composition rules in docs/concept/02. */
export type RefRelation = 'equips' | 'delegates-to' | 'uses-agent' | 'preloads' | 'depends-on';

export interface ItemRef {
  relation: RefRelation;
  to: ItemId;
  /** Manifest field holding the reference, e.g. `skills.0.ref`. */
  path: string;
  /** Equip mode, for `equips` only. */
  mode?: 'on-demand' | 'always';
}

/** Every outgoing reference declared in a manifest, in declaration order. */
export function referencesOf(m: Manifest): ItemRef[] {
  switch (m.kind) {
    case 'skill':
      return m.dependsOn.map((to, i) => ({ relation: 'depends-on', to, path: `dependsOn.${i}` }));
    case 'agent':
      return [
        ...m.skills.map((s, i) => ({
          relation: 'equips' as const,
          to: s.ref,
          path: `skills.${i}.ref`,
          mode: s.mode,
        })),
        ...m.delegatesTo.map((to, i) => ({
          relation: 'delegates-to' as const,
          to,
          path: `delegatesTo.${i}`,
        })),
      ];
    case 'command':
      return [
        ...(m.agent ? [{ relation: 'uses-agent' as const, to: m.agent, path: 'agent' }] : []),
        ...m.preloadSkills.map((to, i) => ({
          relation: 'preloads' as const,
          to,
          path: `preloadSkills.${i}`,
        })),
      ];
  }
}
