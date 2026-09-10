"use client";
import React, { useEffect, useRef, useState } from "react";
import type {
  DocumentWorkbook,
  DocumentReference,
} from "../../types/documents/document";
import type { SpreadsheetRuntime } from "../../utils/documents/spreadsheetRuntime";
import {
  documentCellCoordinates,
  validateDocumentReference,
} from "../../utils/documents/validation";
import styles from "./documents.module.css";

export interface SpreadsheetEditorProps {
  workbook: DocumentWorkbook;
  onChange: (workbook: DocumentWorkbook) => void;
  readOnly?: boolean;
  documentKey: string;
  onChooseReference?: () => Promise<DocumentReference | null>;
  onReference?: (reference: DocumentReference) => void;
  focusReference?: Extract<DocumentReference, { kind: "cell" }>;
  onValidityChange?: (valid: boolean) => void;
  onImport?: () => Promise<{ name: string; bytes: Uint8Array } | null>;
  onExport?: (file: {
    name: string;
    mimeType: string;
    bytes: Uint8Array;
  }) => Promise<"saved" | "cancelled" | void>;
}
export default function SpreadsheetEditor(props: SpreadsheetEditorProps) {
  const { workbook, documentKey, readOnly = false } = props;
  const latest = useRef(props);
  latest.current = props;
  const container = useRef<HTMLDivElement>(null),
    runtime = useRef<SpreadsheetRuntime | null>(null),
    epoch = useRef(0),
    signature = useRef(JSON.stringify(workbook));
  const [reload, setReload] = useState(0),
    [ready, setReady] = useState(false),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{
    workbook: DocumentWorkbook;
    warnings: string[];
    imported?: boolean;
  } | null>(null);
  const [note, setNote] = useState<{
    text: string;
    selection: NonNullable<ReturnType<SpreadsheetRuntime["selection"]>>;
  } | null>(null);
  const apply = (value: DocumentWorkbook) => {
    signature.current = JSON.stringify(value);
    latest.current.onChange(value);
    latest.current.onValidityChange?.(true);
    setError(null);
    setReview(null);
  };
  const receive = (value: DocumentWorkbook, warnings: string[]) => {
    if (warnings.length) {
      setReview({ workbook: value, warnings });
      latest.current.onValidityChange?.(false);
    } else apply(value);
  };
  useEffect(() => {
    const request = ++epoch.current;
    let active = true;
    setReady(false);
    setBusy(false);
    setError(null);
    setReview(null);
    setNote(null);
    latest.current.onValidityChange?.(true);
    signature.current = JSON.stringify(latest.current.workbook);
    void import("../../utils/documents/spreadsheetRuntime")
      .then(({ createSpreadsheetRuntime }) => {
        if (!active || !container.current) return;
        runtime.current = createSpreadsheetRuntime(
          container.current,
          latest.current.workbook,
          {
            readOnly,
            onChange(value, warnings) {
              if (
                active &&
                epoch.current === request &&
                latest.current.documentKey === documentKey &&
                !latest.current.readOnly
              )
                receive(value, warnings);
            },
            onError(message) {
              if (active) {
                setError(message);
                latest.current.onValidityChange?.(false);
              }
            },
          },
        );
        setReady(true);
      })
      .catch(() => {
        if (active) {
          setError(
            "The offline spreadsheet editor could not load. Your stored workbook was not changed.",
          );
          latest.current.onValidityChange?.(false);
        }
      });
    return () => {
      active = false;
      // Operation generation, deliberately invalidated on cleanup (not a DOM ref).
      // eslint-disable-next-line react-hooks/exhaustive-deps
      epoch.current = request + 1;
      runtime.current?.dispose();
      runtime.current = null;
    };
    // Owner/document identity resets the entire engine and its undo history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentKey, readOnly, reload]);
  useEffect(() => {
    const current = JSON.stringify(workbook);
    if (runtime.current && !review && current !== signature.current) {
      signature.current = current;
      setReload((value) => value + 1);
    }
  }, [workbook, review]);
  useEffect(() => {
    const reference = props.focusReference;
    if (!ready || !reference || !runtime.current) return;
    try {
      validateDocumentReference(reference);
      const sheet = latest.current.workbook.sheets.find(
          (item) => item.id === reference.sheetId,
        ),
        cell = documentCellCoordinates(reference.address);
      if (!sheet || cell.row >= sheet.rows || cell.column >= sheet.columns)
        throw Error("Unavailable cell");
      runtime.current.focus(reference.sheetId, reference.address);
    } catch {
      setError("The linked sheet or cell is no longer available.");
    }
  }, [props.focusReference, ready]);
  const current = (captured: number) =>
    epoch.current === captured &&
    latest.current.documentKey === documentKey &&
    !!runtime.current &&
    !latest.current.readOnly;
  const assign = async () => {
    const captured = epoch.current,
      selected = runtime.current?.selection();
    if (!selected || !current(captured) || !latest.current.onChooseReference) {
      setError("Select one cell before assigning a link.");
      return;
    }
    setBusy(true);
    try {
      const ref = await latest.current.onChooseReference();
      if (!ref || !current(captured)) return;
      validateDocumentReference(ref);
      const now = runtime.current!.selection();
      if (
        !now ||
        now.sheetId !== selected.sheetId ||
        now.address !== selected.address
      )
        throw Error("Selection changed");
      runtime.current!.setCellMetadata({ reference: ref, note: selected.note });
    } catch {
      if (current(captured))
        setError("The cell link was not changed. Select a cell and retry.");
    } finally {
      if (epoch.current === captured) setBusy(false);
    }
  };
  const importFile = async () => {
    if (!props.onImport || readOnly || busy) return;
    const captured = epoch.current;
    setBusy(true);
    try {
      const file = await props.onImport();
      if (!file || !current(captured)) return;
      const { importSpreadsheetFile } =
        await import("../../utils/documents/spreadsheetFiles");
      if (!current(captured)) return;
      const imported = await importSpreadsheetFile(file.name, file.bytes);
      if (!current(captured)) return;
      setReview({ ...imported, imported: true });
      latest.current.onValidityChange?.(false);
    } catch {
      if (current(captured))
        setError(
          "Spreadsheet import refused. Use a bounded XLSX or UTF-8 CSV file without macros, external links or unsupported formulas.",
        );
    } finally {
      if (epoch.current === captured) setBusy(false);
    }
  };
  const exportFile = async (format: "xlsx" | "csv") => {
    if (
      !props.onExport ||
      !runtime.current ||
      busy ||
      review ||
      error ||
      readOnly
    )
      return;
    const captured = epoch.current,
      data = runtime.current.snapshot();
    setBusy(true);
    try {
      const { exportSpreadsheetFile } =
        await import("../../utils/documents/spreadsheetFiles");
      const file = await exportSpreadsheetFile(data, format);
      if (!current(captured)) return;
      await latest.current.onExport?.(file);
      // The parent owns save/cancel confirmation; a resolved promise is not a success claim.
    } catch {
      if (current(captured))
        setError(
          "Spreadsheet export did not complete. Your protected document was not changed.",
        );
    } finally {
      if (epoch.current === captured) setBusy(false);
    }
  };
  return (
    <section aria-label="Document spreadsheet" className={styles.editor}>
      <div className={styles.toolbar}>
        <button
          type="button"
          className="sor-btn-secondary"
          disabled={!ready || readOnly || busy || !props.onChooseReference}
          onClick={() => void assign()}
        >
          Link selected cell
        </button>
        <button
          type="button"
          className="sor-btn-secondary"
          disabled={!ready || busy}
          onClick={() => {
            const ref = runtime.current?.selection()?.reference;
            if (ref) props.onReference?.(ref);
            else setError("The selected cell has no document link.");
          }}
        >
          Open cell link
        </button>
        <button
          type="button"
          className="sor-btn-secondary"
          disabled={!ready || readOnly || busy}
          onClick={() => {
            const selected = runtime.current?.selection();
            if (selected)
              setNote({ text: selected.note ?? "", selection: selected });
            else setError("Select a cell first.");
          }}
        >
          Cell note
        </button>
        {props.onImport && (
          <button
            type="button"
            className="sor-btn-secondary"
            disabled={!ready || readOnly || busy || !!review}
            onClick={() => void importFile()}
          >
            Import XLSX / CSV
          </button>
        )}
        {props.onExport && (
          <>
            <button
              type="button"
              className="sor-btn-secondary"
              disabled={!ready || readOnly || busy || !!review || !!error}
              onClick={() => void exportFile("xlsx")}
            >
              Export XLSX
            </button>
            <button
              type="button"
              className="sor-btn-secondary"
              disabled={!ready || readOnly || busy || !!review || !!error}
              onClick={() => void exportFile("csv")}
            >
              Export CSV
            </button>
          </>
        )}
      </div>
      <p className="text-xs text-text-muted">
        Offline editing. CSV exports the first sheet’s values with
        formula-injection protection. XLSX does not include application links or
        validation rules. Exported files are not encrypted.
      </p>
      {!ready && !error && (
        <p role="status">Loading offline spreadsheet editor…</p>
      )}
      {busy && <p role="status">Preparing spreadsheet…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          {ready && (
            <button
              type="button"
              className="sor-btn-secondary"
              disabled={readOnly}
              onClick={() => {
                try {
                  const result = runtime.current!.review();
                  receive(result.workbook, result.warnings);
                } catch {
                  setError(
                    "Undo the unsupported change before saving this spreadsheet.",
                  );
                }
              }}
            >
              Recheck current sheet
            </button>
          )}
        </div>
      )}
      {review && (
        <div
          role="region"
          aria-label="Spreadsheet compatibility review"
          className={styles.block}
        >
          <p>
            {review.imported
              ? "Replace this spreadsheet with the reviewed import?"
              : "Review unsupported formatting before saving."}
          </p>
          <ul>
            {review.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
          <button
            type="button"
            className="sor-btn-primary"
            disabled={readOnly || busy}
            onClick={() => {
              apply(review.workbook);
              setReload((value) => value + 1);
            }}
          >
            Use reviewed workbook
          </button>
          {review.imported && (
            <button
              type="button"
              className="sor-btn-secondary"
              onClick={() => {
                setReview(null);
                latest.current.onValidityChange?.(true);
              }}
            >
              Cancel import
            </button>
          )}
        </div>
      )}
      {note && (
        <div className={styles.block}>
          <label>
            Selected cell note
            <textarea
              className="sor-form-input"
              maxLength={4096}
              value={note.text}
              disabled={readOnly || busy}
              onChange={(event) =>
                setNote({ ...note, text: event.target.value })
              }
            />
          </label>
          <button
            type="button"
            className="sor-btn-primary"
            disabled={readOnly || busy}
            onClick={() => {
              const selected = runtime.current?.selection();
              if (
                !selected ||
                selected.sheetId !== note.selection.sheetId ||
                selected.address !== note.selection.address
              ) {
                setError("Cell selection changed. Reopen the note editor.");
                return;
              }
              runtime.current?.setCellMetadata({
                reference: selected.reference,
                note: note.text,
              });
              setNote(null);
            }}
          >
            Apply cell note
          </button>
          <button
            type="button"
            className="sor-btn-secondary"
            onClick={() => setNote(null)}
          >
            Cancel
          </button>
        </div>
      )}
      <div
        ref={container}
        data-testid="document-spreadsheet-surface"
        style={{
          height: 520,
          minHeight: 360,
          position: "relative",
          overflow: "hidden",
        }}
      />
    </section>
  );
}
