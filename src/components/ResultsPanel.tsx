import { useMemo, type ReactNode } from 'react';
import { LIMITS } from '../../shared/limits';
import type { Issue, ValidationResult } from '../../shared/schema';
import { newLineItem, type Draft, type DraftLineItem } from '../lib/draft';

interface Props {
  draft: Draft | null;
  validation: ValidationResult | null;
  rawIssueCount: number;
  onChange: (draft: Draft) => void;
  onExport: () => void;
}

const FIELD_LABELS: Record<string, string> = {
  invoiceNumber: 'Invoice number',
  invoiceDate: 'Invoice date',
  dueDate: 'Due date',
  'vendor.name': 'Vendor',
  currency: 'Currency',
  subtotal: 'Subtotal',
  tax: 'Tax',
  total: 'Total',
  lineItems: 'Line items',
};
const LINE_LABELS: Record<string, string> = {
  description: 'Description',
  quantity: 'Quantity',
  unitPrice: 'Unit price',
  amount: 'Amount',
};

function labelForPath(path: string): string {
  const m = /^lineItems\.(\d+)\.(\w+)$/.exec(path);
  if (m) return `Line ${Number(m[1]) + 1} · ${LINE_LABELS[m[2]] ?? m[2]}`;
  return FIELD_LABELS[path] ?? (path || 'Document');
}

interface FieldProps {
  id: string;
  label: string;
  value: string;
  errors: string[];
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  inputMode?: 'text' | 'decimal';
}

function Field({ id, label, value, errors, onChange, placeholder, hint, inputMode = 'text' }: FieldProps) {
  const invalid = errors.length > 0;
  const describedBy = [invalid ? `${id}-err` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className={invalid ? 'input input-invalid' : 'input'}
        value={value}
        inputMode={inputMode}
        placeholder={placeholder}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && !invalid && (
        <span id={`${id}-hint`} className="field-hint">
          {hint}
        </span>
      )}
      {invalid && (
        <span id={`${id}-err`} className="field-error">
          {errors[0]}
        </span>
      )}
    </div>
  );
}

function StatusBadge({ draft, validation }: { draft: Draft | null; validation: ValidationResult | null }): ReactNode {
  let cls = 'badge badge-idle';
  let text = 'No extraction yet';
  if (draft && validation) {
    if (!validation.success) {
      cls = 'badge badge-error';
      text = `${validation.issues.length} issue${validation.issues.length === 1 ? '' : 's'} to fix`;
    } else if (validation.warnings.length > 0) {
      cls = 'badge badge-warn';
      text = `Valid · ${validation.warnings.length} warning${validation.warnings.length === 1 ? '' : 's'}`;
    } else {
      cls = 'badge badge-ok';
      text = 'Valid';
    }
  }
  return (
    <span className={cls} data-testid="validation-status" role="status">
      {text}
    </span>
  );
}

export function ResultsPanel({ draft, validation, rawIssueCount, onChange, onExport }: Props) {
  const issues: Issue[] = validation && !validation.success ? validation.issues : [];
  const warnings: Issue[] = validation && validation.success ? validation.warnings : [];

  const errorsFor = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const issue of issues) map.set(issue.path, [...(map.get(issue.path) ?? []), issue.message]);
    return (path: string) => map.get(path) ?? [];
  }, [issues]);

  const warnedPaths = useMemo(() => new Set(warnings.map((w) => w.path)), [warnings]);

  if (!draft) {
    return (
      <section className="panel" aria-labelledby="results-heading">
        <div className="panel-head">
          <h2 id="results-heading">Extracted data</h2>
          <StatusBadge draft={draft} validation={validation} />
        </div>
        <div className="empty">
          <p className="empty-title">Nothing extracted yet</p>
          <p>Add a document on the left, pick an extraction mode, and run the extraction. Results appear here as an editable form and are validated against the schema as you type.</p>
        </div>
      </section>
    );
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => onChange({ ...draft, [key]: value });
  const setItem = (index: number, patch: Partial<DraftLineItem>) =>
    set(
      'lineItems',
      draft.lineItems.map((li, i) => (i === index ? { ...li, ...patch } : li)),
    );
  const removeItem = (index: number) =>
    set(
      'lineItems',
      draft.lineItems.filter((_, i) => i !== index),
    );
  const addItem = () => set('lineItems', [...draft.lineItems, newLineItem()]);

  const itemCls = (index: number, field: string) => {
    const path = `lineItems.${index}.${field}`;
    if (errorsFor(path).length) return 'input input-invalid';
    if (warnedPaths.has(path)) return 'input input-warn';
    return 'input';
  };

  const valid = validation?.success === true;

  return (
    <section className="panel" aria-labelledby="results-heading">
      <div className="panel-head">
        <h2 id="results-heading">Extracted data</h2>
        <StatusBadge draft={draft} validation={validation} />
      </div>

      {rawIssueCount > 0 && (
        <p className="callout callout-warn">
          The model’s raw output failed schema validation in {rawIssueCount} place{rawIssueCount === 1 ? '' : 's'}. Review
          every field below against the source document before exporting.
        </p>
      )}

      {issues.length > 0 && (
        <div className="callout callout-error">
          <strong>Fix these before exporting</strong>
          <ul>
            {issues.map((issue, i) => (
              <li key={`${issue.path}-${i}`}>
                <span className="issue-path">{labelForPath(issue.path)}:</span> {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="callout callout-warn">
          <strong>Check these numbers</strong> (valid, but they do not add up)
          <ul>
            {warnings.map((w, i) => (
              <li key={`${w.path}-${i}`}>{w.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid-fields">
        <Field id="f-invoice-number" label="Invoice number" value={draft.invoiceNumber} errors={errorsFor('invoiceNumber')} onChange={(v) => set('invoiceNumber', v)} />
        <Field id="f-vendor" label="Vendor" value={draft.vendorName} errors={errorsFor('vendor.name')} onChange={(v) => set('vendorName', v)} />
        <Field id="f-invoice-date" label="Invoice date" value={draft.invoiceDate} errors={errorsFor('invoiceDate')} onChange={(v) => set('invoiceDate', v)} placeholder="YYYY-MM-DD" />
        <Field id="f-due-date" label="Due date (optional)" value={draft.dueDate} errors={errorsFor('dueDate')} onChange={(v) => set('dueDate', v)} placeholder="YYYY-MM-DD" />
        <Field id="f-currency" label="Currency" value={draft.currency} errors={errorsFor('currency')} onChange={(v) => set('currency', v)} placeholder="USD" />
      </div>

      <h3 className="subhead">Line items</h3>
      <div className="items" tabIndex={0} role="region" aria-label="Line items table (scrollable)">
        <table>
          <thead>
            <tr>
              <th scope="col" className="col-desc">Description</th>
              <th scope="col">Qty</th>
              <th scope="col">Unit price</th>
              <th scope="col">Amount</th>
              <th scope="col"><span className="visually-hidden">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {draft.lineItems.length === 0 && (
              <tr>
                <td colSpan={5} className="items-empty">No line items found.</td>
              </tr>
            )}
            {draft.lineItems.map((li, i) => (
              <tr key={li.id}>
                <td className="col-desc">
                  <input aria-label={`Line ${i + 1} description`} className={itemCls(i, 'description')} value={li.description} onChange={(e) => setItem(i, { description: e.target.value })} aria-invalid={errorsFor(`lineItems.${i}.description`).length > 0} />
                </td>
                <td>
                  <input aria-label={`Line ${i + 1} quantity`} className={itemCls(i, 'quantity')} inputMode="decimal" value={li.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} aria-invalid={errorsFor(`lineItems.${i}.quantity`).length > 0} />
                </td>
                <td>
                  <input aria-label={`Line ${i + 1} unit price`} className={itemCls(i, 'unitPrice')} inputMode="decimal" value={li.unitPrice} onChange={(e) => setItem(i, { unitPrice: e.target.value })} aria-invalid={errorsFor(`lineItems.${i}.unitPrice`).length > 0} />
                </td>
                <td>
                  <input aria-label={`Line ${i + 1} amount`} className={itemCls(i, 'amount')} inputMode="decimal" value={li.amount} onChange={(e) => setItem(i, { amount: e.target.value })} aria-invalid={errorsFor(`lineItems.${i}.amount`).length > 0} />
                </td>
                <td>
                  <button type="button" className="icon-btn" aria-label={`Remove line ${i + 1}`} onClick={() => removeItem(i)}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {errorsFor('lineItems').length > 0 && <p className="field-error">{errorsFor('lineItems')[0]}</p>}
      <button type="button" className="btn btn-secondary btn-small" onClick={addItem} disabled={draft.lineItems.length >= LIMITS.maxLineItems}>
        + Add line item
      </button>

      <h3 className="subhead">Totals</h3>
      <div className="grid-fields grid-totals">
        <Field id="f-subtotal" label="Subtotal (optional)" inputMode="decimal" value={draft.subtotal} errors={errorsFor('subtotal')} onChange={(v) => set('subtotal', v)} />
        <Field id="f-tax" label="Tax (optional)" inputMode="decimal" value={draft.tax} errors={errorsFor('tax')} onChange={(v) => set('tax', v)} />
        <Field id="f-total" label="Total" inputMode="decimal" value={draft.total} errors={errorsFor('total')} onChange={(v) => set('total', v)} />
      </div>

      <div className="panel-foot">
        <span className="hint">{valid ? 'Passes schema validation. Export contains only validated data.' : 'Export is disabled until every issue is resolved.'}</span>
        <button type="button" className="btn btn-primary" onClick={onExport} disabled={!valid}>
          Export JSON
        </button>
      </div>

      {validation?.success && (
        <details className="preview">
          <summary>Validated JSON preview</summary>
          <pre>{JSON.stringify(validation.data, null, 2)}</pre>
        </details>
      )}
    </section>
  );
}
