import { useState, useCallback, useRef, useEffect } from "react";
import jsQR from "jsqr";
import { TOTPConfig } from "../types/settings";
import {
  ImportSource,
  ImportResult,
  importTotpEntries,
} from "../utils/totpImport";

export interface UseTotpImportOptions {
  onImport: (entries: TOTPConfig[]) => void;
  onClose: () => void;
  existingSecrets?: string[];
}

export function useTotpImport({
  onImport,
  onClose,
  existingSecrets = [],
}: UseTotpImportOptions) {
  const [source, setSource] = useState<ImportSource>("auto");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [fileName, setFileName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [qrDecoding, setQrDecoding] = useState(false);
  const [qrError, setQrError] = useState("");
  const [qrPreview, setQrPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const existingSet = new Set(existingSecrets.map((s) => s.toLowerCase()));

  const processContent = useCallback(
    (content: string, name: string) => {
      setFileName(name);
      const r = importTotpEntries(content, source);
      setResult(r);
      const exSet = new Set(existingSecrets.map((s) => s.toLowerCase()));
      const sel = new Set<number>();
      r.entries.forEach((entry, i) => {
        if (!exSet.has(entry.secret.toLowerCase())) {
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
        const lines = data.split(/\r?\n/).filter((l) => l.trim());
        const uris = lines.filter((l) => l.startsWith("otpauth://"));

        if (uris.length > 0) {
          processContent(uris.join("\n"), "QR Code");
        } else if (data.startsWith("otpauth://")) {
          processContent(data, "QR Code");
        } else if (data.startsWith("{") || data.startsWith("[")) {
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

  useEffect(() => {
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  const handleFileSelect = useCallback(
    (file: File) => {
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

  const changeSource = (newSource: ImportSource) => {
    setSource(newSource);
    setResult(null);
  };

  const clearQrPreview = () => {
    setQrPreview(null);
    setQrError("");
  };

  return {
    source,
    changeSource,
    result,
    selected,
    fileName,
    dragOver,
    setDragOver,
    qrDecoding,
    qrError,
    qrPreview,
    clearQrPreview,
    fileInputRef,
    existingSet,
    handleFileSelect,
    handleDrop,
    handleImport,
    toggleEntry,
    toggleAll,
  };
}
