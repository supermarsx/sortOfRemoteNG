import React, { useState, useCallback, useRef, useEffect } from "react";
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
  Clipboard,
} from "lucide-react";
import jsQR from "jsqr";
import { TOTPConfig } from "../types/settings";
import {
  ImportSource,
  IMPORT_SOURCES,
  ImportResult,
  importTotpEntries,
} from "../utils/totpImport";
import { Modal } from "./ui/Modal";

interface TotpImportDialogProps {
  onImport: (entries: TOTPConfig[]) => void;
  onClose: () => void;
  existingSecrets?: string[];
}

export const TotpImportDialog: React.FC<TotpImportDialogProps> = ({
  onImport,
  onClose,
  existingSecrets = [],
}) => {
  const [source, setSource] = useState<ImportSource>("auto");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [fileName, setFileName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [qrDecoding, setQrDecoding] = useState(false);
  const [qrError, setQrError] = useState("");
  const [qrPreview, setQrPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processContent = useCallback(
    (content: string, name: string) => {
      setFileName(name);
      const r = importTotpEntries(content, source);
      setResult(r);
      // Auto-select all entries that don't have duplicate secrets
      const existingSet = new Set(existingSecrets.map((s) => s.toLowerCase()));
      const sel = new Set<number>();
      r.entries.forEach((entry, i) => {
        if (!existingSet.has(entry.secret.toLowerCase())) {
          sel.add(i);
        }
      });
      setSelected(sel);
    },
    [source, existingSecrets],
  );

  const decodeQrFromImage = useCallback(
    async (imageSource: Blob | string): Promise<void> => {
      setQrDecoding(true);
      setQrError("");
      try {
        const img = new Image();
        const url =
          typeof imageSource === "string"
            ? imageSource
            : URL.createObjectURL(imageSource);
        setQrPreview(url);

        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("Failed to load image"));
          img.src = url;
        });

        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas not supported");
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        const qrResult = jsQR(
          imageData.data,
          imageData.width,
          imageData.height,
        );
        if (!qrResult) {
          setQrError("No QR code found in image");
          return;
        }

        const data = qrResult.data.trim();

        // Could be a single otpauth:// URI or multiple lines
        const lines = data.split(/\r?\n/).filter((l) => l.trim());
        const uris = lines.filter((l) => l.startsWith("otpauth://"));

        if (uris.length > 0) {
          // Process as otpauth URIs
          processContent(uris.join("\n"), "QR Code");
        } else if (data.startsWith("otpauth://")) {
          processContent(data, "QR Code");
        } else if (data.startsWith("{") || data.startsWith("[")) {
          // JSON payload in QR
          processContent(data, "QR Code");
        } else {
          setQrError(
            `QR decoded but content is not an otpauth:// URI: "${data.slice(0, 80)}${data.length > 80 ? "..." : ""}"`,
          );
        }

        if (typeof imageSource !== "string") {
          URL.revokeObjectURL(url);
        }
      } catch (err) {
        setQrError(
          err instanceof Error ? err.message : "Failed to decode QR code",
        );
      } finally {
        setQrDecoding(false);
      }
    },
    [processContent],
  );

  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (blob) decodeQrFromImage(blob);
          return;
        }
      }
    },
    [decodeQrFromImage],
  );

  // Global paste listener while dialog is open
  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  const handleFileSelect = useCallback(
    (file: File) => {
      // If it's an image, try QR decoding
      if (file.type.startsWith("image/")) {
        decodeQrFromImage(file);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          processContent(reader.result, file.name);
        }
      };
      reader.readAsText(file);
    },
    [processContent, decodeQrFromImage],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect],
  );

  const handleImport = () => {
    if (!result) return;
    const entries = result.entries.filter((_, i) => selected.has(i));
    onImport(entries);
    onClose();
  };

  const toggleEntry = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleAll = () => {
    if (!result) return;
    if (selected.size === result.entries.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(result.entries.map((_, i) => i)));
    }
  };

  const existingSet = new Set(existingSecrets.map((s) => s.toLowerCase()));

  return (
    <Modal
      isOpen
      onClose={onClose}
      backdropClassName="bg-black/60 z-[10000]"
      panelClassName="w-[640px] max-w-[95vw] max-h-[80vh] rounded-xl border border-[var(--color-border)] overflow-hidden"
      contentClassName="bg-[var(--color-background)]"
    >
      <div className="flex flex-1 min-h-0 flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]/60">
          <div className="flex items-center gap-3">
            <Upload size={18} className="text-blue-400" />
            <h2 className="text-sm font-semibold text-[var(--color-text)]">
              Import 2FA / TOTP Entries
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] rounded"
          >
            <X size={16} />
          </button>
        </div>

        {/* Source selector + File picker */}
        <div className="px-5 py-3 border-b border-[var(--color-border)]/50 space-y-3">
          <div className="flex items-center gap-3">
            <label className="text-xs text-[var(--color-textSecondary)] w-16 flex-shrink-0">
              Source
            </label>
            <div className="relative flex-1">
              <select
                value={source}
                onChange={(e) => {
                  setSource(e.target.value as ImportSource);
                  setResult(null);
                }}
                className="w-full px-3 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg text-sm text-[var(--color-text)] appearance-none outline-none focus:border-blue-500 pr-8"
              >
                {IMPORT_SOURCES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--color-textSecondary)] pointer-events-none"
              />
            </div>
          </div>

          {/* Source description */}
          <div className="text-[10px] text-gray-500 ml-[76px]">
            {IMPORT_SOURCES.find((s) => s.id === source)?.description}
          </div>

          {/* Drop zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
              dragOver
                ? "border-blue-500 bg-blue-500/10"
                : "border-[var(--color-border)] hover:border-[var(--color-border)] hover:bg-[var(--color-surface)]/40"
            }`}
          >
            <FileUp
              size={24}
              className="text-[var(--color-textSecondary)] mb-2"
            />
            <span className="text-sm text-[var(--color-textSecondary)]">
              {fileName || "Drop file here or click to browse"}
            </span>
            <span className="text-[10px] text-gray-500 mt-1">
              {IMPORT_SOURCES.find((s) => s.id === source)?.extensions.join(
                ", ",
              ) || ".json, .csv, .txt"}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept={
                (IMPORT_SOURCES.find((s) => s.id === source)?.extensions.join(
                  ",",
                ) || ".json,.csv,.txt,.2fas,.xml") + ",image/*"
              }
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileSelect(file);
                e.target.value = "";
              }}
            />
          </div>

          {/* QR paste hint + preview */}
          <div className="flex items-center gap-2 px-1">
            <QrCode size={14} className="text-gray-500 flex-shrink-0" />
            <span className="text-[10px] text-gray-500">
              Paste a QR code image (Ctrl+V) or drop/browse an image file to
              scan
            </span>
            {qrDecoding && (
              <Loader2
                size={12}
                className="text-blue-400 animate-spin flex-shrink-0"
              />
            )}
          </div>

          {/* QR preview + error */}
          {qrPreview && !result && (
            <div className="flex items-center gap-3 p-2 bg-[var(--color-surface)] rounded-lg">
              <img
                src={qrPreview}
                alt="QR preview"
                className="w-16 h-16 object-contain rounded"
              />
              <div className="flex-1 min-w-0">
                {qrDecoding && (
                  <div className="flex items-center gap-2 text-xs text-blue-400">
                    <Loader2 size={12} className="animate-spin" />
                    Scanning QR code...
                  </div>
                )}
                {qrError && (
                  <div className="text-xs text-red-400">{qrError}</div>
                )}
              </div>
              <button
                onClick={() => {
                  setQrPreview(null);
                  setQrError("");
                }}
                className="p-1 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-border)] rounded flex-shrink-0"
              >
                <X size={14} />
              </button>
            </div>
          )}
          {!qrPreview && qrError && (
            <div className="text-xs text-red-400 px-1">{qrError}</div>
          )}
        </div>

        {/* Results */}
        {result && (
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            {/* Summary bar */}
            <div className="flex items-center justify-between px-5 py-2 bg-[var(--color-surface)]/40 border-b border-[var(--color-border)]/50 text-xs">
              <div className="flex items-center gap-3">
                <span className="text-[var(--color-textSecondary)]">
                  Detected:{" "}
                  <span className="text-[var(--color-text)] font-medium">
                    {result.source}
                  </span>
                </span>
                <span className="text-[var(--color-textSecondary)]">
                  Found:{" "}
                  <span className="text-[var(--color-text)] font-medium">
                    {result.entries.length}
                  </span>{" "}
                  entries
                </span>
                <span className="text-[var(--color-textSecondary)]">
                  Selected:{" "}
                  <span className="text-blue-400 font-medium">
                    {selected.size}
                  </span>
                </span>
              </div>
              {result.entries.length > 0 && (
                <button
                  onClick={toggleAll}
                  className="sor-option-chip text-blue-400 hover:text-blue-300"
                >
                  {selected.size === result.entries.length
                    ? "Deselect all"
                    : "Select all"}
                </button>
              )}
            </div>

            {/* Errors */}
            {result.errors.length > 0 && (
              <div className="px-5 py-2 bg-yellow-500/5 border-b border-yellow-500/20">
                <div className="flex items-center gap-2 text-xs text-yellow-400">
                  <AlertTriangle size={12} />
                  {result.errors.length} warning
                  {result.errors.length !== 1 ? "s" : ""}
                </div>
                <div className="mt-1 max-h-16 overflow-y-auto">
                  {result.errors.map((err, i) => (
                    <div key={i} className="text-[10px] text-yellow-500/70">
                      {err}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Entry list */}
            <div className="flex-1 overflow-y-auto">
              {result.entries.length === 0 ? (
                <div className="p-6 text-center text-gray-500 text-sm">
                  No TOTP entries found in this file
                </div>
              ) : (
                <div className="sor-selection-list gap-0">
                  {result.entries.map((entry, i) => {
                    const isDuplicate = existingSet.has(
                      entry.secret.toLowerCase(),
                    );
                    const isSelected = selected.has(i);
                    return (
                      <div
                        key={i}
                        onClick={() => toggleEntry(i)}
                        className={`sor-selection-row rounded-none border-x-0 border-t-0 border-b border-[var(--color-border)]/30 ${
                          isSelected
                            ? "sor-selection-row-selected bg-blue-900/10"
                            : "hover:bg-[var(--color-surface)]/40"
                        } ${isDuplicate ? "opacity-50" : ""}`}
                      >
                        <div className="flex-shrink-0 text-[var(--color-textSecondary)]">
                          {isSelected ? (
                            <CheckSquare size={16} className="text-blue-400" />
                          ) : (
                            <Square size={16} />
                          )}
                        </div>
                        <Shield
                          size={14}
                          className="text-gray-500 flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-[var(--color-text)] font-medium truncate">
                              {entry.issuer}
                            </span>
                            {isDuplicate && (
                              <span className="text-[9px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">
                                DUPLICATE
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-[var(--color-textSecondary)] truncate">
                            {entry.account} · {entry.algorithm.toUpperCase()} ·{" "}
                            {entry.digits} digits · {entry.period}s
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-3 border-t border-[var(--color-border)] bg-[var(--color-surface)]/40">
          <button onClick={onClose} className="sor-option-chip text-sm">
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!result || selected.size === 0}
            className="flex items-center gap-2 px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Check size={14} />
            Import {selected.size > 0 ? `(${selected.size})` : ""}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default TotpImportDialog;
