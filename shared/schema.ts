import { z, type ZodError } from 'zod';
import { LIMITS } from './limits';

/**
 * The single source of truth for what a valid extraction looks like.
 * Everything that reaches the export button — demo extractor output, LLM output,
 * and manual edits — must pass through `validateInvoice`.
 */

const isRealDate = (value: string): boolean => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
};

export const IsoDateSchema = z
  .string()
  .refine(isRealDate, 'Must be a real calendar date in YYYY-MM-DD format (1900–2100)');

const hasAtMostDecimals = (n: number, decimals: number): boolean => {
  const factor = 10 ** decimals;
  return Math.abs(Math.round(n * factor) - n * factor) < 1e-6;
};

const money = (decimals: number) =>
  z
    .number()
    .min(0, 'Cannot be negative (credit notes are not supported)')
    .max(1_000_000_000, 'Unreasonably large')
    .refine((n) => hasAtMostDecimals(n, decimals), `At most ${decimals} decimal places`);

export const LineItemSchema = z.object({
  description: z.string().trim().min(1, 'Required').max(300, 'At most 300 characters'),
  quantity: z.number().positive('Must be greater than 0').max(1_000_000, 'Unreasonably large'),
  unitPrice: money(4),
  amount: money(2),
});

export const InvoiceSchema = z
  .object({
    invoiceNumber: z.string().trim().min(1, 'Required').max(64, 'At most 64 characters'),
    invoiceDate: IsoDateSchema,
    dueDate: IsoDateSchema.nullable(),
    vendor: z.object({
      name: z.string().trim().min(1, 'Required').max(200, 'At most 200 characters'),
    }),
    currency: z.string().regex(/^[A-Z]{3}$/, 'Must be a 3-letter ISO 4217 code, e.g. USD'),
    lineItems: z
      .array(LineItemSchema)
      .min(1, 'At least one line item is required')
      .max(LIMITS.maxLineItems, `At most ${LIMITS.maxLineItems} line items`),
    subtotal: money(2).nullable(),
    tax: money(2).nullable(),
    total: money(2),
  })
  .superRefine((invoice, ctx) => {
    if (invoice.dueDate !== null && invoice.dueDate < invoice.invoiceDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['dueDate'],
        message: 'Due date cannot be before the invoice date',
      });
    }
  });

export type LineItem = z.infer<typeof LineItemSchema>;
export type Invoice = z.infer<typeof InvoiceSchema>;

export const IssueSchema = z.object({ path: z.string(), message: z.string() });
/** A flattened problem: `path` is dotted, e.g. `lineItems.2.amount` ('' for the root). */
export type Issue = z.infer<typeof IssueSchema>;

export type ValidationResult =
  | { success: true; data: Invoice; warnings: Issue[] }
  | { success: false; issues: Issue[] };

type ZIssue = ZodError['issues'][number];

function toIssue(issue: ZIssue): Issue {
  const message =
    issue.code === 'invalid_type'
      ? `A valid ${issue.expected} is required`
      : issue.message;
  return { path: issue.path.map(String).join('.'), message };
}

const cents = (n: number) => Math.round(n * 100);
const fmt = (n: number) => n.toFixed(2);

/**
 * Arithmetic cross-checks. These are warnings, not schema errors: real invoices can have
 * discounts, shipping or rounding that a simple rule cannot know about. They exist so a
 * confidently wrong extraction (or a typo) is surfaced rather than silently exported.
 */
export function checkConsistency(invoice: Invoice): Issue[] {
  const warnings: Issue[] = [];

  invoice.lineItems.forEach((item, i) => {
    const expected = item.quantity * item.unitPrice;
    if (Math.abs(cents(expected) - cents(item.amount)) > 1) {
      warnings.push({
        path: `lineItems.${i}.amount`,
        message: `Line ${i + 1}: amount ${fmt(item.amount)} differs from quantity × unit price (${fmt(expected)})`,
      });
    }
  });

  const itemsSum = invoice.lineItems.reduce((sum, item) => sum + item.amount, 0);
  if (invoice.subtotal !== null && Math.abs(cents(itemsSum) - cents(invoice.subtotal)) > 1) {
    warnings.push({
      path: 'subtotal',
      message: `Subtotal ${fmt(invoice.subtotal)} differs from the sum of line items (${fmt(itemsSum)})`,
    });
  }

  const base = invoice.subtotal ?? itemsSum;
  const expectedTotal = base + (invoice.tax ?? 0);
  if (Math.abs(cents(expectedTotal) - cents(invoice.total)) > 1) {
    warnings.push({
      path: 'total',
      message: `Total ${fmt(invoice.total)} differs from ${invoice.subtotal !== null ? 'subtotal' : 'line items'} + tax (${fmt(expectedTotal)})`,
    });
  }

  return warnings;
}

/** Validate anything — never throws, never trusts the input's shape. */
export function validateInvoice(candidate: unknown): ValidationResult {
  const result = InvoiceSchema.safeParse(candidate);
  if (!result.success) {
    return { success: false, issues: result.error.issues.map(toIssue) };
  }
  return { success: true, data: result.data, warnings: checkConsistency(result.data) };
}
