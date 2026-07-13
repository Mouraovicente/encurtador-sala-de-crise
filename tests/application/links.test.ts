import { describe, expect, it } from 'vitest';
import { createLink, getStats, resolveLink } from '../../src/application/links.js';
import { LinkNotFoundError } from '../../src/application/ports.js';
import { InvalidUrlError, CollisionError } from '../../src/domain/shortener.js';
import { createFakeLinkRepo } from '../helpers/fake-link-repo.js';

describe('createLink', () => {
  it('creates a link with a generated code for a valid URL', () => {
    const repo = createFakeLinkRepo();
    const link = createLink(repo, 'https://example.com', { randomInt: () => 0 });
    expect(link.code).toBe('000000');
    expect(link.url).toBe('https://example.com');
    expect(repo.exists('000000')).toBe(true);
  });

  it('rejects an invalid URL', () => {
    const repo = createFakeLinkRepo();
    expect(() => createLink(repo, 'not-a-url', { randomInt: () => 0 })).toThrow(InvalidUrlError);
  });

  it('retries on collision and throws after 3 attempts', () => {
    const repo = createFakeLinkRepo();
    repo.save('000000', 'https://already-exists.com');
    expect(() => createLink(repo, 'https://example.com', { randomInt: () => 0 })).toThrow(
      CollisionError
    );
  });
});

describe('resolveLink', () => {
  it('returns the link and increments its redirect counter', () => {
    const repo = createFakeLinkRepo();
    const link = createLink(repo, 'https://example.com', { randomInt: () => 0 });
    const resolved = resolveLink(repo, link.code);
    expect(resolved.url).toBe('https://example.com');
    expect(getStats(repo, link.code).redirects).toBe(1);
  });

  it('throws LinkNotFoundError for an unknown code', () => {
    const repo = createFakeLinkRepo();
    expect(() => resolveLink(repo, 'ABCDEF')).toThrow(LinkNotFoundError);
  });
});

describe('getStats', () => {
  it('counts redirects across multiple resolutions', () => {
    const repo = createFakeLinkRepo();
    const link = createLink(repo, 'https://example.com', { randomInt: () => 0 });
    resolveLink(repo, link.code);
    resolveLink(repo, link.code);
    resolveLink(repo, link.code);
    expect(getStats(repo, link.code).redirects).toBe(3);
  });

  it('throws LinkNotFoundError for an unknown code', () => {
    const repo = createFakeLinkRepo();
    expect(() => getStats(repo, 'ABCDEF')).toThrow(LinkNotFoundError);
  });
});
