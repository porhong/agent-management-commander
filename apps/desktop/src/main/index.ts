import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nodeAdapterHost } from '@amc/core';
import { BrowserWindow, app, dialog, shell, utilityProcess } from 'electron';
import { createAppServices } from './app-services';
import { createHandlers, type DialogPort, type ShellPort } from './handlers';
import { createEmitter, registerIpc } from './ipc-router';
import { probeSqlite } from './sqlite-probe';
import { createUpdater } from './updater';
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

const electronShell: ShellPort = {
  async openPath(path) {
    // `openPath` resolves to '' on success and an error message otherwise.
    return (await shell.openPath(path)) === '';
  },
  relaunch() {
    app.relaunch();
    app.exit(0);
  },
};

/**
 * Dev and E2E only: point the adapters at a throwaway home so a real deploy lands there instead
 * of the user's `~/.claude`. Overriding `USERPROFILE` instead crashes Electron on Windows.
 */
const toolHost = () => {
  const home = process.env['AMC_TOOL_HOME'];
  return home ? { host: { ...nodeAdapterHost(), home } } : {};
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
      ...toolHost(),
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
      ...toolHost(),
    });
    const log = services.logger.child('main');

    registerIpc(
      createHandlers({
        services,
        dialog: electronDialog,
        probe: systemProbe,
        shell: electronShell,
        version: app.getVersion(),
        updater: createUpdater((percent, updateVersion) =>
          emit('update.progress', { percent, ...(updateVersion && { version: updateVersion }) }),
        ),
      }),
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

    const win = createWindow();

    // Dev/CI capture: render the app, write a PNG, and exit. Used to review the UI without a
    // visible desktop, and by the E2E suite in M1.10.
    const shotPath = process.env['AMC_SCREENSHOT'];
    if (shotPath) {
      const step = Number(process.env['AMC_SCREENSHOT_DELAY'] ?? 1500);
      const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

      /** Clicks the first button or link whose text contains `label`. Throws if there is none. */
      const clickByText = (label: string) =>
        win.webContents.executeJavaScript(
          `(() => {
             const wanted = ${JSON.stringify(label)};
             const el = [...document.querySelectorAll('button,a,[role="button"]')]
               .find((e) => !e.disabled && (e.textContent || '').includes(wanted));
             if (!el) throw new Error('nothing to click: ' + wanted);
             el.click();
           })()`,
        );

      win.webContents.once('did-finish-load', () => {
        void (async () => {
          try {
            const route = process.env['AMC_SCREENSHOT_ROUTE'];
            if (route) {
              await win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(route)}`);
            }
            await wait(step);
            // `A|B` clicks A, waits, then clicks B — enough to reach a dialog before capturing.
            for (const label of (process.env['AMC_SCREENSHOT_CLICK'] ?? '')
              .split('|')
              .filter(Boolean)) {
              await clickByText(label);
              await wait(step);
            }
            const image = await win.webContents.capturePage();
            await writeFile(shotPath, image.toPNG());
            app.exit(0);
          } catch (err) {
            process.stderr.write(`${String(err)}\n`);
            app.exit(1);
          }
        })();
      });
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
