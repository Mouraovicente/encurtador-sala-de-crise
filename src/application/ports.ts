/** Application-level ports (interfaces) that infrastructure adapters must implement. */

export interface LinkRecord {
  code: string;
  url: string;
  createdAt: string;
  redirects: number;
}

export interface LinkRepo {
  save(code: string, url: string): void;
  exists(code: string): boolean;
  findByCode(code: string): LinkRecord | undefined;
  incrementRedirects(code: string): void;
}

export class LinkNotFoundError extends Error {
  constructor(code: string) {
    super(`Link not found for code: ${code}`);
    this.name = 'LinkNotFoundError';
  }
}
