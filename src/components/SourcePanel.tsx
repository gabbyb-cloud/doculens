import type { ChangeEvent } from 'react';
import { LIMITS } from '../../shared/limits';
import { SAMPLES } from '../../shared/samples';

interface Props {
  text: string;
  fileName: string | null;
  busy: boolean;
  stale: boolean;
  onTextChange: (text: string) => void;
  onFile: (file: File) => void;
  onLoadSample: (id: string) => void;
  onClear: () => void;
  onExtract: () => void;
  extractLabel: string;
}

export function SourcePanel(props: Props) {
  const { text, fileName, busy, stale, onTextChange, onFile, onLoadSample, onClear, onExtract, extractLabel } = props;
  const atLimit = text.length >= LIMITS.maxChars;

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (file) onFile(file);
  };

  return (
    <section className="panel" aria-labelledby="source-heading">
      <div className="panel-head">
        <h2 id="source-heading">Source document</h2>
        {fileName && <span className="chip" title={fileName}>{fileName}</span>}
        {stale && <span className="chip chip-warn">Edited since last extraction</span>}
      </div>

      <div className="toolbar">
        <label className="btn btn-secondary file-btn">
          Upload .txt
          <input type="file" accept=".txt,.text,text/plain" onChange={handleFile} />
        </label>
        <select
          aria-label="Load a synthetic sample document"
          className="select"
          value=""
          onChange={(e) => e.target.value && onLoadSample(e.target.value)}
        >
          <option value="">Load sample…</option>
          {SAMPLES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-ghost" onClick={onClear} disabled={!text && !fileName}>
          Clear
        </button>
      </div>

      <label htmlFor="doc-text" className="visually-hidden">
        Document text
      </label>
      <textarea
        id="doc-text"
        className="doc-text"
        value={text}
        maxLength={LIMITS.maxChars}
        spellCheck={false}
        placeholder="Paste invoice text here, upload a .txt file, or load a synthetic sample."
        onChange={(e) => onTextChange(e.target.value)}
      />

      <div className="panel-foot">
        <span className={atLimit ? 'counter counter-limit' : 'counter'} aria-live="polite">
          {text.length.toLocaleString('en-US')} / {LIMITS.maxChars.toLocaleString('en-US')} characters
          {atLimit && ' — limit reached; extra text is not accepted'}
        </span>
        <button type="button" className="btn btn-primary" onClick={onExtract} disabled={busy || !text.trim()}>
          {busy ? 'Extracting…' : extractLabel}
        </button>
      </div>
      <p className="hint">Plain text only (max {(LIMITS.maxFileBytes / 1024).toFixed(0)} KB). PDF and image/OCR input is not supported.</p>
    </section>
  );
}
