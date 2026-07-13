import { describe, expect, it } from 'vitest';
import {
  CollisionError,
  InvalidUrlError,
  generateCode,
  generateUniqueCode,
  isValidUrl
} from '../../src/domain/shortener.js';

describe('generateCode', () => {
  it('generates a 6 character base62 code', () => {
    const code = generateCode(() => 0);
    expect(code).toHaveLength(6);
    expect(code).toMatch(/^[0-9A-Za-z]{6}$/);
  });

  it('is deterministic when the RNG is injected', () => {
    const code = generateCode(() => 0);
    expect(code).toBe('000000');
  });

  it('uses the injected RNG to pick different characters', () => {
    const sequence = [1, 2, 3, 4, 5, 6];
    let i = 0;
    const code = generateCode(() => sequence[i++] as number);
    expect(code).toBe('123456');
  });
});

describe('isValidUrl', () => {
  it('accepts http urls', () => {
    expect(isValidUrl('http://example.com')).toBe(true);
  });

  it('accepts https urls', () => {
    expect(isValidUrl('https://example.com/path?x=1')).toBe(true);
  });

  it('rejects urls with other protocols', () => {
    expect(isValidUrl('ftp://example.com')).toBe(false);
  });

  it('rejects malformed strings', () => {
    expect(isValidUrl('not a url')).toBe(false);
  });
});

describe('generateUniqueCode', () => {
  it('returns a fresh code when there is no collision', () => {
    const code = generateUniqueCode(() => false, () => 0);
    expect(code).toBe('000000');
  });

  it('retries up to 3 times on collision and then succeeds', () => {
    let calls = 0;
    const codeExists = () => {
      calls += 1;
      return calls < 3;
    };
    const code = generateUniqueCode(codeExists, () => 0);
    expect(code).toBe('000000');
    expect(calls).toBe(3);
  });

  it('throws CollisionError after 3 failed attempts', () => {
    expect(() => generateUniqueCode(() => true, () => 0)).toThrow(CollisionError);
  });
});

describe('InvalidUrlError', () => {
  it('is exported for callers to check with instanceof', () => {
    const err = new InvalidUrlError('nope');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('nope');
  });
});
