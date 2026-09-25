import { z } from 'zod';

/**
 * Single source of truth for renderer ↔ main communication (see docs/plan T1.5.2).
 * Every channel declares its input and output schema; main validates both.
 * There is deliberately no generic filesystem channel.
 */
export const ipcContract = {
  'system.probe': {
    input: z.void(),
    output: z.object({
      versions: z.object({ electron: z.string(), node: z.string(), chrome: z.string() }),
      sqlite: z.object({ ok: z.boolean(), version: z.string().nullable(), fts5: z.boolean() }),
    }),
  },
} as const;

export type IpcContract = typeof ipcContract;
export type Channel = keyof IpcContract;
export type ChannelInput<C extends Channel> = z.input<IpcContract[C]['input']>;
export type ChannelOutput<C extends Channel> = z.output<IpcContract[C]['output']>;

export const IPC_PREFIX = 'amc:';

/** Errors crossing the IPC boundary are always serialized into this shape. */
export const ipcErrorSchema = z.object({ code: z.string(), message: z.string() });
export type IpcError = z.infer<typeof ipcErrorSchema>;

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: IpcError };
