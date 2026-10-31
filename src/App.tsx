import { useEffect, useMemo, useRef, useState } from 'react';
import { demoExtract } from '../shared/demoExtractor';
import { checkInputText } from '../shared/inputGuard';
import { LIMITS } from '../shared/limits';
import { getSample } from '../shared/samples';
import { validateInvoice, type Issue } from '../shared/schema';
import type { Health } from '../shared/api';
import { SourcePanel } from './components/SourcePanel';
import { ResultsPanel } from './components/ResultsPanel';
import { extractViaServer, fetchHealth } from './lib/api';
import { candidateFromDraft, draftFromCandidate, type Draft } from './lib/draft';
import { buildExport, downloadJson, exportFileName, type ExtractionMode } from './lib/exportJson';

type Notice = { kind: 'error' | 'info'; message: string };

export default function App() {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [mode, setMode] = useState<ExtractionMode>('demo');
  const [health, setHealth] = useState<Health | null | undefined>(undefined); // undefined = still checking
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [extractedWith, setExtractedWith] = useState<{ mode: ExtractionMode; text: string } | null>(null);
  const [rawIssues, setRawIssues] = useState<Issue[]>([]);
  const [aiSucceeded, setAiSucceeded] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth(controller.signal).then((h) => {
      if (!controller.signal.aborted) setHealth(h);
    });
    return () => controller.abort();
  }, []);

  const aiAvailable = health?.llmConfigured === true;

  const validation = useMemo(() => (draft ? validateInvoice(candidateFromDraft(draft)) : null), [draft]);

  const cancelInFlight = () => {
    requestId.current += 1;
    setBusy(false);
  };

  const resetResults = () => {
    cancelInFlight();
    setDraft(null);
    setExtractedWith(null);
    setRawIssues([]);
  };

  const handleMode = (next: ExtractionMode) => {
    if (next === mode) return;
    cancelInFlight();
    setMode(next);
    setNotice(null);
  };

  const handleExtract = async () => {
    const check = checkInputText(text);
    if (!check.ok) {
      setNotice({ kind: 'error', message: check.reason });
      return;
    }
    setNotice(null);

    if (mode === 'demo') {
      setDraft(draftFromCandidate(demoExtract(text)));
      setRawIssues([]);
      setExtractedWith({ mode, text });
      return;
    }

    const id = ++requestId.current;
    setBusy(true);
    try {
      const result = await extractViaServer(text);
      if (id !== requestId.current) return; // superseded by a newer action
      setDraft(draftFromCandidate(result.candidate));
      setRawIssues(result.issues);
      setExtractedWith({ mode, text });
      setAiSucceeded(true);
    } catch (err) {
      if (id === requestId.current) {
        setNotice({ kind: 'error', message: err instanceof Error ? err.message : 'Extraction failed.' });
      }
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  };

  const handleFile = async (file: File) => {
    if (!/\.(txt|text)$/i.test(file.name) && file.type !== 'text/plain') {
      setNotice({ kind: 'error', message: 'Only plain-text (.txt) files are supported. PDFs, images and scanned documents are not supported.' });
      return;
    }
    if (file.size > LIMITS.maxFileBytes) {
      setNotice({ kind: 'error', message: `That file is ${(file.size / 1024).toFixed(0)} KB; the limit is ${LIMITS.maxFileBytes / 1024} KB.` });
      return;
    }
    let content: string;
    try {
      content = await file.text();
    } catch {
      setNotice({ kind: 'error', message: 'The file could not be read.' });
      return;
    }
    const check = checkInputText(content);
    if (!check.ok) {
      setNotice({ kind: 'error', message: check.reason });
      return;
    }
    resetResults();
    setText(content);
    setFileName(file.name);
    setNotice(null);
  };

  const handleSample = (id: string) => {
    resetResults();
    setText(getSample(id).text);
    setFileName(null);
    setNotice(null);
  };

  const handleClear = () => {
    resetResults();
    setText('');
    setFileName(null);
    setNotice(null);
  };

  const handleExport = () => {
    if (!validation || !validation.success) return; // defence in depth: the button is also disabled
    downloadJson(
      exportFileName(validation.data),
      buildExport(validation.data, { mode: extractedWith?.mode ?? 'demo', warnings: validation.warnings }),
    );
  };

  const stale = extractedWith !== null && extractedWith.text !== text;

  let aiStatus = 'Checking server…';
  if (health === null) aiStatus = 'Server not reachable — start it with npm run dev';
  else if (health && !health.llmConfigured) aiStatus = 'No API key configured on the server';
  else if (health) {
    aiStatus = aiSucceeded
      ? `A real extraction call succeeded this session (model: ${health.model})`
      : `API key configured (model: ${health.model}) — not verified until you run an extraction`;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="7" fill="#1d4ed8" />
            <circle cx="14" cy="14" r="7" fill="none" stroke="#fff" strokeWidth="2.6" />
            <path d="M19.5 19.5 26 26" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
            <path d="M11 12h6M11 16h4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <div>
            <h1>DocuLens</h1>
            <p>Invoice extraction with schema validation</p>
          </div>
        </div>
        <span className={mode === 'demo' ? 'mode-pill' : 'mode-pill mode-pill-ai'}>
          {mode === 'demo' ? 'Demo mode · rule-based · no AI' : 'AI mode · sends text to LLM provider'}
        </span>
      </header>

      <main className="container">
        <fieldset className="modes">
          <legend>Extraction mode</legend>
          <label className={mode === 'demo' ? 'mode-card mode-card-active' : 'mode-card'}>
            <input type="radio" name="mode" checked={mode === 'demo'} onChange={() => handleMode('demo')} />
            <span className="mode-title">Demo mode <span className="tag">Deterministic</span></span>
            <span className="mode-desc">Rule-based parser running entirely in your browser. No network calls, no AI model, no cost. Best on the bundled samples; will miss unusual layouts.</span>
          </label>
          <label className={mode === 'ai' ? 'mode-card mode-card-active' : aiAvailable ? 'mode-card' : 'mode-card mode-card-disabled'}>
            <input type="radio" name="mode" checked={mode === 'ai'} disabled={!aiAvailable} onChange={() => handleMode('ai')} />
            <span className="mode-title">AI mode <span className="tag tag-optional">Optional</span></span>
            <span className="mode-desc">The local server sends the document text to an LLM provider using a server-side API key. Output is untrusted until it passes validation.</span>
            <span className="mode-status">{aiStatus}</span>
          </label>
        </fieldset>

        {notice && (
          <div className={notice.kind === 'error' ? 'notice notice-error' : 'notice'} role="alert">
            {notice.message}
          </div>
        )}

        <div className="workspace">
          <SourcePanel
            text={text}
            fileName={fileName}
            busy={busy}
            stale={stale}
            onTextChange={setText}
            onFile={handleFile}
            onLoadSample={handleSample}
            onClear={handleClear}
            onExtract={handleExtract}
            extractLabel={mode === 'demo' ? 'Extract (demo mode)' : 'Extract with AI'}
          />
          <ResultsPanel draft={draft} validation={validation} rawIssueCount={rawIssues.length} onChange={setDraft} onExport={handleExport} />
        </div>
      </main>

      <footer className="footer">
        Synthetic sample data only. Plain-text input; PDF and OCR are not supported. In demo mode your text never leaves this browser tab.
      </footer>
    </div>
  );
}
