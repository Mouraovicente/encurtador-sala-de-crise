import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/api.js';
import { ChaosRegistry } from '../../src/domain/chaos.js';
import { ChaosEffects } from '../../src/infrastructure/chaos-effects.js';
import { createFakeLinkRepo } from '../helpers/fake-link-repo.js';

function buildTestApp(chaosOptions: ConstructorParameters<typeof ChaosEffects>[1] = {}) {
  const chaosRegistry = new ChaosRegistry();
  const chaosEffects = new ChaosEffects(chaosRegistry, {
    sleep: async () => {},
    ...chaosOptions
  });
  const app = buildApp({
    linkRepo: createFakeLinkRepo(),
    publicBaseUrl: 'http://localhost:8080',
    randomInt: () => 0,
    chaosRegistry,
    chaosEffects
  });
  return { app, chaosRegistry, chaosEffects };
}

describe('POST /chaos/:scenario', () => {
  it('enables a known scenario', async () => {
    const { app, chaosRegistry } = buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/chaos/latency-spike' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ scenario: 'latency-spike', active: true });
    expect(chaosRegistry.isActive('latency-spike')).toBe(true);
  });

  it('rejects an unknown scenario with 400', async () => {
    const { app } = buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/chaos/cpu-spike' });
    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /chaos', () => {
  it('resets every active scenario and releases pool + memory', async () => {
    const { app, chaosRegistry, chaosEffects } = buildTestApp({ poolSize: 1 });
    await app.inject({ method: 'POST', url: '/chaos/connection-leak' });
    await app.inject({ method: 'POST', url: '/chaos/memory-leak' });
    chaosEffects.tryAcquireConnection();
    chaosEffects.leakMemory();

    const res = await app.inject({ method: 'DELETE', url: '/chaos' });
    expect(res.statusCode).toBe(200);
    expect(chaosRegistry.activeScenarios()).toEqual([]);
    expect(chaosEffects.memoryUsageBytes).toBe(0);

    // Re-enable to prove the internal pool counter was really reset to zero,
    // not just masked by the scenario being disabled.
    chaosRegistry.enable('connection-leak');
    expect(chaosEffects.tryAcquireConnection()).toBe(true);
  });
});

describe('error-burst scenario', () => {
  it('forces every response to 500 when probability is 1.0', async () => {
    const { app } = buildTestApp({ errorBurstProbability: 1, random: () => 0.5 });
    await app.inject({ method: 'POST', url: '/chaos/error-burst' });

    const res = await app.inject({ method: 'POST', url: '/links', payload: { url: 'https://example.com' } });
    expect(res.statusCode).toBe(500);
  });

  it('does not affect responses when probability is 0', async () => {
    const { app } = buildTestApp({ errorBurstProbability: 0, random: () => 0.5 });
    await app.inject({ method: 'POST', url: '/chaos/error-burst' });

    const res = await app.inject({ method: 'POST', url: '/links', payload: { url: 'https://example.com' } });
    expect(res.statusCode).toBe(201);
  });
});

describe('connection-leak scenario', () => {
  it('returns 503 once the fake pool is exhausted', async () => {
    // pool size 3: creating the link leaks 1 connection, leaving room for
    // exactly 2 more redirects before the pool runs out.
    const { app } = buildTestApp({ poolSize: 3 });
    await app.inject({ method: 'POST', url: '/chaos/connection-leak' });
    await app.inject({ method: 'POST', url: '/links', payload: { url: 'https://example.com' } });

    const first = await app.inject({ method: 'GET', url: '/000000' });
    const second = await app.inject({ method: 'GET', url: '/000000' });
    expect(first.statusCode).toBe(302);
    expect(second.statusCode).toBe(302);

    const third = await app.inject({ method: 'GET', url: '/000000' });
    expect(third.statusCode).toBe(503);
  });
});

describe('memory-leak scenario', () => {
  it('grows the shared buffer on every business request', async () => {
    const { app, chaosEffects } = buildTestApp({ memoryChunkBytes: 1024 * 1024 });
    await app.inject({ method: 'POST', url: '/chaos/memory-leak' });
    await app.inject({ method: 'POST', url: '/links', payload: { url: 'https://example.com' } });
    expect(chaosEffects.memoryUsageBytes).toBe(1024 * 1024);
    await app.inject({ method: 'GET', url: '/000000' });
    expect(chaosEffects.memoryUsageBytes).toBe(2 * 1024 * 1024);
  });
});

describe('stats after chaos-affected redirects', () => {
  it('still counts successful redirects even while other scenarios are configured', async () => {
    const { app } = buildTestApp();
    await app.inject({ method: 'POST', url: '/links', payload: { url: 'https://example.com' } });
    await app.inject({ method: 'GET', url: '/000000' });
    await app.inject({ method: 'GET', url: '/000000' });
    const res = await app.inject({ method: 'GET', url: '/stats/000000' });
    expect(res.json()).toMatchObject({ redirects: 2 });
  });
});
