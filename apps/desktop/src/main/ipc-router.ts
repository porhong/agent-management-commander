import { ipcMain, type BrowserWindow } from 'electron';
import { isAmcError } from '@amc/core';
import {
  CHANNELS,
  EVENT_CHANNEL,
  IPC_PREFIX,
  eventContract,
  ipcContract,
  type Channel,
  type EventName,
  type EventPayload,
  type IpcResult,
} from '../shared/ipc-contract';
import type { HandlerMap } from './handlers';

/**
 * Binds the contract to Electron (T1.5.2). Only the channels in the contract are registered, so
 * any other `invoke` is rejected by Electron itself. Input and output are Zod-validated here, and
 * errors are serialized rather than thrown across the boundary.
 */
export function registerIpc(
  handlers: HandlerMap,
  onError?: (channel: Channel, err: unknown) => void,
): void {
  for (const channel of CHANNELS) {
    const { input, output } = ipcContract[channel];
    ipcMain.handle(IPC_PREFIX + channel, async (_event, raw): Promise<IpcResult<unknown>> => {
      const parsed = input.safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          error: {
            code: 'INVALID_INPUT',
            message: parsed.error.issues
              .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
              .join('; '),
          },
        };
      }
      try {
        const handler = handlers[channel] as (i: unknown) => Promise<unknown>;
        return { ok: true, value: output.parse(await handler(parsed.data)) };
      } catch (err) {
        onError?.(channel, err);
        if (isAmcError(err)) {
          return {
            ok: false,
            error: { code: err.code, message: err.message, details: err.details },
          };
        }
        return {
          ok: false,
          error: {
            code: 'HANDLER_FAILED',
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
    });
  }
}

export function unregisterIpc(): void {
  for (const channel of CHANNELS) ipcMain.removeHandler(IPC_PREFIX + channel);
}

/** Pushes validated events to every open window (T1.5.3). */
export function createEmitter(windows: () => BrowserWindow[]) {
  return <E extends EventName>(name: E, payload: EventPayload<E>): void => {
    const parsed = eventContract[name].safeParse(payload);
    if (!parsed.success) throw new Error(`Invalid ${name} event payload: ${parsed.error.message}`);
    for (const win of windows()) {
      if (!win.isDestroyed()) win.webContents.send(EVENT_CHANNEL, { name, payload: parsed.data });
    }
  };
}
