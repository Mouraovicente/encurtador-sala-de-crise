import { generateUniqueCode, isValidUrl, InvalidUrlError, type RandomIntFn } from '../domain/shortener.js';
import { LinkNotFoundError, type LinkRecord, type LinkRepo } from './ports.js';

export interface CreateLinkOptions {
  /** Injectable RNG, used by tests for deterministic codes. */
  randomInt?: RandomIntFn;
}

/** Validates the URL, generates a unique code and persists the new link. */
export function createLink(repo: LinkRepo, url: string, options: CreateLinkOptions = {}): LinkRecord {
  if (!isValidUrl(url)) {
    throw new InvalidUrlError(url);
  }
  const code = generateUniqueCode((candidate) => repo.exists(candidate), options.randomInt);
  repo.save(code, url);
  const saved = repo.findByCode(code);
  if (!saved) {
    // Should never happen: save() just persisted this code.
    throw new LinkNotFoundError(code);
  }
  return saved;
}

/** Looks up a link by code and records one redirect. Throws if the code is unknown. */
export function resolveLink(repo: LinkRepo, code: string): LinkRecord {
  const link = repo.findByCode(code);
  if (!link) {
    throw new LinkNotFoundError(code);
  }
  repo.incrementRedirects(code);
  const updated = repo.findByCode(code);
  return updated ?? link;
}

/** Returns stats (including accumulated redirects) for a code. Throws if the code is unknown. */
export function getStats(repo: LinkRepo, code: string): LinkRecord {
  const link = repo.findByCode(code);
  if (!link) {
    throw new LinkNotFoundError(code);
  }
  return link;
}
