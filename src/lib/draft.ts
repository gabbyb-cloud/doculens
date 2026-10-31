/**
 * The editable form state ("draft") and its conversion to/from the validated shape.
 *
 * Why a separate string-based draft? Form inputs hold text, and a half-typed number like "12."
 * must not be lost or crash the UI. Every change is converted back into a candidate object
 * and re-validated with Zod, so the form can never produce exportable data that skipped validation.
 */

export interface DraftLineItem {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
}

export interface Draft {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  vendorName: string;
  currency: string;
  lineItems: DraftLineItem[];
  subtotal: string;
  tax: string;
  total: string;
}

/** Cap rows loaded into the UI so a malicious/buggy extraction cannot create thousands of inputs. */
export const MAX_DRAFT_ROWS = 200;

let counter = 0;
export const newLineItem = (): DraftLineItem => ({
  id: `li-${++counter}`,
  description: '',
  quantity: '1',
  unitPrice: '',
  amount: '',
});

export const emptyDraft = (): Draft => ({
  invoiceNumber: '',
  invoiceDate: '',
  dueDate: '',
  vendorName: '',
  currency: '',
  lineItems: [],
  subtotal: '',
  tax: '',
  total: '',
});

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Only strings and finite numbers are shown; anything else (objects, arrays, null) becomes blank. */
const asText = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
};

/** Builds a draft from ANY value (including garbage from a model). Never throws. */
export function draftFromCandidate(candidate: unknown): Draft {
  if (!isRecord(candidate)) return emptyDraft();

  const vendor = isRecord(candidate.vendor) ? candidate.vendor : {};
  const rawItems = Array.isArray(candidate.lineItems) ? candidate.lineItems.slice(0, MAX_DRAFT_ROWS) : [];

  return {
    invoiceNumber: asText(candidate.invoiceNumber),
    invoiceDate: asText(candidate.invoiceDate),
    dueDate: asText(candidate.dueDate),
    vendorName: asText(vendor.name),
    currency: asText(candidate.currency),
    subtotal: asText(candidate.subtotal),
    tax: asText(candidate.tax),
    total: asText(candidate.total),
    lineItems: rawItems.map((item) => {
      const r = isRecord(item) ? item : {};
      return {
        id: newLineItem().id,
        description: asText(r.description),
        quantity: asText(r.quantity),
        unitPrice: asText(r.unitPrice),
        amount: asText(r.amount),
      };
    }),
  };
}

/** "1,234.50" / "$12" -> number; anything else is returned as the raw string so Zod rejects it. */
function numberOrRaw(text: string): number | string {
  const t = text.trim().replace(/[,$€£\s]/g, '');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : text.trim();
}

const requiredNumber = (text: string): number | string | undefined =>
  text.trim() === '' ? undefined : numberOrRaw(text);
const optionalNumber = (text: string): number | string | null =>
  text.trim() === '' ? null : numberOrRaw(text);

/** Converts the draft into the object that gets validated. Does not validate itself. */
export function candidateFromDraft(draft: Draft): unknown {
  return {
    invoiceNumber: draft.invoiceNumber,
    invoiceDate: draft.invoiceDate.trim(),
    dueDate: draft.dueDate.trim() === '' ? null : draft.dueDate.trim(),
    vendor: { name: draft.vendorName },
    currency: draft.currency.trim().toUpperCase(),
    lineItems: draft.lineItems.map((li) => ({
      description: li.description,
      quantity: requiredNumber(li.quantity),
      unitPrice: requiredNumber(li.unitPrice),
      amount: requiredNumber(li.amount),
    })),
    subtotal: optionalNumber(draft.subtotal),
    tax: optionalNumber(draft.tax),
    total: requiredNumber(draft.total),
  };
}
