// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function stubServer(opts: { configured: boolean; extract?: () => Response } = { configured: false }) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/health')) return json({ llmConfigured: opts.configured, model: opts.configured ? 'test-model' : null });
    if (url.endsWith('/api/extract') && opts.extract) return opts.extract();
    return json({ error: 'not found' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const docText = () => screen.getByRole('textbox', { name: /^document text$/i }) as HTMLTextAreaElement;
const status = () => screen.getByTestId('validation-status').textContent;
const input = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement;

async function loadSample(id: string) {
  fireEvent.change(screen.getByLabelText(/load a synthetic sample/i), { target: { value: id } });
}
const extractDemo = () => fireEvent.click(screen.getByRole('button', { name: /extract \(demo mode\)/i }));

beforeEach(() => {
  stubServer({ configured: false });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App — demo mode', () => {
  it('starts empty, clearly labelled as demo/no-AI, with AI mode unavailable', async () => {
    render(<App />);
    expect(status()).toBe('No extraction yet');
    expect(screen.getByText(/demo mode · rule-based · no ai/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: /extract \(demo mode\)/i }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(screen.getByText(/no api key configured/i)).toBeTruthy());
    expect((screen.getByRole('radio', { name: /^AI mode/i }) as HTMLInputElement).disabled).toBe(true);
  });

  it('extracts a sample, shows the source beside the results, and validates', async () => {
    render(<App />);
    await loadSample('clean');
    expect(docText().value).toContain('Brightwater Office Supply LLC');
    extractDemo();
    expect(status()).toBe('Valid');
    expect(input(/^invoice number$/i).value).toBe('INV-2025-0142');
    expect(input(/^vendor$/i).value).toBe('Brightwater Office Supply LLC');
    expect(input(/line 1 description/i).value).toBe('Ergonomic desk chair');
    // the original text is still on screen
    expect(docText().value).toContain('INV-2025-0142');
  });

  it('manual correction: clearing a required field blocks export, restoring it re-enables export', async () => {
    render(<App />);
    await loadSample('clean');
    extractDemo();
    const exportBtn = screen.getByRole('button', { name: /export json/i }) as HTMLButtonElement;
    expect(exportBtn.disabled).toBe(false);

    fireEvent.change(input(/^invoice number$/i), { target: { value: '' } });
    expect(status()).toBe('1 issue to fix');
    expect(exportBtn.disabled).toBe(true);
    expect(screen.getAllByText(/required/i).length).toBeGreaterThan(0);

    fireEvent.change(input(/^invoice number$/i), { target: { value: 'INV-FIXED' } });
    expect(status()).toBe('Valid');
    expect(exportBtn.disabled).toBe(false);
  });

  it('flags invalid extraction, then valid-with-warnings after correction', async () => {
    render(<App />);
    await loadSample('problems');
    extractDemo();
    expect(status()).toBe('1 issue to fix');
    expect(input(/^invoice date$/i).getAttribute('aria-invalid')).toBe('true');

    fireEvent.change(input(/^invoice date$/i), { target: { value: '2025-02-28' } });
    expect(status()).toBe('Valid · 3 warnings');
    expect(screen.getByText(/check these numbers/i)).toBeTruthy();
  });

  it('exports only validated data as JSON', async () => {
    const created: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
      created.push(b as Blob);
      return 'blob:test';
    });
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    render(<App />);
    await loadSample('alternate');
    extractDemo();
    fireEvent.click(screen.getByRole('button', { name: /export json/i }));

    expect(created).toHaveLength(1);
    const exported = JSON.parse(await created[0].text());
    expect(exported.schemaVersion).toBe(1);
    expect(exported.extractionMode).toBe('demo-rule-based');
    expect(exported.data.invoiceNumber).toBe('KL-88213');
    expect(exported.data.currency).toBe('EUR');
    expect(exported.data.total).toBe(1676.06);
  });

  it('marks the extraction stale when the document is edited afterwards', async () => {
    render(<App />);
    await loadSample('clean');
    extractDemo();
    fireEvent.change(docText(), { target: { value: 'changed' } });
    expect(screen.getByText(/edited since last extraction/i)).toBeTruthy();
  });

  it('shows a clear error for text that is not an invoice (all fields flagged, nothing exportable)', async () => {
    render(<App />);
    fireEvent.change(docText(), { target: { value: 'Just a shopping list: milk, eggs' } });
    extractDemo();
    expect(status()).toMatch(/issues to fix/);
    expect((screen.getByRole('button', { name: /export json/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('App — upload limits', () => {
  const upload = (file: File) => fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } });

  it('rejects PDFs and other non-text files with an explicit message', async () => {
    render(<App />);
    upload(new File(['%PDF-1.4'], 'scan.pdf', { type: 'application/pdf' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/only plain-text/i);
  });

  it('rejects files over the size limit before reading them', async () => {
    render(<App />);
    upload(new File(['x'.repeat(101 * 1024)], 'big.txt', { type: 'text/plain' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/limit is 100 KB/i);
  });

  it('loads a valid .txt file into the source panel', async () => {
    render(<App />);
    upload(new File(['Invoice Number: Z-9'], 'doc.txt', { type: 'text/plain' }));
    await waitFor(() => expect(docText().value).toBe('Invoice Number: Z-9'));
    expect(screen.getByText('doc.txt')).toBeTruthy();
  });

  it('rejects a .txt file that is really binary', async () => {
    render(<App />);
    upload(new File(['abc\u0000def'], 'bin.txt', { type: 'text/plain' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/binary/i);
  });
});

describe('App — AI mode (mocked server)', () => {
  it('enables AI mode only when the server reports a key, without claiming it works yet', async () => {
    stubServer({ configured: true });
    render(<App />);
    const radio = screen.getByRole('radio', { name: /^AI mode/i }) as HTMLInputElement;
    await waitFor(() => expect(radio.disabled).toBe(false));
    expect(screen.getByText(/not verified until you run an extraction/i)).toBeTruthy();
  });

  it('surfaces malformed model output as issues instead of trusting it', async () => {
    stubServer({
      configured: true,
      extract: () =>
        json({
          candidate: { invoiceNumber: 'M-1', vendor: 'Acme', lineItems: 'none', total: 'lots' },
          issues: [
            { path: 'vendor', message: 'x' },
            { path: 'lineItems', message: 'y' },
          ],
          model: 'test-model',
        }),
    });
    render(<App />);
    const radio = screen.getByRole('radio', { name: /^AI mode/i }) as HTMLInputElement;
    await waitFor(() => expect(radio.disabled).toBe(false));
    fireEvent.click(radio);
    fireEvent.change(docText(), { target: { value: 'Invoice Number: M-1' } });
    fireEvent.click(screen.getByRole('button', { name: /extract with ai/i }));

    await waitFor(() => expect(screen.getByText(/failed schema validation in 2 places/i)).toBeTruthy());
    expect(status()).toMatch(/issues to fix/);
    expect((screen.getByRole('button', { name: /export json/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the server error message when the AI call fails', async () => {
    stubServer({ configured: true, extract: () => json({ error: 'The model provider returned HTTP 500.' }, 502) });
    render(<App />);
    const radio = screen.getByRole('radio', { name: /^AI mode/i }) as HTMLInputElement;
    await waitFor(() => expect(radio.disabled).toBe(false));
    fireEvent.click(radio);
    fireEvent.change(docText(), { target: { value: 'Invoice Number: M-1' } });
    fireEvent.click(screen.getByRole('button', { name: /extract with ai/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/HTTP 500/);
    expect(screen.queryByText(/real extraction call succeeded/i)).toBeNull();
  });
});
