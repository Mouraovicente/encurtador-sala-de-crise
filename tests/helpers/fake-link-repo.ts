import type { LinkRecord, LinkRepo } from '../../src/application/ports.js';

/** In-memory LinkRepo used by tests so no test depends on SQLite or the filesystem. */
export function createFakeLinkRepo(): LinkRepo {
  const links = new Map<string, LinkRecord>();

  return {
    save(code: string, url: string): void {
      links.set(code, { code, url, createdAt: new Date().toISOString(), redirects: 0 });
    },
    exists(code: string): boolean {
      return links.has(code);
    },
    findByCode(code: string): LinkRecord | undefined {
      return links.get(code);
    },
    incrementRedirects(code: string): void {
      const link = links.get(code);
      if (link) {
        link.redirects += 1;
      }
    }
  };
}
