import { runOp, type WorkerRequest, type WorkerResponse } from './protocol';

/**
 * Utility-process entry (T1.5.5). It has no Electron APIs and no window; it only answers
 * requests from main. Built as a separate bundle by electron.vite.config.ts.
 */
process.parentPort.on('message', (event: { data: WorkerRequest }) => {
  const req = event.data;
  void runOp(req).then(
    (value): void =>
      process.parentPort.postMessage({ id: req.id, ok: true, value } satisfies WorkerResponse),
    (err: unknown): void =>
      process.parentPort.postMessage({
        id: req.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      } satisfies WorkerResponse),
  );
});
