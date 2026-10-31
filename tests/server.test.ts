import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp, type AppOptions } from '../server/app';
import { LlmError } from '../server/llm';

const KEY = 'fixture-server-api-key';

const goodCandidate = {
  invoiceNumber: 'INV-1',
  invoiceDate: '2025-03-14',
  dueDate: null,
  vendor: { name: 'Acme Test Co' },
  currency: 'USD',
  lineItems: [{ description: 'Widget', quantity: 1, unitPrice: 10, amount: 10 }],
  subtotal: null,
  tax: null,
  total: 10,
};

const make = (overrides: Partial<AppOptions> = {}) =>
  createApp({ apiKey: KEY, model: 'test-model', extract: async () => goodCandidate, ...overrides });

describe('GET /api/health', () => {
  it('reports configuration as a boolean and never exposes the key', async () => {
    const res = await request(make()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ llmConfigured: true, model: 'test-model' });
    expect(res.text).not.toContain(KEY);
  });

  it('reports unconfigured when there is no key', async () => {
    const res = await request(make({ apiKey: undefined })).get('/api/health');
    expect(res.body).toEqual({ llmConfigured: false, model: null });
  });

  it('sets safe headers and no CORS headers', async () => {
    const res = await request(make()).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['cache-control']).toBe('no-store');
  });
});

describe('POST /api/extract — valid requests', () => {
  it('returns the candidate with no issues when it passes the schema', async () => {
    const res = await request(make()).post('/api/extract').send({ text: 'Invoice Number: INV-1' });
    expect(res.status).toBe(200);
    expect(res.body.candidate).toEqual(goodCandidate);
    expect(res.body.issues).toEqual([]);
    expect(res.text).not.toContain(KEY);
  });

  it('passes only the text to the extractor', async () => {
    const extract = vi.fn(async () => goodCandidate);
    await request(make({ extract })).post('/api/extract').send({ text: 'hello', other: 'ignored' });
    expect(extract).toHaveBeenCalledWith('hello');
  });
});

describe('POST /api/extract — malformed extraction results', () => {
  it.each([
    ['wrong shape', { vendor: 'Acme', total: 'ten' }],
    ['an array', [1, 2, 3]],
    ['a string', 'not an object'],
    ['null', null],
  ])('still responds 200 but reports validation issues for %s', async (_name, candidate) => {
    const res = await request(make({ extract: async () => candidate })).post('/api/extract').send({ text: 'doc' });
    expect(res.status).toBe(200);
    expect(res.body.issues.length).toBeGreaterThan(0);
    expect(res.body.candidate).toEqual(candidate);
  });
});

describe('POST /api/extract — invalid requests', () => {
  it.each([
    ['missing text', {}],
    ['empty text', { text: '' }],
    ['non-string text', { text: 123 }],
    ['text over the character limit', { text: 'a'.repeat(20_001) }],
  ])('rejects %s with 400 and never calls the extractor', async (_name, body) => {
    const extract = vi.fn(async () => goodCandidate);
    const res = await request(make({ extract })).post('/api/extract').send(body);
    expect(res.status).toBe(400);
    expect(extract).not.toHaveBeenCalled();
    expect(res.text).not.toContain('aaaaaaaaaa'); // submitted content is never echoed back
  });

  it('rejects an oversized body with 413', async () => {
    const res = await request(make()).post('/api/extract').send({ text: 'a'.repeat(300 * 1024) });
    expect(res.status).toBe(413);
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await request(make()).post('/api/extract').set('Content-Type', 'application/json').send('{"text": ');
    expect(res.status).toBe(400);
  });

  it('rejects a non-JSON content type', async () => {
    const res = await request(make()).post('/api/extract').set('Content-Type', 'text/plain').send('Invoice Number: 1');
    expect(res.status).toBe(400);
  });

  it('returns 503 with a helpful message when no key is configured', async () => {
    const res = await request(make({ apiKey: undefined })).post('/api/extract').send({ text: 'doc' });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/demo mode/i);
  });

  it('returns a JSON 404 for unknown API routes', async () => {
    const res = await request(make()).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found.' });
  });
});

describe('POST /api/extract — upstream failures', () => {
  it.each([
    ['timeout', new LlmError('timeout', 'The model request timed out.'), 504],
    ['upstream', new LlmError('upstream', 'The model provider returned HTTP 500.'), 502],
    ['unparseable', new LlmError('unparseable', 'The model response was not valid JSON.'), 502],
  ])('maps %s to %i', async (_name, error, status) => {
    const res = await request(make({ extract: async () => { throw error; } })).post('/api/extract').send({ text: 'doc' });
    expect(res.status).toBe(status);
    expect(res.body.error).toBe(error.message);
  });

  it('hides unexpected error details behind a generic 500', async () => {
    const res = await request(make({ extract: async () => { throw new Error(`boom ${KEY}`); } })).post('/api/extract').send({ text: 'doc' });
    expect(res.status).toBe(500);
    expect(res.text).not.toContain('boom');
    expect(res.text).not.toContain(KEY);
  });
});

describe('access controls', () => {
  it('rejects unexpected Host headers (DNS-rebinding guard)', async () => {
    const res = await request(make()).get('/api/health').set('Host', 'evil.example');
    expect(res.status).toBe(403);
  });

  it('allows additional hosts when configured', async () => {
    const res = await request(make({ allowedHosts: ['doculens.internal'] })).get('/api/health').set('Host', 'doculens.internal:8787');
    expect(res.status).toBe(200);
  });

  it('rate-limits extraction requests', async () => {
    const app = make({ rateLimit: { max: 2, windowMs: 60_000 } });
    const send = () => request(app).post('/api/extract').send({ text: 'doc' });
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const third = await send();
    expect(third.status).toBe(429);
    expect(third.headers['retry-after']).toBeDefined();
  });
});

describe('static hosting', () => {
  it('serves the built client with a strict CSP only when a build exists', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doculens-static-'));
    try {
      fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>x</title>');
      const res = await request(make({ staticDir: dir })).get('/');
      expect(res.status).toBe(200);
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");

      const none = await request(make({ staticDir: path.join(dir, 'missing') })).get('/');
      expect(none.status).toBe(404);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
