import { join } from 'node:path';
import { BrowserWindow, app, dialog, utilityProcess } from 'electron';
import { createAppServices } from './app-services';
import { createHandlers, type DialogPort } from './handlers';
import { createEmitter, registerIpc } from './ipc-router';
import { probeSqlite } from './sqlite-probe';
import { createWindow } from './window';
import type { WorkerPort } from './worker/client';

const systemProbe = () => ({
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
  },
  sqlite: probeSqlite(),
});

const electronDialog: DialogPort = {
  async pickFolder(title) {
    const result = await dialog.showOpenDialog({
      title: title ?? 'Choose a project folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  },
};

/** Spawns the scan worker (T1.5.5); the client falls back in-process if this throws. */
const spawnWorker = (): WorkerPort =>
  utilityProcess.fork(join(__dirname, 'worker.js'), [], {
    serviceName: 'amc-worker',
  }) as unknown as WorkerPort;

/** Smoke helper: starts everything once against `AMC_HOME` and reports what the worker did. */
async function bootServices() {
  const fallbacks: string[] = [];
  try {
    const services = await createAppServices({
      home: process.env['AMC_HOME']!,
      spawnWorker,
      onWorkerFallback: (reason) => fallbacks.push(reason),
    });
    const { items } = await services.refreshIndex();
    const targets = services.targets().length;
    services.close();
    return { ok: fallbacks.length === 0, items, targets, fallbacks };
  } catch (err) {
    return { ok: false, items: 0, targets: 0, fallbacks: [(err as Error).message] };
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  void app.whenReady().then(async () => {
    // Headless smoke test for CI and packaged builds: print the probe and exit.
    if (process.env['AMC_SMOKE'] === '1') {
      const result = systemProbe();
      // With AMC_HOME set, also boot the services so the utility process is exercised too.
      const services = process.env['AMC_HOME'] ? await bootServices() : null;
      process.stdout.write(JSON.stringify({ ...result, ...(services && { services }) }) + '\n');
      app.exit(result.sqlite.ok && result.sqlite.fts5 && services?.ok !== false ? 0 : 1);
      return;
    }

    const emit = createEmitter(() => BrowserWindow.getAllWindows());
    const services = await createAppServices({
      emit,
      spawnWorker,
      ...(process.env['AMC_HOME'] ? { home: process.env['AMC_HOME'] } : {}),
    });
    const log = services.logger.child('main');

    registerIpc(
      createHandlers({ services, dialog: electronDialog, probe: systemProbe }),
      (channel, err) =>
        log.error('ipc handler failed', {
          channel,
          reason: err instanceof Error ? err.message : String(err),
        }),
    );

    app.on('before-quit', () => {
      services.close();
      void services.logger.flush();
    });

    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
