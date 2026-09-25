import { NodeFs, LibraryService, type LibraryItem } from '@amc/core';

/**
 * Work that runs in a utility process (T1.5.5), so a large library scan never blocks main's
 * event loop and IPC replies stay prompt. The same functions run in-process as a fallback.
 */

export interface WorkerRequest {
  id: number;
  op: 'library.load';
  payload: { root: string };
}

/** Items cross the process boundary as plain JSON; buffers become base64. */
export interface WireItem {
  manifest: unknown;
  body: string;
  files: Record<string, string>;
}

export interface WorkerLoadResult {
  items: WireItem[];
  problems: Array<{ path: string; message: string }>;
}

export type WorkerResponse =
  { id: number; ok: true; value: WorkerLoadResult } | { id: number; ok: false; error: string };

export const toWire = (item: LibraryItem): WireItem => ({
  manifest: item.manifest,
  body: item.body,
  files: Object.fromEntries(Object.entries(item.files).map(([k, v]) => [k, v.toString('base64')])),
});

export const fromWire = (w: WireItem): LibraryItem => ({
  manifest: w.manifest as LibraryItem['manifest'],
  body: w.body,
  files: Object.fromEntries(Object.entries(w.files).map(([k, v]) => [k, Buffer.from(v, 'base64')])),
});

/** The actual work, shared by the worker entry and the in-process fallback. */
export async function runOp(req: WorkerRequest): Promise<WorkerLoadResult> {
  const library = new LibraryService({ fs: new NodeFs(), root: req.payload.root });
  const { items, problems } = await library.load();
  return {
    items: items.map(toWire),
    problems: problems.map((p) => ({ path: p.path, message: p.message })),
  };
}
