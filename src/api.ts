import Fastify, { type FastifyInstance } from 'fastify';
import { createLink, resolveLink, getStats } from './application/links.js';
import { LinkNotFoundError } from './application/ports.js';
import type { LinkRepo } from './application/ports.js';
import { InvalidUrlError, CollisionError, type RandomIntFn } from './domain/shortener.js';

export interface BuildAppOptions {
  linkRepo: LinkRepo;
  /** Base URL used to build the shortUrl returned by POST /links (e.g. http://localhost:8080). */
  publicBaseUrl?: string;
  /** Injectable RNG, used by tests for deterministic codes. */
  randomInt?: RandomIntFn;
}

interface CreateLinkBody {
  url?: string;
}

function baseUrlFor(request: { protocol: string; hostname: string }, configured?: string): string {
  return configured ?? `${request.protocol}://${request.hostname}`;
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const { linkRepo, publicBaseUrl, randomInt } = options;
  const app = Fastify({ logger: false });

  app.get('/health', async () => ({ status: 'ok' }));

  app.post<{ Body: CreateLinkBody }>('/links', async (request, reply) => {
    const url = request.body?.url;
    if (!url || typeof url !== 'string') {
      return reply.code(400).send({ error: 'Missing required field: url' });
    }
    try {
      const link = createLink(linkRepo, url, { randomInt });
      const base = baseUrlFor(request, publicBaseUrl);
      return reply.code(201).send({ code: link.code, shortUrl: `${base}/${link.code}` });
    } catch (err) {
      if (err instanceof InvalidUrlError) {
        return reply.code(400).send({ error: err.message });
      }
      if (err instanceof CollisionError) {
        return reply.code(500).send({ error: err.message });
      }
      throw err;
    }
  });

  app.get<{ Params: { code: string } }>('/stats/:code', async (request, reply) => {
    try {
      const link = getStats(linkRepo, request.params.code);
      return reply.code(200).send(link);
    } catch (err) {
      if (err instanceof LinkNotFoundError) {
        return reply.code(404).send({ error: err.message });
      }
      throw err;
    }
  });

  app.get<{ Params: { code: string } }>('/:code', async (request, reply) => {
    try {
      const link = resolveLink(linkRepo, request.params.code);
      return reply.code(302).redirect(link.url);
    } catch (err) {
      if (err instanceof LinkNotFoundError) {
        return reply.code(404).send({ error: err.message });
      }
      throw err;
    }
  });

  return app;
}
