import { ipcMain } from 'electron';
import {
  IPC_PREFIX,
  ipcContract,
  type Channel,
  type ChannelOutput,
  type IpcResult,
} from '../shared/ipc-contract';

type Handlers = {
  [C in Channel]: (input: unknown) => Promise<ChannelOutput<C>> | ChannelOutput<C>;
};

/** Registers one handler per contract channel, validating input and output with Zod. */
export function registerIpc(handlers: Handlers): void {
  for (const channel of Object.keys(ipcContract) as Channel[]) {
    const { input, output } = ipcContract[channel];
    ipcMain.handle(IPC_PREFIX + channel, async (_event, raw): Promise<IpcResult<unknown>> => {
      const parsed = input.safeParse(raw);
      if (!parsed.success) {
        return { ok: false, error: { code: 'INVALID_INPUT', message: parsed.error.message } };
      }
      try {
        const value = output.parse(await handlers[channel](parsed.data));
        return { ok: true, value };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: { code: 'HANDLER_FAILED', message } };
      }
    });
  }
}
