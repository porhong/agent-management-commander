import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdaterPort } from './handlers';

/**
 * Release checks against GitHub Releases (T1.10.4).
 *
 * Nothing happens on its own: the app never downloads or installs behind the user's back, and
 * the check itself only runs when they ask or when `settings.updates` allows it. This is the
 * only network request AMC makes, which is why it is a setting rather than a default.
 *
 * Unverified until a release is published and the installer is signed; an unsigned build will
 * install but Windows will warn about it.
 */
export function createUpdater(
  onProgress: (percent: number, version?: string) => void,
): UpdaterPort | undefined {
  // A dev run has no update metadata to compare against, and would only ever error.
  if (!app.isPackaged) return undefined;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('download-progress', (p: { percent: number }) =>
    onProgress(Math.round(p.percent)),
  );

  let ready: string | null = null;
  autoUpdater.on('update-downloaded', (info: { version: string }) => {
    ready = info.version;
    onProgress(100, info.version);
  });

  return {
    async check() {
      const result = await autoUpdater.checkForUpdates();
      const version = result?.updateInfo.version;
      return version && version !== app.getVersion() ? { version } : null;
    },
    async download() {
      await autoUpdater.downloadUpdate();
    },
    install() {
      if (!ready) return false;
      autoUpdater.quitAndInstall();
      return true;
    },
  };
}
