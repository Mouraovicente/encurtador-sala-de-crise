import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { LinkRecord, LinkRepo } from '../application/ports.js';

export interface SqliteLinkRepo extends LinkRepo {
  close(): void;
}

interface LinkRow {
  code: string;
  url: string;
  created_at: string;
  redirects: number;
}

function toLinkRecord(row: LinkRow): LinkRecord {
  return {
    code: row.code,
    url: row.url,
    createdAt: row.created_at,
    redirects: row.redirects
  };
}

/** Creates a SQLite-backed LinkRepo. Pass ':memory:' for an ephemeral, offline-friendly instance. */
export function createSqliteLinkRepo(dbPath: string): SqliteLinkRepo {
  if (dbPath !== ':memory:') {
    const dir = dirname(dbPath);
    if (dir && dir !== '.') {
      mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS links (
      code TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      created_at TEXT NOT NULL,
      redirects INTEGER NOT NULL DEFAULT 0
    )
  `);

  const insertStmt = db.prepare(
    'INSERT INTO links (code, url, created_at, redirects) VALUES (@code, @url, @createdAt, 0)'
  );
  const existsStmt = db.prepare('SELECT 1 FROM links WHERE code = ?');
  const findStmt = db.prepare('SELECT * FROM links WHERE code = ?');
  const incrementStmt = db.prepare('UPDATE links SET redirects = redirects + 1 WHERE code = ?');

  return {
    save(code: string, url: string): void {
      insertStmt.run({ code, url, createdAt: new Date().toISOString() });
    },
    exists(code: string): boolean {
      return existsStmt.get(code) !== undefined;
    },
    findByCode(code: string): LinkRecord | undefined {
      const row = findStmt.get(code) as LinkRow | undefined;
      return row ? toLinkRecord(row) : undefined;
    },
    incrementRedirects(code: string): void {
      incrementStmt.run(code);
    },
    close(): void {
      db.close();
    }
  };
}
