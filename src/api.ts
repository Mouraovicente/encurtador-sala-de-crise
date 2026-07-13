import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { createLink, resolveLink, getStats } from './application/links.js';
import { LinkNotFoundError } from './application/ports.js';
import type { LinkRepo } from './application/ports.js';
import { InvalidUrlError, CollisionError, type RandomIntFn } from './domain/shortener.js';
import { ChaosRegistry, isChaosScenario } from './domain/chaos.js';
import { ChaosEffects } from './infrastructure/chaos-effects.js';
import { recordError, recordRedirect, recordRequest } from './infrastructure/telemetry.js';

export interface BuildAppOptions {
  linkRepo: LinkRepo;
  /** Base URL used to build the shortUrl returned by POST /links (e.g. http://localhost:8080). */
  publicBaseUrl?: string;
  /** Injectable RNG, used by tests for deterministic codes. */
  randomInt?: RandomIntFn;
  /** Shared chaos state. A private ChaosRegistry is created if not provided. */
  chaosRegistry?: ChaosRegistry;
  /** Shared chaos side effects (pool, memory, latency, error burst). Created from chaosRegistry if not provided. */
  chaosEffects?: ChaosEffects;
}

interface CreateLinkBody {
  url?: string;
}

function baseUrlFor(request: { protocol: string; hostname: string }, configured?: string): string {
  return configured ?? `${request.protocol}://${request.hostname}`;
}

/**
 * Builds a preHandler that applies the observable chaos side effects
 * (connection-leak, memory-leak, latency-spike, error-burst) to a
 * "business" route (link creation, redirect, stats). Control-plane routes
 * (/health, /chaos/*) never go through this, so the crisis can always be
 * fixed via DELETE /chaos even while other scenarios are active.
 */
function createChaosPreHandler(effects: ChaosEffects, options: { applyLatency: boolean }) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!effects.tryAcquireConnection()) {
      recordError('connection-leak');
      return reply.code(503).send({ error: 'connection pool exhausted', scenario: 'connection-leak' });
    }

    effects.leakMemory();

    if (options.applyLatency) {
      await effects.applyLatency();
    }

    if (effects.shouldTriggerErrorBurst()) {
      recordError('error-burst');
      return reply.code(500).send({ error: 'internal error', scenario: 'error-burst' });
    }

    return undefined;
  };
}

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const { linkRepo, publicBaseUrl, randomInt } = options;
  const chaosRegistry = options.chaosRegistry ?? new ChaosRegistry();
  const chaosEffects = options.chaosEffects ?? new ChaosEffects(chaosRegistry);
  const app = Fastify({ logger: false });

  const businessPreHandler = createChaosPreHandler(chaosEffects, { applyLatency: false });
  const redirectPreHandler = createChaosPreHandler(chaosEffects, { applyLatency: true });

  // Route pattern (e.g. '/:code'), not the raw URL, keeps the metric's label
  // cardinality bounded regardless of how many distinct short codes exist.
  app.addHook('onResponse', async (request, reply) => {
    recordRequest({
      route: request.routeOptions.url ?? request.url,
      status: reply.statusCode,
      durationSeconds: reply.elapsedTime / 1000
    });
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.post<{ Body: CreateLinkBody }>('/links', { preHandler: businessPreHandler }, async (request, reply) => {
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

  app.get<{ Params: { code: string } }>(
    '/stats/:code',
    { preHandler: businessPreHandler },
    async (request, reply) => {
      try {
        const link = getStats(linkRepo, request.params.code);
        return reply.code(200).send(link);
      } catch (err) {
        if (err instanceof LinkNotFoundError) {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
    }
  );

  app.post<{ Params: { scenario: string } }>('/chaos/:scenario', async (request, reply) => {
    const { scenario } = request.params;
    if (!isChaosScenario(scenario)) {
      return reply.code(400).send({ error: `Unknown chaos scenario: ${scenario}` });
    }
    chaosRegistry.enable(scenario);
    return reply.code(200).send({ scenario, active: true });
  });

  app.delete('/chaos', async (_request, reply) => {
    chaosRegistry.reset();
    chaosEffects.reset();
    return reply.code(200).send({ active: chaosRegistry.activeScenarios() });
  });

  app.get<{ Params: { code: string } }>('/:code', { preHandler: redirectPreHandler }, async (request, reply) => {
    try {
      const link = resolveLink(linkRepo, request.params.code);
      recordRedirect(link.code);
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
