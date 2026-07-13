import { beforeEach, describe, expect, it, vi } from 'vitest';

const recordRequestMock = vi.fn();
const recordRedirectMock = vi.fn();
const recordErrorMock = vi.fn();

// api.ts must call into infrastructure/telemetry.js without depending on a
// real SDK/collector being available; we replace it with spies here to
// assert on the wiring without any network dependency.
vi.mock('../../src/infrastructure/telemetry.js', () => ({
  recordRequest: recordRequestMock,
  recordRedirect: recordRedirectMock,
  recordError: recordErrorMock
}));

const { buildApp } = await import('../../src/api.js');
const { ChaosRegistry } = await import('../../src/domain/chaos.js');
const { ChaosEffects } = await import('../../src/infrastructure/chaos-effects.js');
const { createFakeLinkRepo } = await import('../helpers/fake-link-repo.js');

beforeEach(() => {
  recordRequestMock.mockClear();
  recordRedirectMock.mockClear();
  recordErrorMock.mockClear();
});

describe('telemetry wiring in the API', () => {
  it('records a request metric using the route pattern (low cardinality) and status', async () => {
    const app = buildApp({
      linkRepo: createFakeLinkRepo(),
      publicBaseUrl: 'http://localhost:8080',
      randomInt: () => 0
    });
    await app.inject({ method: 'GET', url: '/health' });
    expect(recordRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ route: '/health', status: 200 })
    );
  });

  it('records a redirect metric with the resolved code on a successful GET /:code', async () => {
    const app = buildApp({
      linkRepo: createFakeLinkRepo(),
      publicBaseUrl: 'http://localhost:8080',
      randomInt: () => 0
    });
    await app.inject({ method: 'POST', url: '/links', payload: { url: 'https://example.com' } });
    await app.inject({ method: 'GET', url: '/000000' });
    expect(recordRedirectMock).toHaveBeenCalledWith('000000');
  });

  it('does not record a redirect metric for an unknown code', async () => {
    const app = buildApp({
      linkRepo: createFakeLinkRepo(),
      publicBaseUrl: 'http://localhost:8080',
      randomInt: () => 0
    });
    await app.inject({ method: 'GET', url: '/ZZZZZZ' });
    expect(recordRedirectMock).not.toHaveBeenCalled();
  });

  it('records an error metric with the scenario name when error-burst triggers a 500', async () => {
    const chaosRegistry = new ChaosRegistry();
    chaosRegistry.enable('error-burst');
    const chaosEffects = new ChaosEffects(chaosRegistry, { errorBurstProbability: 1, random: () => 0 });
    const app = buildApp({
      linkRepo: createFakeLinkRepo(),
      publicBaseUrl: 'http://localhost:8080',
      randomInt: () => 0,
      chaosRegistry,
      chaosEffects
    });
    await app.inject({ method: 'POST', url: '/links', payload: { url: 'https://example.com' } });
    expect(recordErrorMock).toHaveBeenCalledWith('error-burst');
  });

  it('records an error metric with the scenario name when connection-leak triggers a 503', async () => {
    const chaosRegistry = new ChaosRegistry();
    chaosRegistry.enable('connection-leak');
    const chaosEffects = new ChaosEffects(chaosRegistry, { poolSize: 0 });
    const app = buildApp({
      linkRepo: createFakeLinkRepo(),
      publicBaseUrl: 'http://localhost:8080',
      randomInt: () => 0,
      chaosRegistry,
      chaosEffects
    });
    await app.inject({ method: 'POST', url: '/links', payload: { url: 'https://example.com' } });
    expect(recordErrorMock).toHaveBeenCalledWith('connection-leak');
  });
});
