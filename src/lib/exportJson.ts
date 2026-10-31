import type { Invoice, Issue } from '../../shared/schema';

export type ExtractionMode = 'demo' | 'ai';

export interface ExportEnvelope {
  schemaVersion: 1;
  exportedAt: string;
  extractionMode: 'demo-rule-based' | 'ai-assisted';
  /** Non-blocking arithmetic warnings that were present at export time. */
  warnings: string[];
  /** Zod-validated data only. */
  data: Invoice;
}

/** Accepts only already-validated data (type-enforced), so unvalidated input cannot be exported. */
export function buildExport(
  data: Invoice,
  meta: { mode: ExtractionMode; warnings: Issue[] },
  now: Date = new Date(),
): ExportEnvelope {
  return {
    schemaVersion: 1,
    exportedAt: now.toISOString(),
    extractionMode: meta.mode === 'ai' ? 'ai-assisted' : 'demo-rule-based',
    warnings: meta.warnings.map((w) => w.message),
    data,
  };
}

export function exportFileName(data: Invoice): string {
  const safe = data.invoiceNumber.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'invoice';
  return `doculens-${safe}.json`;
}

export function downloadJson(fileName: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
