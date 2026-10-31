import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { DEFAULT_MODEL, extractWithLlm } from './llm';

// Optional .env (git-ignored). Missing file is fine: the app then runs in demo-only mode.
try {
  process.loadEnvFile('.env');
} catch {
  /* no .env file */
}

const apiKey = process.env.ANTHROPIC_API_KEY?.trim() || undefined;
const model = process.env.DOCULENS_MODEL?.trim() || DEFAULT_MODEL;
const port = Number(process.env.PORT) || 8787;
const host = process.env.HOST?.trim() || '127.0.0.1';
const allowedHosts = process.env.DOCULENS_ALLOWED_HOSTS?.split(',')
  .map((h) => h.trim())
  .filter(Boolean);

const app = createApp({
  apiKey,
  model,
  allowedHosts,
  rateLimit: { max: 20, windowMs: 60_000 },
  staticDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist'),
  extract: (text) => extractWithLlm(text, { apiKey: apiKey as string, model }),
});

app.listen(port, host, () => {
  console.log(`DocuLens API listening on http://${host}:${port}`);
  console.log(
    apiKey
      ? `AI mode: API key is configured (model "${model}"). Not verified until a real call succeeds.`
      : 'AI mode: no API key configured. Demo mode only.',
  );
});
