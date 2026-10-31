import { z } from 'zod';
import { LIMITS } from './limits';
import { IssueSchema } from './schema';

/** Contract between the browser and the Express server. */

export const ExtractRequestSchema = z.object({
  text: z.string().min(1, 'text is required').max(LIMITS.maxChars, `text must be at most ${LIMITS.maxChars} characters`),
});

export const ExtractResponseSchema = z.object({
  /** The model's parsed JSON, exactly as returned — NOT trusted; the client re-validates. */
  candidate: z.unknown(),
  /** Server-side validation issues for `candidate` (empty when it passed the schema). */
  issues: z.array(IssueSchema),
  model: z.string(),
});
export type ExtractResponse = z.infer<typeof ExtractResponseSchema>;

export const HealthSchema = z.object({
  llmConfigured: z.boolean(),
  model: z.string().nullable(),
});
export type Health = z.infer<typeof HealthSchema>;
