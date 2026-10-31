import { z } from 'zod';
import { ExtractResponseSchema, HealthSchema, type ExtractResponse, type Health } from '../../shared/api';

/** Returns null when the server is unreachable — the app then simply offers demo mode only. */
export async function fetchHealth(signal?: AbortSignal): Promise<Health | null> {
  try {
    const res = await fetch('/api/health', { signal });
    if (!res.ok) return null;
    const parsed = HealthSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const ErrorBodySchema = z.object({ error: z.string() });

/** Sends the document to the local server for AI extraction. Throws Error with a user-safe message. */
export async function extractViaServer(text: string): Promise<ExtractResponse> {
  let res: Response;
  try {
    res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } catch {
    throw new Error('Could not reach the DocuLens server. Is it running?');
  }

  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const err = ErrorBodySchema.safeParse(body);
    throw new Error(err.success ? err.data.error : `The server returned HTTP ${res.status}.`);
  }

  const parsed = ExtractResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error('The server returned an unexpected response.');
  return parsed.data;
}
