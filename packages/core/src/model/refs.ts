import type { ItemId } from './common';
import type { Manifest } from './manifests';

/** How one item points at another. Mirrors the composition rules in docs/concept/02. */
export type RefRelation = 'equips' | 'delegates-to' | 'uses-agent' | 'preloads' | 'depends-on';

export interface ItemRef {
  relation: RefRelation;
  to: ItemId;
}

/** Every outgoing reference declared in a manifest, in declaration order. */
export function referencesOf(m: Manifest): ItemRef[] {
  switch (m.kind) {
    case 'skill':
      return m.dependsOn.map((to) => ({ relation: 'depends-on', to }));
    case 'agent':
      return [
        ...m.skills.map((s) => ({ relation: 'equips' as const, to: s.ref })),
        ...m.delegatesTo.map((to) => ({ relation: 'delegates-to' as const, to })),
      ];
    case 'command':
      return [
        ...(m.agent ? [{ relation: 'uses-agent' as const, to: m.agent }] : []),
        ...m.preloadSkills.map((to) => ({ relation: 'preloads' as const, to })),
      ];
  }
}
