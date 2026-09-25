import { join } from 'node:path';
import { BrowserWindow, app, shell, type WebPreferences } from 'electron';

/**
 * Electron hardening (T1.5.1). Kept as data so a test can assert it without launching Electron
 * (docs/plan/engineering-practices.md §6 security checklist).
 */
export const WEB_PREFERENCES: WebPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  webviewTag: false,
  spellcheck: false,
};

/** Only these open in the OS browser; everything else is refused. */
export const isAllowedExternal = (url: string): boolean => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
};

/** In-app navigation is limited to the app's own bundle (and the dev server while developing). */
export function isAllowedNavigation(url: string, devUrl?: string): boolean {
  if (url.startsWith('file://')) return true;
  return !!devUrl && url.startsWith(devUrl);
}

export function createWindow(): BrowserWindow {
  const devUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined;
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'Agent Management Commander',
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), ...WEB_PREFERENCES },
  });

  win.once('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternal(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, devUrl)) event.preventDefault();
  });
  // A sandboxed renderer should never ask for camera, geolocation, and the like.
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );

  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));

  return win;
}
