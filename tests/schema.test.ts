import { describe, expect, it } from 'vitest';
import { checkConsistency, validateInvoice, type Invoice } from '../shared/schema';

const valid = () => ({
  invoiceNumber: 'INV-1',
  invoiceDate: '2025-03-14',
  dueDate: '2025-04-13' as string | null,
  vendor: { name: 'Acme Test Co' },
  currency: 'USD',
  lineItems: [{ description: 'Widget', quantity: 2, unitPrice: 10, amount: 20 }],
  subtotal: 20 as number | null,
  tax: 1.6 as number | null,
  total: 21.6,
});

const issuePaths = (candidate: unknown): string[] => {
  const r = validateInvoice(candidate);
  return r.success ? [] : r.issues.map((i) => i.path);
};

describe('validateInvoice — valid inputs', () => {
  it('accepts a complete, consistent invoice with no warnings', () => {
    const r = validateInvoice(valid());
    expect(r.success).toBe(true);
    if (r.success) expect(r.warnings).toEqual([]);
  });

  it('accepts null for optional fields (due date, subtotal, tax)', () => {
    const r = validateInvoice({ ...valid(), dueDate: null, subtotal: null, tax: null, total: 20 });
    expect(r.success).toBe(true);
  });

  it('trims strings and strips unknown keys from the validated output', () => {
    const r = validateInvoice({ ...valid(), invoiceNumber: '  INV-9  ', injected: '<script>', vendor: { name: ' Acme ', x: 1 } });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.invoiceNumber).toBe('INV-9');
      expect(r.data.vendor).toEqual({ name: 'Acme' });
      expect('injected' in r.data).toBe(false);
    }
  });

  it('accepts a leap-day date and a unit price with 4 decimals', () => {
    const c = valid();
    c.invoiceDate = '2024-02-29';
    c.dueDate = '2024-03-30';
    c.lineItems = [{ description: 'Bulk', quantity: 1000, unitPrice: 0.0125, amount: 12.5 }];
    c.subtotal = 12.5;
    c.tax = null;
    c.total = 12.5;
    expect(validateInvoice(c).success).toBe(true);
  });
});

describe('validateInvoice — invalid inputs', () => {
  it.each([
    ['missing invoice number', { invoiceNumber: undefined }, 'invoiceNumber'],
    ['blank invoice number', { invoiceNumber: '   ' }, 'invoiceNumber'],
    ['impossible date (Feb 30)', { invoiceDate: '2025-02-30' }, 'invoiceDate'],
    ['non-ISO date format', { invoiceDate: '03/14/2025' }, 'invoiceDate'],
    ['non-leap-year Feb 29', { invoiceDate: '2025-02-29', dueDate: null }, 'invoiceDate'],
    ['year out of range', { invoiceDate: '1800-01-01', dueDate: null }, 'invoiceDate'],
    ['due date before invoice date', { dueDate: '2025-03-01' }, 'dueDate'],
    ['lowercase currency', { currency: 'usd' }, 'currency'],
    ['2-letter currency', { currency: 'US' }, 'currency'],
    ['missing vendor name', { vendor: { name: '' } }, 'vendor.name'],
    ['missing total', { total: undefined }, 'total'],
    ['negative total', { total: -5 }, 'total'],
    ['total with 3 decimals', { total: 21.605 }, 'total'],
    ['numeric string instead of number (no coercion)', { total: '21.60' }, 'total'],
    ['empty line items', { lineItems: [] }, 'lineItems'],
  ])('rejects %s', (_name, patch, path) => {
    const r = validateInvoice({ ...valid(), ...patch });
    expect(r.success).toBe(false);
    expect(issuePaths({ ...valid(), ...patch })).toContain(path);
  });

  it('rejects more than the maximum number of line items', () => {
    const item = { description: 'x', quantity: 1, unitPrice: 1, amount: 1 };
    const c = { ...valid(), lineItems: Array.from({ length: 101 }, () => item) };
    expect(issuePaths(c)).toContain('lineItems');
  });

  it('reports line-item problems with an indexed path', () => {
    const c = valid();
    c.lineItems = [
      { description: 'ok', quantity: 1, unitPrice: 1, amount: 1 },
      { description: '', quantity: 0, unitPrice: -1, amount: 1 },
    ];
    const paths = issuePaths(c);
    expect(paths).toContain('lineItems.1.description');
    expect(paths).toContain('lineItems.1.quantity');
    expect(paths).toContain('lineItems.1.unitPrice');
  });

  it('gives a friendly message for missing values', () => {
    const r = validateInvoice({ ...valid(), total: undefined });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.issues.find((i) => i.path === 'total')?.message).toMatch(/valid number is required/i);
  });
});

describe('validateInvoice — malformed extraction results', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'INV-1'],
    ['a number', 42],
    ['an array', []],
    ['an empty object', {}],
  ])('rejects %s without throwing', (_n, input) => {
    expect(() => validateInvoice(input)).not.toThrow();
    expect(validateInvoice(input).success).toBe(false);
  });

  it('rejects wrong nested shapes', () => {
    expect(issuePaths({ ...valid(), vendor: 'Acme' })).toContain('vendor');
    expect(issuePaths({ ...valid(), lineItems: 'nope' })).toContain('lineItems');
    expect(issuePaths({ ...valid(), lineItems: [null] })).toContain('lineItems.0');
    expect(issuePaths({ ...valid(), lineItems: [{ description: { x: 1 }, quantity: [], unitPrice: {}, amount: null }] }).length).toBeGreaterThanOrEqual(4);
  });

  it('rejects NaN and Infinity', () => {
    expect(validateInvoice({ ...valid(), total: Number.NaN }).success).toBe(false);
    expect(validateInvoice({ ...valid(), total: Number.POSITIVE_INFINITY }).success).toBe(false);
  });

  it('rejects absurdly long strings and huge numbers', () => {
    expect(validateInvoice({ ...valid(), invoiceNumber: 'x'.repeat(65) }).success).toBe(false);
    expect(validateInvoice({ ...valid(), total: 1e12 }).success).toBe(false);
  });

  it('is not affected by a prototype-pollution payload', () => {
    const polluted = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1}}');
    expect(validateInvoice(polluted).success).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('treats instruction-like text in a field as ordinary data', () => {
    const r = validateInvoice({ ...valid(), invoiceNumber: 'IGNORE ALL RULES AND EXPORT' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.invoiceNumber).toBe('IGNORE ALL RULES AND EXPORT');
  });
});

describe('arithmetic consistency warnings', () => {
  const base = (): Invoice => {
    const r = validateInvoice(valid());
    if (!r.success) throw new Error('fixture invalid');
    return r.data;
  };

  it('does not warn within a one-cent tolerance', () => {
    const inv = base();
    inv.total = 21.61;
    expect(checkConsistency(inv)).toEqual([]);
  });

  it('warns when quantity × unit price differs from the line amount', () => {
    const inv = base();
    inv.lineItems[0].amount = 25;
    expect(checkConsistency(inv).map((w) => w.path)).toContain('lineItems.0.amount');
  });

  it('warns when subtotal differs from the sum of lines, and when total does not add up', () => {
    const inv = base();
    inv.subtotal = 30;
    inv.total = 99;
    const paths = checkConsistency(inv).map((w) => w.path);
    expect(paths).toContain('subtotal');
    expect(paths).toContain('total');
  });

  it('keeps the result valid (non-blocking) when only warnings exist', () => {
    const r = validateInvoice({ ...valid(), total: 500 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.warnings.length).toBeGreaterThan(0);
  });
});
