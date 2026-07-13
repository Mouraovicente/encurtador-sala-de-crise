import { existsSync, unlinkSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqliteLinkRepo, type SqliteLinkRepo } from '../../src/infrastructure/db.js';

describe('createSqliteLinkRepo', () => {
  let repo: SqliteLinkRepo;

  beforeEach(() => {
    // ':memory:' keeps the whole test suite offline and filesystem-free.
    repo = createSqliteLinkRepo(':memory:');
  });

  afterEach(() => {
    repo.close();
  });

  it('reports a code as non-existent until it is saved', () => {
    expect(repo.exists('AAAAAA')).toBe(false);
    repo.save('AAAAAA', 'https://example.com');
    expect(repo.exists('AAAAAA')).toBe(true);
  });

  it('finds a saved link with redirects starting at zero', () => {
    repo.save('BBBBBB', 'https://example.org');
    const link = repo.findByCode('BBBBBB');
    expect(link).toMatchObject({ code: 'BBBBBB', url: 'https://example.org', redirects: 0 });
    expect(typeof link?.createdAt).toBe('string');
  });

  it('returns undefined for an unknown code', () => {
    expect(repo.findByCode('ZZZZZZ')).toBeUndefined();
  });

  it('increments redirects on each call', () => {
    repo.save('CCCCCC', 'https://example.net');
    repo.incrementRedirects('CCCCCC');
    repo.incrementRedirects('CCCCCC');
    expect(repo.findByCode('CCCCCC')?.redirects).toBe(2);
  });

  it('persists data across two connections to the same file', () => {
    const dbPath = `${process.env.TEMP ?? '.'}/links-test-${Date.now()}.sqlite`;
    const first = createSqliteLinkRepo(dbPath);
    first.save('DDDDDD', 'https://persisted.example');
    first.close();

    const second = createSqliteLinkRepo(dbPath);
    expect(second.findByCode('DDDDDD')?.url).toBe('https://persisted.example');
    second.close();

    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      if (existsSync(dbPath + suffix)) {
        unlinkSync(dbPath + suffix);
      }
    }
  });
});
