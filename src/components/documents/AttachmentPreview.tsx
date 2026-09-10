"use client";
import React, { useEffect, useRef, useState } from "react";
import type { DocumentAttachment } from "../../types/documents/document";
import {
  decodeDocumentAttachment,
  verifyDocumentAttachments,
} from "../../utils/documents/documentAttachments";
import {
  emptyDatabaseDocuments,
  normalizeDatabaseDocuments,
} from "../../utils/documents/validation";
import styles from "./documents.module.css";
import type {
  PDFDocumentProxy,
  PDFDocumentLoadingTask,
  RenderTask,
  PDFWorker,
} from "pdfjs-dist";

/** No embedded browser/plugin: PDF actions, annotation links and XFA never mount. */
function PdfCanvas({ bytes }: { bytes: Uint8Array }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [error, setError] = useState<string | null>(null);
  const pdf = useRef<PDFDocumentProxy | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let disposed = false,
      loading: PDFDocumentLoadingTask | undefined,
      worker: Worker | undefined,
      pdfWorker: PDFWorker | undefined;
    setReady(false);
    setTotal(0);
    setPage(1);
    void (async () => {
      try {
        const lib = await import("pdfjs-dist");
        if (disposed) return;
        worker = new Worker(
          new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
          { type: "module" },
        );
        pdfWorker = lib.PDFWorker.create({ port: worker });
        class NoExternalData {
          async fetch() {
            throw new Error("External PDF resources are disabled.");
          }
        }
        loading = lib.getDocument({
          data: new Uint8Array(bytes),
          worker: pdfWorker,
          useWorkerFetch: false,
          useWasm: false,
          disableFontFace: true,
          useSystemFonts: true,
          enableXfa: false,
          disableAutoFetch: true,
          disableRange: true,
          disableStream: true,
          stopAtErrors: true,
          maxImageSize: 16 * 1024 * 1024,
          isOffscreenCanvasSupported: false,
          isImageDecoderSupported: false,
          BinaryDataFactory: NoExternalData,
          verbosity: 0,
        });
        const document = await loading.promise;
        if (disposed) {
          await loading.destroy();
          return;
        }
        pdf.current = document;
        setTotal(document.numPages);
        setReady(true);
      } catch {
        if (!disposed)
          setError(
            "This PDF cannot be previewed safely. Password-protected or unsupported PDFs are not opened in an active browser viewer.",
          );
      }
    })();
    return () => {
      disposed = true;
      pdf.current = null;
      void loading?.destroy().catch(() => {});
      pdfWorker?.destroy();
      worker?.terminate();
    };
  }, [bytes]);
  useEffect(() => {
    if (!ready || !pdf.current || !canvas.current) return;
    let disposed = false,
      render: RenderTask | undefined;
    const target = canvas.current;
    setError(null);
    void (async () => {
      try {
        const item = await pdf.current!.getPage(page);
        if (disposed) return;
        const base = item.getViewport({ scale: 1 });
        const scale = Math.min(1.5, 1200 / base.width, 1600 / base.height);
        const viewport = item.getViewport({ scale });
        target.width = Math.ceil(viewport.width);
        target.height = Math.ceil(viewport.height);
        render = item.render({ canvas: target, viewport, annotationMode: 0 });
        await render.promise;
        if (!disposed) item.cleanup();
      } catch {
        if (!disposed) setError("This PDF page could not be rendered.");
      }
    })();
    return () => {
      disposed = true;
      render?.cancel();
      target.width = 0;
      target.height = 0;
    };
  }, [ready, page]);
  return (
    <>
      <div className={styles.toolbar}>
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          disabled={!ready || page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous PDF page
        </button>
        <span>
          Page {page} of {total || "…"}
        </span>
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          disabled={!ready || page >= total}
          onClick={() => setPage((p) => p + 1)}
        >
          Next PDF page
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <canvas ref={canvas} aria-label={`PDF page ${page}`} />
      <p className={styles.help}>
        Canvas-only preview; embedded scripts, forms, links and external
        resources are not activated.
      </p>
    </>
  );
}
export default function AttachmentPreview({
  attachment,
}: {
  attachment: DocumentAttachment;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div>
      <p>
        {attachment.name} · {Math.ceil(attachment.size / 1024)} KiB
      </p>
      <button
        type="button"
        className="sor-btn sor-btn-secondary"
        onClick={() => setShown(!shown)}
      >
        {shown ? "Close attachment preview" : "Preview attachment"}
      </button>
      {shown && (
        <AttachmentContent
          key={`${attachment.id}:${attachment.sha256}`}
          attachment={attachment}
        />
      )}
    </div>
  );
}
function AttachmentContent({ attachment }: { attachment: DocumentAttachment }) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null),
    [url, setUrl] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false,
      objectUrl: string | undefined;
    void (async () => {
      try {
        const captured = { ...attachment };
        const validated = normalizeDatabaseDocuments({
          ...emptyDatabaseDocuments(),
          attachments: [captured],
        });
        await verifyDocumentAttachments(validated);
        if (disposed) return;
        const decoded = decodeDocumentAttachment(captured);
        if (captured.mimeType.startsWith("image/")) {
          objectUrl = URL.createObjectURL(
            new Blob([new Uint8Array(decoded).buffer], {
              type: captured.mimeType,
            }),
          );
          setUrl(objectUrl);
        } else setBytes(decoded);
      } catch {
        if (!disposed)
          setError(
            "Attachment integrity or format validation failed. Nothing was opened.",
          );
      }
    })();
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment]);
  return (
    <div className={styles.preview}>
      {error ? (
        <p role="alert">{error}</p>
      ) : url ? (
        <img src={url} alt={attachment.name} />
      ) : bytes ? (
        attachment.mimeType === "application/pdf" ? (
          <PdfCanvas bytes={bytes} />
        ) : (
          <pre className={styles.text}>{new TextDecoder().decode(bytes)}</pre>
        )
      ) : (
        <p role="status">Checking attachment…</p>
      )}
    </div>
  );
}
