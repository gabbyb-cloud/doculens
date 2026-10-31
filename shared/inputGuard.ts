import { LIMITS } from './limits';

export type InputCheck = { ok: true } | { ok: false; reason: string };

const fmt = (n: number) => n.toLocaleString('en-US');

/**
 * Cheap, dependency-free checks that the input is plausibly plain text within limits.
 * This is a guard rail, not a file-type detector: it rejects the obvious wrong inputs
 * (empty, oversized, PDF/binary) with a clear message.
 */
export function checkInputText(text: string): InputCheck {
  if (text.trim().length === 0) {
    return { ok: false, reason: 'The document is empty.' };
  }
  if (text.length > LIMITS.maxChars) {
    return {
      ok: false,
      reason: `The document is ${fmt(text.length)} characters; the limit is ${fmt(LIMITS.maxChars)}.`,
    };
  }
  if (text.trimStart().startsWith('%PDF')) {
    return {
      ok: false,
      reason: 'This looks like a PDF. DocuLens supports plain text only; PDFs and scanned images are not supported.',
    };
  }
  if (text.includes('\u0000')) {
    return { ok: false, reason: 'This looks like a binary file, not plain text.' };
  }
  const replacementChars = (text.match(/�/g) ?? []).length;
  if (replacementChars / text.length > 0.02) {
    return { ok: false, reason: 'This file does not decode as plain text (too many invalid characters).' };
  }
  return { ok: true };
}
