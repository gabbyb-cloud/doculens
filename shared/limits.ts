/** Hard input limits, shared by the browser and the server so they cannot drift apart. */
export const LIMITS = {
  /** Maximum characters of document text accepted anywhere in the app. */
  maxChars: 20_000,
  /** Maximum size of an uploaded .txt file, checked before it is read. */
  maxFileBytes: 100 * 1024,
  /** Maximum number of line items in a valid invoice. */
  maxLineItems: 100,
  /** Maximum JSON request body accepted by the API (headroom over maxChars for escaping/UTF-8). */
  maxRequestBytes: 128 * 1024,
} as const;
