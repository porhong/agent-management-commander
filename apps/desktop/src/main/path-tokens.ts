import { randomBytes } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';

/**
 * The renderer must never send a filesystem path (T1.5.2). A folder the user picked in a native
 * dialog is handed to the renderer as an opaque token; only main can turn it back into a path.
 * Tokens live for the session and are bound to the exact path the dialog returned.
 */
export class PathTokenRegistry {
  private readonly byToken = new Map<string, string>();
  private readonly byPath = new Map<string, string>();

  constructor(
    private readonly mint: () => string = () => `tok_${randomBytes(16).toString('hex')}`,
  ) {}

  /** Issues (or reuses) the token for an absolute path the *main* process produced. */
  issue(path: string): string {
    if (!isAbsolute(path)) throw new Error(`Refusing to tokenize a relative path: ${path}`);
    const full = resolve(path);
    const existing = this.byPath.get(full);
    if (existing) return existing;
    const token = this.mint();
    this.byToken.set(token, full);
    this.byPath.set(full, token);
    return token;
  }

  /** Resolves a token the renderer sent back. Throws on anything unknown. */
  resolve(token: string): string {
    const path = this.byToken.get(token);
    if (!path) throw new Error('Unknown or expired folder token. Pick the folder again.');
    return path;
  }

  has(token: string): boolean {
    return this.byToken.has(token);
  }

  get size(): number {
    return this.byToken.size;
  }
}
