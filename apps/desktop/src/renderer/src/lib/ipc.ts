import { useCallback, useEffect, useRef, useState } from 'react';
import type { AmcEvent } from '../../../preload/api';
import type { Channel, ChannelInput, ChannelOutput, IpcError } from '../../../shared/ipc-contract';

/** Thrown when main returns `{ ok: false }`. Carries the code so callers can branch on it. */
export class IpcCallError extends Error {
  constructor(readonly error: IpcError) {
    super(error.message);
    this.name = 'IpcCallError';
  }
}

type Group = {
  [m: string]: (input?: unknown) => Promise<{ ok: boolean; value?: unknown; error?: IpcError }>;
};

/** Calls a channel and unwraps the result, so screens deal in values and exceptions. */
export async function call<C extends Channel>(
  channel: C,
  ...args: void extends ChannelInput<C> ? [] : [ChannelInput<C>]
): Promise<ChannelOutput<C>> {
  const [group, method] = channel.split('.') as [string, string];
  const api = (window.amc as unknown as Record<string, Group>)[group];
  const fn = api?.[method];
  if (!fn) throw new IpcCallError({ code: 'NO_CHANNEL', message: `${channel} is not available` });
  const result = await fn(args[0]);
  if (!result.ok) throw new IpcCallError(result.error ?? { code: 'UNKNOWN', message: channel });
  return result.value as ChannelOutput<C>;
}

/** Stands in for `undefined` in the dependency key, which JSON cannot represent. */
const VOID = '\u0000void';

export type QueryState<T> = {
  data: T | undefined;
  error: IpcError | undefined;
  loading: boolean;
  reload: () => void;
};

/**
 * Reads a channel and re-reads it when one of `on` events fires. Deliberately small: the app has
 * one data source and no cache to invalidate, so a query library would be overhead.
 */
export function useQuery<C extends Channel>(
  channel: C,
  input: void extends ChannelInput<C> ? undefined : ChannelInput<C>,
  opts: { on?: AmcEvent['name'][]; enabled?: boolean } = {},
): QueryState<ChannelOutput<C>> {
  const [data, setData] = useState<ChannelOutput<C>>();
  const [error, setError] = useState<IpcError>();
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const enabled = opts.enabled ?? true;
  // `undefined` is not JSON, so it round-trips as the sentinel below. Channels that take no
  // input declare `z.void()`, which rejects null — they must be called with no argument at all.
  const key = input === undefined ? VOID : JSON.stringify(input);
  const events = opts.on?.join(',') ?? '';

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return setLoading(false);
    let cancelled = false;
    setLoading(true);
    call(channel, ...((key === VOID ? [] : [JSON.parse(key)]) as never))
      .then((value) => {
        if (cancelled) return;
        setData(value);
        setError(undefined);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof IpcCallError ? err.error : { code: 'UNKNOWN', message: String(err) },
        );
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [channel, key, nonce, enabled]);

  useEffect(() => {
    if (!events) return;
    const names = new Set(events.split(','));
    return window.amc.on((event) => {
      if (names.has(event.name)) reload();
    });
  }, [events, reload]);

  return { data, error, loading, reload };
}

/** Runs a channel on demand and tracks the in-flight and error state of that one call. */
export function useAction<C extends Channel>(channel: C) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<IpcError>();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (
      ...args: void extends ChannelInput<C> ? [] : [ChannelInput<C>]
    ): Promise<ChannelOutput<C> | undefined> => {
      setPending(true);
      setError(undefined);
      try {
        return await call(channel, ...args);
      } catch (err) {
        if (mounted.current) {
          setError(
            err instanceof IpcCallError ? err.error : { code: 'UNKNOWN', message: String(err) },
          );
        }
        return undefined;
      } finally {
        if (mounted.current) setPending(false);
      }
    },
    [channel],
  );

  return { run, pending, error, clearError: () => setError(undefined) };
}
