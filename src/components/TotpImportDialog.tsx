import React from "react";
import {
  X,
  Upload,
  FileUp,
  Check,
  AlertTriangle,
  ChevronDown,
  Shield,
  CheckSquare,
  Square,
  QrCode,
  Loader2,
} from "lucide-react";
import { TOTPConfig } from "../types/settings";
import { IMPORT_SOURCES } from "../utils/totpImport";
import { useTotpImport } from "../hooks/useTotpImport";
import { Modal } from "./ui/Modal";

interface TotpImportDialogProps {
  onImport: (entries: TOTPConfig[]) => void;
  onClose: () => void;
  existingSecrets?: string[];
}

type Mgr = ReturnType<typeof useTotpImport>;

/* ---------- sub-components ---------- */

function Header({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]/60">
      <div className="flex items-center gap-3">
        <Upload size={18} className="text-blue-400" />
        <h2 className="text-sm font-semibold text-[var(--color-text)]">Import 2FA / TOTP Entries</h2>
      </div>
      <button onClick={onClose} className="p-1.5 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] rounded"><X size={16} /></button>
    </div>
  );
}

function SourceSelector({ m }: { m: Mgr }) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-xs text-[var(--color-textSecondary)] w-16 flex-shrink-0">Source</label>
      <div className="relative flex-1">
        <select value={m.source} onChange={(e) => m.changeSource(e.target.value as any)} className="w-full px-3 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text)] appearance-none outline-none focus:border-blue-500 pr-8">
          {IMPORT_SOURCES.map((s) => (<option key={s.id} value={s.id}>{s.label}</option>))}
        </select>
        <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-textSecondary)] pointer-events-none" />
      </div>
    </div>
  );
}

function DropZone({ m }: { m: Mgr }) {
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); m.setDragOver(true); }}
      onDragLeave={() => m.setDragOver(false)}
      onDrop={m.handleDrop}
      onClick={() => m.fileInputRef.current?.click()}
      className={`flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${m.dragOver ? "border-blue-500 bg-blue-500/10" : "border-[var(--color-border)] hover:border-[var(--color-border)] hover:bg-[var(--color-surface)]/40"}`}
    >
      <FileUp size={24} className="text-[var(--color-textSecondary)] mb-2" />
      <span className="text-sm text-[var(--color-textSecondary)]">{m.fileName || "Drop file here or click to browse"}</span>
      <span className="text-[10px] text-gray-500 mt-1">{IMPORT_SOURCES.find((s) => s.id === m.source)?.extensions.join(", ") || ".json, .csv, .txt"}</span>
      <input ref={m.fileInputRef} type="file" className="hidden" accept={(IMPORT_SOURCES.find((s) => s.id === m.source)?.extensions.join(",") || ".json,.csv,.txt,.2fas,.xml") + ",image/*"} onChange={(e) => { const file = e.target.files?.[0]; if (file) m.handleFileSelect(file); e.target.value = ""; }} />
    </div>
  );
}

function QrHint({ m }: { m: Mgr }) {
  return (
    <div className="flex items-center gap-2 px-1">
      <QrCode size={14} className="text-gray-500 flex-shrink-0" />
      <span className="text-[10px] text-gray-500">Paste a QR code image (Ctrl+V) or drop/browse an image file to scan</span>
      {m.qrDecoding && <Loader2 size={12} className="text-blue-400 animate-spin flex-shrink-0" />}
    </div>
  );
}

function QrPreview({ m }: { m: Mgr }) {
  if (m.qrPreview && !m.result) {
    return (
      <div className="flex items-center gap-3 p-2 bg-[var(--color-surface)] rounded-lg">
        <img src={m.qrPreview} alt="QR preview" className="w-16 h-16 object-contain rounded" />
        <div className="flex-1 min-w-0">
          {m.qrDecoding && <div className="flex items-center gap-2 text-xs text-blue-400"><Loader2 size={12} className="animate-spin" />Scanning QR code...</div>}
          {m.qrError && <div className="text-xs text-red-400">{m.qrError}</div>}
        </div>
        <button onClick={m.clearQrPreview} className="p-1 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] rounded flex-shrink-0"><X size={14} /></button>
      </div>
    );
  }
  if (!m.qrPreview && m.qrError) {
    return <div className="text-xs text-red-400 px-1">{m.qrError}</div>;
  }
  return null;
}

function ResultsSummary({ m }: { m: Mgr }) {
  if (!m.result) return null;
  return (
    <div className="flex items-center justify-between px-5 py-2 bg-[var(--color-surface)]/40 border-b border-[var(--color-border)]/50 text-xs">
      <div className="flex items-center gap-3">
        <span className="text-[var(--color-textSecondary)]">Detected: <span className="text-[var(--color-text)] font-medium">{m.result.source}</span></span>
        <span className="text-[var(--color-textSecondary)]">Found: <span className="text-[var(--color-text)] font-medium">{m.result.entries.length}</span> entries</span>
        <span className="text-[var(--color-textSecondary)]">Selected: <span className="text-blue-400 font-medium">{m.selected.size}</span></span>
      </div>
      {m.result.entries.length > 0 && (
        <button onClick={m.toggleAll} className="sor-option-chip text-blue-400 hover:text-blue-300">
          {m.selected.size === m.result.entries.length ? "Deselect all" : "Select all"}
        </button>
      )}
    </div>
  );
}

function ResultErrors({ m }: { m: Mgr }) {
  if (!m.result || m.result.errors.length === 0) return null;
  return (
    <div className="px-5 py-2 bg-yellow-500/5 border-b border-yellow-500/20">
      <div className="flex items-center gap-2 text-xs text-yellow-400"><AlertTriangle size={12} />{m.result.errors.length} warning{m.result.errors.length !== 1 ? "s" : ""}</div>
      <div className="mt-1 max-h-16 overflow-y-auto">{m.result.errors.map((err, i) => <div key={i} className="text-[10px] text-yellow-500/70">{err}</div>)}</div>
    </div>
  );
}

function EntryList({ m }: { m: Mgr }) {
  if (!m.result) return null;
  if (m.result.entries.length === 0) return <div className="p-6 text-center text-gray-500 text-sm">No TOTP entries found in this file</div>;
  return (
    <div className="sor-selection-list gap-0">
      {m.result.entries.map((entry, i) => {
        const isDuplicate = m.existingSet.has(entry.secret.toLowerCase());
        const isSelected = m.selected.has(i);
        return (
          <div key={i} onClick={() => m.toggleEntry(i)} className={`sor-selection-row rounded-none border-x-0 border-t-0 border-b border-[var(--color-border)]/30 ${isSelected ? "sor-selection-row-selected bg-blue-900/10" : "hover:bg-[var(--color-surface)]/40"} ${isDuplicate ? "opacity-50" : ""}`}>
            <div className="flex-shrink-0 text-[var(--color-textSecondary)]">{isSelected ? <CheckSquare size={16} className="text-blue-400" /> : <Square size={16} />}</div>
            <Shield size={14} className="text-gray-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--color-text)] font-medium truncate">{entry.issuer}</span>
                {isDuplicate && <span className="text-[9px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">DUPLICATE</span>}
              </div>
              <div className="text-[10px] text-[var(--color-textSecondary)] truncate">{entry.account} · {entry.algorithm.toUpperCase()} · {entry.digits} digits · {entry.period}s</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Footer({ m, onClose }: { m: Mgr; onClose: () => void }) {
  return (
    <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-[var(--color-border)] bg-[var(--color-surface)]/40">
      <button onClick={onClose} className="sor-option-chip text-sm">Cancel</button>
      <button onClick={m.handleImport} disabled={!m.result || m.selected.size === 0} className="flex items-center gap-2 px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-lg disabled:opacity-50 disabled:cursor-not-allowed">
        <Check size={14} />
        Import {m.selected.size > 0 ? `(${m.selected.size})` : ""}
      </button>
    </div>
  );
}

/* ---------- root ---------- */

export const TotpImportDialog: React.FC<TotpImportDialogProps> = ({ onImport, onClose, existingSecrets = [] }) => {
  const m = useTotpImport({ onImport, onClose, existingSecrets });

  return (
    <Modal isOpen onClose={onClose} backdropClassName="bg-black/60 z-[10000]" panelClassName="w-[640px] max-w-[95vw] max-h-[80vh] rounded-xl border border-[var(--color-border)] overflow-hidden" contentClassName="bg-[var(--color-background)]">
      <div className="flex flex-1 min-h-0 flex-col">
        <Header onClose={onClose} />
        <div className="px-5 py-3 border-b border-[var(--color-border)]/50 space-y-3">
          <SourceSelector m={m} />
          <div className="text-[10px] text-gray-500 ml-[76px]">{IMPORT_SOURCES.find((s) => s.id === m.source)?.description}</div>
          <DropZone m={m} />
          <QrHint m={m} />
          <QrPreview m={m} />
        </div>
        {m.result && (
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            <ResultsSummary m={m} />
            <ResultErrors m={m} />
            <div className="flex-1 overflow-y-auto"><EntryList m={m} /></div>
          </div>
        )}
        <Footer m={m} onClose={onClose} />
      </div>
    </Modal>
  );
};

export default TotpImportDialog;
