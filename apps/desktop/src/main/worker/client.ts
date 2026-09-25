import { runOp, type WorkerRequest, type WorkerResponse } from './protocol';

/** The slice of Electron's `UtilityProcess` this client needs, so tests can supply a fake. */
export interface WorkerPort {
  postMessage(message: WorkerRequest): void;
  on(event: 'message', listener: (value: WorkerResponse) => void): void;
  on(event: 'exit', listener: () => void): void;
  kill(): void;
}

export type SpawnWorker = () => WorkerPort;

export interface WorkerClientOptions {
  /** Omitted (or throwing) means everything runs in-process. */
  spawn?: SpawnWorker;
  timeoutMs?: number;
  onFallback?: (reason: string) => void;
}

/**
 * Sends heavy work to a utility process, and falls back to running it in-process when the worker
 * can't start, dies, or takes too long. Callers never have to care which happened.
 */
export class WorkerClient {
  private worker: WorkerPort | null = null;
  private readonly pending = new Map<number, { resolve: (v: WorkerResponse) => void }>();
  private nextId = 1;
  private disposed = false;

  constructor(private readonly opts: WorkerClientOptions = {}) {}

  private ensure(): WorkerPort | null {
    if (this.disposed || !this.opts.spawn) return null;
    if (this.worker) return this.worker;
    try {
      const worker = this.opts.spawn();
      worker.on('message', (res: WorkerResponse) => this.pending.get(res.id)?.resolve(res));
      worker.on('exit', () => {
        this.worker = null;
        for (const { resolve } of this.pending.values())
          resolve({ id: -1, ok: false, error: 'worker exited' });
        this.pending.clear();
      });
      this.worker = worker;
      return worker;
    } catch (err) {
      this.opts.onFallback?.(`worker failed to start: ${(err as Error).message}`);
      return null;
    }
  }

  async run(op: WorkerRequest['op'], payload: WorkerRequest['payload']) {
    const worker = this.ensure();
    const request: WorkerRequest = { id: this.nextId++, op, payload };
    if (!worker) return runOp(request);

    const response = await new Promise<WorkerResponse>((resolve) => {
      const timer = setTimeout(
        () => resolve({ id: request.id, ok: false, error: 'worker timed out' }),
        this.opts.timeoutMs ?? 60_000,
      );
      this.pending.set(request.id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
      });
      try {
        worker.postMessage(request);
      } catch (err) {
        clearTimeout(timer);
        resolve({ id: request.id, ok: false, error: (err as Error).message });
      }
    });
    this.pending.delete(request.id);

    if (response.ok) return response.value;
    this.opts.onFallback?.(response.error);
    return runOp(request);
  }

  dispose(): void {
    this.disposed = true;
    this.worker?.kill();
    this.worker = null;
  }
}
