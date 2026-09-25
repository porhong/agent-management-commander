import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WEB_PREFERENCES, isAllowedExternal, isAllowedNavigation } from './window';

/**
 * T1.5.1: the Electron security checklist as assertions, so a regression fails the suite
 * instead of shipping (docs/plan/engineering-practices.md §6).
 */
describe('window hardening (T1.5.1)', () => {
  it('locks down webPreferences', () => {
    expect(WEB_PREFERENCES).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    });
  });

  it('opens only https links externally', () => {
    expect(isAllowedExternal('https://code.claude.com/docs')).toBe(true);
    for (const url of [
      'http://example.com',
      'file:///C:/Windows/system32',
      'javascript:alert(1)',
      'not a url',
    ]) {
      expect(isAllowedExternal(url), url).toBe(false);
    }
  });

  it('allows navigation only within the app bundle or the dev server', () => {
    expect(isAllowedNavigation('file:///C:/app/out/renderer/index.html')).toBe(true);
    expect(isAllowedNavigation('http://localhost:5173/', 'http://localhost:5173')).toBe(true);
    expect(isAllowedNavigation('https://evil.example.com')).toBe(false);
    expect(isAllowedNavigation('http://localhost:5173/', undefined)).toBe(false);
  });

  it('serves a strict CSP with no inline or remote scripts', () => {
    const html = readFileSync(resolve(__dirname, '../renderer/index.html'), 'utf8');
    const csp = /content="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-eval');
    expect(/script-src[^;]*unsafe-inline/.test(csp)).toBe(false);
  });
});
