import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryService, NodeFs, bootstrapHome } from '@amc/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkerClient, type WorkerPort } from './client';
import { fromWire, runOp } from './protocol';

let home: string;
let library: string;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'amc-worker-'));
  const paths = await bootstrapHome(new NodeFs(), join(home, '.amc'));
  library = paths.library;
  const svc = new LibraryService({ fs: new NodeFs(), root: library });
  await svc.create({
    kind: 'skill',
    slug: 'sec',
    description: 'A description long enough.',
    body: '# Sec\n',
  });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

/** A worker that answers correctly, driven synchronously by the test. */
function fakeWorker(behaviour: 'ok' | 'error' | 'silent' | 'exit'): {
  port: WorkerPort;
  killed: () => boolean;
} {
  let killed = false;
  const listeners: Record<string, Array<(v: never) => void>> = {};
  const port: WorkerPort = {
    postMessage(message) {
      if (behaviour === 'silent') return;
      if (behaviour === 'exit') return listeners['exit']?.forEach((l) => l(undefined as never));
      const response =
        behaviour === 'ok'
          ? {
              id: message.id,
              ok: true as const,
              value: { items: [], problems: [{ path: 'from/worker', message: 'x' }] },
            }
          : { id: message.id, ok: false as const, error: 'worker blew up' };
      queueMicrotask(() => listeners['message']?.forEach((l) => l(response as never)));
    },
    on(event: string, listener: (v: never) => void) {
      (listeners[event] ??= []).push(listener);
    },
    kill() {
      killed = true;
    },
  };
  return { port, killed: () => killed };
}

describe('WorkerClient (T1.5.5)', () => {
  it('runs in-process when no worker is configured', async () => {
    const result = await new WorkerClient().run('library.load', { root: library });
    expect(result.items.map((i) => fromWire(i).manifest.id)).toEqual(['skill.sec']);
    expect(fromWire(result.items[0]!).body).toBe('# Sec\n');
  });

  it('uses the worker when it answers', async () => {
    const { port, killed } = fakeWorker('ok');
    const client = new WorkerClient({ spawn: () => port });
    const result = await client.run('library.load', { root: library });
    expect(result.problems).toEqual([{ path: 'from/worker', message: 'x' }]);
    client.dispose();
    expect(killed()).toBe(true);
  });

  it.each(['error', 'exit', 'silent'] as const)(
    'falls back in-process when the worker %ss',
    async (behaviour) => {
      const reasons: string[] = [];
      const client = new WorkerClient({
        spawn: () => fakeWorker(behaviour).port,
        timeoutMs: 20,
        onFallback: (r) => reasons.push(r),
      });
      const result = await client.run('library.load', { root: library });
      expect(result.items.map((i) => fromWire(i).manifest.id)).toEqual(['skill.sec']);
      expect(reasons).toHaveLength(1);
    },
  );

  it('falls back when the worker cannot be spawned at all', async () => {
    const reasons: string[] = [];
    const client = new WorkerClient({
      spawn: () => {
        throw new Error('utilityProcess unavailable');
      },
      onFallback: (r) => reasons.push(r),
    });
    expect((await client.run('library.load', { root: library })).items).toHaveLength(1);
    expect(reasons[0]).toContain('utilityProcess unavailable');
  });

  it('serializes items losslessly across the boundary', async () => {
    const svc = new LibraryService({ fs: new NodeFs(), root: library });
    await svc.update('skill.sec', { files: { 'scripts/x.ps1': Buffer.from([0, 1, 2, 255]) } });
    const { items } = await runOp({ id: 1, op: 'library.load', payload: { root: library } });
    const back = fromWire(items[0]!);
    expect([...back.files['scripts/x.ps1']!]).toEqual([0, 1, 2, 255]);
    expect(back.manifest.version).toBe('0.1.1');
  });
});
