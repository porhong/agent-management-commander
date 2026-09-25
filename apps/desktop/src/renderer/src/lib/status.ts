/** Deployment status vocabulary, shared by the list, the matrix, and the dashboard (concept 03 §6). */
export type SyncStatus =
  'in-sync' | 'outdated' | 'drifted' | 'missing' | 'foreign' | 'not-deployed';

export interface StatusMeta {
  label: string;
  /** What it means, in the user's terms. Used as the tooltip. */
  hint: string;
  dot: string;
  text: string;
}

export const STATUS: Record<SyncStatus, StatusMeta> = {
  'in-sync': {
    label: 'In sync',
    hint: 'The deployed file matches the library.',
    dot: 'bg-in-sync',
    text: 'text-in-sync',
  },
  outdated: {
    label: 'Outdated',
    hint: 'The library has a newer version than what is deployed.',
    dot: 'bg-outdated',
    text: 'text-outdated',
  },
  drifted: {
    label: 'Drifted',
    hint: 'The deployed file was edited outside AMC.',
    dot: 'bg-drifted',
    text: 'text-drifted',
  },
  missing: {
    label: 'Missing',
    hint: 'Deployed, but the item is no longer in the library.',
    dot: 'bg-missing',
    text: 'text-missing',
  },
  foreign: {
    label: 'Foreign',
    hint: 'A file AMC does not manage. It is never modified.',
    dot: 'bg-foreign',
    text: 'text-foreign',
  },
  'not-deployed': {
    label: 'Not deployed',
    hint: 'This item is not installed in any tool yet.',
    dot: 'bg-transparent ring-1 ring-border',
    text: 'text-muted-foreground',
  },
};

export const formatDate = (iso: string | null): string => {
  if (!iso) return '—';
  const then = new Date(iso);
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};
