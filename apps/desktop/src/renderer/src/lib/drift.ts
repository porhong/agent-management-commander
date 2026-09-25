import { useEffect } from 'react';
import { useQuery, type QueryState } from '@/lib/ipc';
import type { ChannelOutput } from '../../../shared/ipc-contract';

export type Drift = ChannelOutput<'status.drift'>;

/** Long enough to be free, short enough that a stale dashboard is never interesting. */
const EVERY = 5 * 60_000;

/**
 * Keeps the drift picture current (T1.9.3): once now, again whenever the window regains focus,
 * and on a slow timer for a window left open. A real file watcher arrives in Phase 2.
 */
export function useDrift(intervalMs = EVERY): QueryState<Drift> {
  const query = useQuery('status.drift', undefined, { on: ['library.changed'] });
  const { reload } = query;

  useEffect(() => {
    window.addEventListener('focus', reload);
    const timer = setInterval(reload, intervalMs);
    return () => {
      window.removeEventListener('focus', reload);
      clearInterval(timer);
    };
  }, [reload, intervalMs]);

  return query;
}
