import { contextBridge, ipcRenderer } from 'electron';
import { CHANNEL_NAMES } from '../shared/channels';
import type { AmcApi } from './api';

// Sandboxed preload: no dependencies beyond 'electron' and a plain channel list.
// Validation happens in main; this is a thin, typed pass-through limited to amc: channels.
const invoke = (channel: string, input?: unknown) => ipcRenderer.invoke(`amc:${channel}`, input);

/** Builds `amc.library.list(...)` etc. from the channel names, so nothing is hand-maintained. */
function buildApi(): Record<string, Record<string, (input?: unknown) => Promise<unknown>>> {
  const api: Record<string, Record<string, (input?: unknown) => Promise<unknown>>> = {};
  for (const channel of CHANNEL_NAMES) {
    const [group, method] = channel.split('.') as [string, string];
    (api[group] ??= {})[method] = (input?: unknown) => invoke(channel, input);
  }
  return api;
}

const api = {
  ...buildApi(),
  /** Main → renderer events (T1.5.3). Returns an unsubscribe function. */
  on(listener: (event: { name: string; payload: unknown }) => void): () => void {
    const handler = (_e: unknown, envelope: { name: string; payload: unknown }) =>
      listener(envelope);
    ipcRenderer.on('amc:event', handler);
    return () => ipcRenderer.removeListener('amc:event', handler);
  },
};

contextBridge.exposeInMainWorld('amc', api);

export type { AmcApi };
