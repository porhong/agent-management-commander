import { contextBridge, ipcRenderer } from 'electron';
import type { Channel, ChannelInput, IpcResult } from '../shared/ipc-contract';

// Sandboxed preload: keep this file dependency-free apart from 'electron'.
// Validation happens in main; this is a thin, typed pass-through limited to amc: channels.
const invoke = (channel: Channel, input?: unknown): Promise<IpcResult<unknown>> =>
  ipcRenderer.invoke(`amc:${channel}`, input);

const api = {
  system: {
    probe: (input?: ChannelInput<'system.probe'>) => invoke('system.probe', input),
  },
};

contextBridge.exposeInMainWorld('amc', api);

export type AmcApi = typeof api;
