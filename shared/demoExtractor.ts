import { LIMITS } from './limits';

/**
 * Deterministic, rule-based extractor used by "Demo mode".
 *
 * This is NOT AI. It is a set of regular expressions tuned for the synthetic sample
 * documents and for invoices that use common labels ("Invoice Number:", "Due Date:",
 * "Subtotal", "Total"). It never guesses: anything it cannot find is returned as `null`
 * and the Zod schema then reports it as missing. Its output is only a *candidate*.
 */

export interface DemoCandidate {
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  vendor: { name: string | null };
  currency: string | null;
  lineItems: { description: string; quantity: number; unitPrice: number; amount: number }[];
  subtotal: number | null;
  tax: number | null;
  total: number | null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const iso = (y: number, m: number, d: number) =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * Parses ISO (2025-03-14), month names (March 14, 2025 / 14 March 2025) and numeric
 * slash dates (03/14/2025). Slash dates are read as MM/DD/YYYY unless the first number
 * is > 12, in which case they are read as DD/MM/YYYY. Returns null if nothing matches.
 * Calendar validity (e.g. Feb 30) is deliberately NOT checked here — the schema does that.
 */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);

  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(s);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    return a > 12 && b <= 12 ? iso(+m[3], b, a) : iso(+m[3], a, b);
  }

  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/.exec(s);
  if (m) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    return mi >= 0 ? iso(+m[3], mi + 1, +m[2]) : null;
  }

  m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/.exec(s);
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    return mi >= 0 ? iso(+m[3], mi + 1, +m[1]) : null;
  }

  return null;
}

/** Parses "$1,234.56", "1,234.56 EUR", "42". Comma = thousands separator (US style). */
export function parseMoney(raw: string): number | null {
  // Strip currency markers, then require a single clean number: whitespace *inside* the number
  // ("12 34") must not be silently glued together into 1234.
  const t = raw
    .replace(/\b(?:USD|EUR|GBP|CAD|AUD|CHF|JPY|NZD)\b/gi, '')
    .replace(/[$€£]/g, '')
    .trim();
  if (!/^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(t)) return null;
  const n = Number(t.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Returns the value for every line matching `re` (capture group 1); falls back to the next non-empty line. */
function collect(lines: string[], re: RegExp): string[] {
  const out: string[] = [];
  lines.forEach((line, i) => {
    const m = re.exec(line);
    if (!m) return;
    let value = (m[1] ?? '').trim();
    if (!value) {
      const next = lines.slice(i + 1).find((l) => l.trim() !== '');
      value = next?.trim() ?? '';
    }
    if (value) out.push(value);
  });
  return out;
}

const RE = {
  invoiceNumber: /^\s*invoice\s*(?:number|no\b\.?|num\b\.?|#|(?=:))\s*[:#.\-]?\s*(.*)$/i,
  invoiceDate: /^\s*(?:invoice\s*date|date\s*issued|issue\s*date|issued(?:\s*on)?|date)\b\s*[:\-]?\s*(.*)$/i,
  dueDate: /^\s*(?:due\s*date|payment\s*due(?:\s*date)?|due)\b\s*[:\-]?\s*(.*)$/i,
  vendor:
    /^\s*(?:vendor(?:\s*name)?|supplier|seller|from|bill(?:ed)?\s*from|remit(?:tance)?\s*to|issued\s*by)\b\s*[:\-]?\s*(.*)$/i,
  subtotal: /^\s*sub\s*-?\s*total\b\s*[:\-]?\s*(.*)$/i,
  tax: /^\s*(?:sales\s+tax|tax|vat|gst)\b(?:\s*\([^)]*\))?(?:\s*[\d.]+\s*%)?\s*[:\-]?\s*(.*)$/i,
  grandTotal: /^\s*(?:grand\s*total|total\s*due|amount\s*due|balance\s*due)\b\s*[:\-]?\s*(.*)$/i,
  total: /^\s*total\b\s*[:\-]?\s*(.*)$/i,
};

/** Last parseable amount on a line matching `re` (summaries sit at the bottom of invoices). */
function lastMoney(lines: string[], re: RegExp): number | null {
  const values = collect(lines, re)
    .map(parseMoney)
    .filter((n): n is number => n !== null);
  return values.length ? values[values.length - 1] : null;
}

function firstDate(lines: string[], re: RegExp): string | null {
  const raws = collect(lines, re);
  for (const raw of raws) {
    const parsed = parseDate(raw);
    if (parsed) return parsed;
  }
  // Label found but unparseable: surface the raw text so validation can flag it visibly.
  return raws[0] ?? null;
}

function detectCurrency(text: string): string | null {
  const explicit = /^\s*currency\s*[:\-]?\s*([A-Za-z]{3})\b/im.exec(text);
  if (explicit) return explicit[1].toUpperCase();

  const codes = new Set(text.match(/\b(?:USD|EUR|GBP|CAD|AUD|CHF|JPY|NZD)\b/g) ?? []);
  if (codes.size === 1) return [...codes][0];
  if (codes.size > 1) return null;

  const symbols = new Set<string>();
  if (text.includes('€')) symbols.add('EUR');
  if (text.includes('£')) symbols.add('GBP');
  if (text.includes('$')) symbols.add('USD'); // "$" is ambiguous (CAD, AUD…); USD is assumed.
  return symbols.size === 1 ? [...symbols][0] : null;
}

const ROW = /^(.+?)\s+(\d+(?:\.\d+)?)\s+[$€£]?\s?(\d[\d,]*\.\d{2,4})\s+[$€£]?\s?(\d[\d,]*\.\d{2})$/;

function parseRow(line: string): DemoCandidate['lineItems'][number] | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  if (trimmed.includes('|') || trimmed.includes('\t')) {
    const cells = trimmed
      .split(/\||\t/)
      .map((c) => c.trim())
      .filter((c, i, all) => !(c === '' && (i === 0 || i === all.length - 1)));
    if (cells.length < 4) return null;
    const [quantity, unitPrice, amount] = cells.slice(-3).map(parseMoney);
    const description = cells.slice(0, -3).join(' ').trim();
    if (!description || quantity === null || unitPrice === null || amount === null) return null;
    return { description, quantity, unitPrice, amount };
  }

  const m = ROW.exec(trimmed);
  if (!m) return null;
  const unitPrice = parseMoney(m[3]);
  const amount = parseMoney(m[4]);
  if (unitPrice === null || amount === null) return null;
  return { description: m[1].trim(), quantity: Number(m[2]), unitPrice, amount };
}

function extractLineItems(lines: string[]): DemoCandidate['lineItems'] {
  const headerIdx = lines.findIndex((l) => /\bdescription\b/i.test(l) && /\b(?:qty|quantity)\b/i.test(l));
  const start = headerIdx >= 0 ? headerIdx + 1 : 0;

  const totalsRes = [RE.subtotal, RE.tax, RE.grandTotal, RE.total];
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const isTotals = totalsRes.some((re) => {
      const m = re.exec(line);
      return m !== null && parseMoney(m[1] ?? '') !== null;
    });
    if (isTotals) {
      end = i;
      break;
    }
  }

  const items: DemoCandidate['lineItems'] = [];
  for (const line of lines.slice(start, end)) {
    const row = parseRow(line);
    if (row) items.push(row);
    if (items.length >= LIMITS.maxLineItems * 5) break; // hard stop; the schema reports > maxLineItems
  }
  return items;
}

export function demoExtract(text: string): DemoCandidate {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  const grand = lastMoney(lines, RE.grandTotal);

  return {
    invoiceNumber: collect(lines, RE.invoiceNumber)[0] ?? null,
    invoiceDate: firstDate(lines, RE.invoiceDate),
    dueDate: firstDate(lines, RE.dueDate),
    vendor: { name: collect(lines, RE.vendor)[0] ?? null },
    currency: detectCurrency(text),
    lineItems: extractLineItems(lines),
    subtotal: lastMoney(lines, RE.subtotal),
    tax: lastMoney(lines, RE.tax),
    total: grand ?? lastMoney(lines, RE.total),
  };
}
