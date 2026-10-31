import { describe, expect, it } from 'vitest';
import { demoExtract } from '../shared/demoExtractor';
import { checkInputText } from '../shared/inputGuard';
import { getSample } from '../shared/samples';
import { validateInvoice } from '../shared/schema';
import { MAX_DRAFT_ROWS, candidateFromDraft, draftFromCandidate, emptyDraft } from '../src/lib/draft';
import { buildExport, exportFileName } from '../src/lib/exportJson';

describe('draftFromCandidate — malformed extraction results', () => {
  it.each([null, undefined, 'text', 5, [], true])('returns an empty draft for %j without throwing', (input) => {
    expect(draftFromCandidate(input)).toEqual(emptyDraft());
  });

  it('blanks out wrong-typed fields instead of rendering "[object Object]"', () => {
    const d = draftFromCandidate({ invoiceNumber: { a: 1 }, vendor: 'Acme', total: Number.NaN, currency: ['USD'], lineItems: 'nope' });
    expect(d.invoiceNumber).toBe('');
    expect(d.vendorName).toBe('');
    expect(d.total).toBe('');
    expect(d.currency).toBe('');
    expect(d.lineItems).toEqual([]);
  });

  it('turns garbage line items into blank rows with unique ids', () => {
    const d = draftFromCandidate({ lineItems: [null, 5, { description: { x: 1 } }] });
    expect(d.lineItems).toHaveLength(3);
    expect(new Set(d.lineItems.map((l) => l.id)).size).toBe(3);
    expect(d.lineItems.every((l) => l.description === '' && l.amount === '')).toBe(true);
  });

  it('caps the number of rows loaded into the UI', () => {
    const d = draftFromCandidate({ lineItems: Array.from({ length: 5000 }, () => ({ description: 'x' })) });
    expect(d.lineItems).toHaveLength(MAX_DRAFT_ROWS);
  });
});

describe('draft ⇄ candidate conversion', () => {
  it('round-trips a demo extraction into data that validates', () => {
    const original = demoExtract(getSample('clean').text);
    const result = validateInvoice(candidateFromDraft(draftFromCandidate(original)));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.total).toBe(original.total);
      expect(result.data.lineItems).toHaveLength(4);
    }
  });

  it('parses user-typed numbers with separators and currency symbols', () => {
    const d = { ...draftFromCandidate(demoExtract(getSample('clean').text)), total: '$1,666.51' };
    const c = candidateFromDraft(d) as { total: number };
    expect(c.total).toBe(1666.51);
  });

  it('keeps non-numeric input as a string so validation rejects it', () => {
    const d = { ...draftFromCandidate(demoExtract(getSample('clean').text)), total: '12abc' };
    const r = validateInvoice(candidateFromDraft(d));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.issues.map((i) => i.path)).toContain('total');
  });

  it('maps empty optional fields to null and empty required fields to missing', () => {
    const base = draftFromCandidate(demoExtract(getSample('clean').text));
    const c = candidateFromDraft({ ...base, dueDate: '', subtotal: '', tax: '  ', total: '' }) as Record<string, unknown>;
    expect(c.dueDate).toBeNull();
    expect(c.subtotal).toBeNull();
    expect(c.tax).toBeNull();
    expect(c.total).toBeUndefined();
    expect(validateInvoice(c).success).toBe(false);
  });

  it('normalises the currency code to upper case', () => {
    const base = draftFromCandidate(demoExtract(getSample('clean').text));
    expect((candidateFromDraft({ ...base, currency: ' usd ' }) as { currency: string }).currency).toBe('USD');
  });

  it('a manual correction fixes an invalid extraction', () => {
    const draft = draftFromCandidate(demoExtract(getSample('problems').text));
    expect(validateInvoice(candidateFromDraft(draft)).success).toBe(false);
    const fixed = { ...draft, invoiceDate: '2025-02-28' };
    const r = validateInvoice(candidateFromDraft(fixed));
    expect(r.success).toBe(true);
    if (r.success) expect(r.warnings.length).toBe(3); // valid, but the arithmetic is flagged
  });
});

describe('export', () => {
  const validated = () => {
    const r = validateInvoice(demoExtract(getSample('clean').text));
    if (!r.success) throw new Error('fixture invalid');
    return r;
  };

  it('wraps only validated data with metadata', () => {
    const r = validated();
    const out = buildExport(r.data, { mode: 'demo', warnings: [{ path: 'total', message: 'warn me' }] }, new Date('2025-01-02T03:04:05Z'));
    expect(out).toEqual({
      schemaVersion: 1,
      exportedAt: '2025-01-02T03:04:05.000Z',
      extractionMode: 'demo-rule-based',
      warnings: ['warn me'],
      data: r.data,
    });
    expect(buildExport(r.data, { mode: 'ai', warnings: [] }).extractionMode).toBe('ai-assisted');
  });

  it('produces JSON that round-trips through the schema', () => {
    const out = JSON.parse(JSON.stringify(buildExport(validated().data, { mode: 'demo', warnings: [] })));
    expect(validateInvoice(out.data).success).toBe(true);
  });

  it('builds a safe file name from the invoice number', () => {
    const r = validated();
    expect(exportFileName({ ...r.data, invoiceNumber: '../../etc/passwd' })).toBe('doculens-.._.._etc_passwd.json');
    expect(exportFileName({ ...r.data, invoiceNumber: 'INV 2025/01' })).toBe('doculens-INV_2025_01.json');
    expect(exportFileName(r.data)).toMatch(/^doculens-[A-Za-z0-9._-]+\.json$/);
  });
});

describe('checkInputText (input limits)', () => {
  it('accepts normal text', () => {
    expect(checkInputText(getSample('clean').text)).toEqual({ ok: true });
  });

  it('accepts text exactly at the limit and rejects one character over', () => {
    expect(checkInputText('a'.repeat(20_000)).ok).toBe(true);
    const over = checkInputText('a'.repeat(20_001));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.reason).toMatch(/limit is 20,000/);
  });

  it.each([
    ['empty', '', /empty/i],
    ['whitespace only', '  \n\t ', /empty/i],
    ['a PDF header', '%PDF-1.7\n%âãÏÓ', /PDF/],
    ['NUL bytes (binary)', 'abc\u0000def', /binary/i],
    ['undecodable content', '�'.repeat(50) + 'abc', /plain text/i],
  ])('rejects %s', (_name, input, message) => {
    const r = checkInputText(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(message);
  });
});
