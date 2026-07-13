import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/api.js';
import { createFakeLinkRepo } from '../helpers/fake-link-repo.js';

function buildTestApp(): FastifyInstance {
  return buildApp({
    linkRepo: createFakeLinkRepo(),
    publicBaseUrl: 'http://localhost:8080',
    randomInt: () => 0
  });
}

describe('GET /health', () => {
  it('returns 200 ok', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});

describe('POST /links', () => {
  it('creates a short link and returns code + shortUrl', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/links', payload: { url: 'https://example.com' } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ code: '000000', shortUrl: 'http://localhost:8080/000000' });
  });

  it('rejects an invalid URL with 400', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/links', payload: { url: 'not-a-url' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toHaveProperty('error');
  });

  it('rejects a missing url field with 400', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/links', payload: {} });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /:code', () => {
  it('redirects to the original URL with 302', async () => {
    const app = buildTestApp();
    await app.inject({ method: 'POST', url: '/links', payload: { url: 'https://example.com' } });
    const res = await app.inject({ method: 'GET', url: '/000000' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://example.com');
  });

  it('returns 404 for an unknown code', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/ZZZZZZ' });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /stats/:code', () => {
  it('reports zero redirects right after creation', async () => {
    const app = buildTestApp();
    await app.inject({ method: 'POST', url: '/links', payload: { url: 'https://example.com' } });
    const res = await app.inject({ method: 'GET', url: '/stats/000000' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ code: '000000', url: 'https://example.com', redirects: 0 });
  });

  it('counts redirects after visits', async () => {
    const app = buildTestApp();
    await app.inject({ method: 'POST', url: '/links', payload: { url: 'https://example.com' } });
    await app.inject({ method: 'GET', url: '/000000' });
    await app.inject({ method: 'GET', url: '/000000' });
    const res = await app.inject({ method: 'GET', url: '/stats/000000' });
    expect(res.json()).toMatchObject({ redirects: 2 });
  });

  it('returns 404 for an unknown code', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/stats/ZZZZZZ' });
    expect(res.statusCode).toBe(404);
  });
});
