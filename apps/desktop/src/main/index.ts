import { join } from 'node:path';
import { app, BrowserWindow, shell } from 'electron';
import { registerIpc } from './ipc-router';
import { probeSqlite } from './sqlite-probe';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Agent Management Commander',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  // No in-app navigation or new windows; only vetted https links open in the OS browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
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

  const systemProbe = () => ({
    versions: {
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome,
    },
    sqlite: probeSqlite(),
  });

  void app.whenReady().then(() => {
    // Headless smoke test for CI and packaged builds: print the probe and exit.
    if (process.env['AMC_SMOKE'] === '1') {
      const result = systemProbe();
      process.stdout.write(JSON.stringify(result) + '\n');
      app.exit(result.sqlite.ok && result.sqlite.fts5 ? 0 : 1);
      return;
    }
    registerIpc({ 'system.probe': systemProbe });
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
