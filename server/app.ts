import express, { type ErrorRequestHandler, type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { ExtractRequestSchema, type ExtractResponse, type Health } from '../shared/api';
import { LIMITS } from '../shared/limits';
import { validateInvoice } from '../shared/schema';
import { LlmError } from './llm';

export interface AppOptions {
  /** Presence is reported as a boolean only. The value is never sent to clients or logged. */
  apiKey?: string;
  model: string;
  extract: (text: string) => Promise<unknown>;
  /** Accepted Host header names (DNS-rebinding guard). Defaults to loopback names. */
  allowedHosts?: string[];
  rateLimit?: { max: number; windowMs: number };
  /** Directory with the built client. Served only if it contains index.html. */
  staticDir?: string;
}

const DEFAULT_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

function hostnameOf(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  const h = hostHeader.toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end > 0 ? h.slice(0, end + 1) : null;
  }
  return h.split(':')[0] ?? null;
}

export function createApp(opts: AppOptions) {
  const app = express();
  app.disable('x-powered-by');

  const hosts = new Set((opts.allowedHosts ?? DEFAULT_HOSTS).map((h) => h.toLowerCase()));

  app.use((req: Request, res: Response, next: NextFunction) => {
    const host = hostnameOf(req.headers.host);
    if (!host || !hosts.has(host)) {
      res.status(403).json({ error: 'Host not allowed.' });
      return;
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  const hits = new Map<string, { count: number; resetAt: number }>();
  const rateLimit = (req: Request, res: Response, next: NextFunction) => {
    if (!opts.rateLimit) return next();
    const { max, windowMs } = opts.rateLimit;
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (entry.count >= max) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
      return;
    }
    entry.count += 1;
    next();
  };

  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', express.json({ limit: LIMITS.maxRequestBytes }));

  app.get('/api/health', (_req, res) => {
    const body: Health = { llmConfigured: Boolean(opts.apiKey), model: opts.apiKey ? opts.model : null };
    res.json(body);
  });

  app.post('/api/extract', rateLimit, async (req, res) => {
    const parsed = ExtractRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      // Never echo the submitted text back, even in errors.
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
      return;
    }
    if (!opts.apiKey) {
      res.status(503).json({ error: 'AI extraction is not configured on this server. Use demo mode.' });
      return;
    }

    try {
      const candidate = await opts.extract(parsed.data.text);
      const validation = validateInvoice(candidate);
      const body: ExtractResponse = {
        candidate,
        issues: validation.success ? [] : validation.issues,
        model: opts.model,
      };
      res.json(body);
    } catch (err) {
      if (err instanceof LlmError) {
        const status = err.kind === 'timeout' ? 504 : 502;
        res.status(status).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: 'Extraction failed unexpectedly.' });
    }
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  if (opts.staticDir && fs.existsSync(path.join(opts.staticDir, 'index.html'))) {
    const dir = path.resolve(opts.staticDir);
    app.use((_req, res, next) => {
      res.setHeader('Content-Security-Policy', CSP);
      next();
    });
    app.use(express.static(dir));
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(dir, 'index.html'));
    });
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    const type = (err as { type?: string } | null)?.type;
    if (type === 'entity.too.large') {
      res.status(413).json({ error: `Request body exceeds the ${LIMITS.maxRequestBytes / 1024} KB limit.` });
    } else if (type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Request body is not valid JSON.' });
    } else {
      res.status(500).json({ error: 'Internal server error.' });
    }
  };
  app.use(onError);

  return app;
}
