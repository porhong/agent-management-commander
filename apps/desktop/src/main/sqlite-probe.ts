import { DatabaseSync } from 'node:sqlite';

/**
 * Phase 0 toolchain probe (P0-03): proves SQLite with FTS5 works inside the packaged Electron
 * app. Uses the built-in `node:sqlite` (no native module to rebuild), chosen after
 * better-sqlite3 had no prebuilt binary for our toolchain. Replaced by IndexStore in M1.5.
 */
export function probeSqlite(): { ok: boolean; version: string | null; fts5: boolean } {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(':memory:');
    const version = (db.prepare('select sqlite_version() as v').get() as { v: string }).v;
    db.exec(`create virtual table t using fts5(body);
             insert into t(body) values ('security checklist skill');`);
    const hit = db.prepare(`select count(*) as n from t where t match 'checklist'`).get() as {
      n: number;
    };
    return { ok: true, version, fts5: hit.n === 1 };
  } catch {
    return { ok: false, version: null, fts5: false };
  } finally {
    db?.close();
  }
}
