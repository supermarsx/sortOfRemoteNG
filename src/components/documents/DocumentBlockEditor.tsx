"use client";
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowDown, ArrowUp, ExternalLink, Plus, Trash2 } from "lucide-react";
import type {
  DocumentAttachment,
  DocumentBlock,
  DocumentReference,
  DocumentRichTextNode,
  DocumentWorkbook,
} from "../../types/documents/document";
import {
  DOCUMENT_LIMITS,
  emptyDatabaseDocuments,
  normalizeDatabaseDocuments,
  validateDocumentReference,
} from "../../utils/documents/validation";
import { generateId } from "../../utils/core/id";
import { Select } from "../ui/forms";
import styles from "./documents.module.css";
import { initialDocumentBlock } from "../../utils/documents/documentBlocks";
import {
  hasWritingContent,
  insertRichTextBlock,
  validateRichTextBlockInsertion,
  type RichTextBlockInsertion,
} from "../../utils/documents/documentInlineInsert";
import writingStyles from "./documentWriting.module.css";

const RichTextEditor = dynamic(() => import("./RichTextEditor"), {
  ssr: false,
  loading: () => <p className={styles.editorStatus}>Loading text editor…</p>,
});
const MermaidBlock = dynamic(() => import("./MermaidBlock"), { ssr: false });
const AttachmentPreview = dynamic(() => import("./AttachmentPreview"), {
  ssr: false,
});
type SheetBlock = Extract<DocumentBlock, { type: "spreadsheet" }>;
export interface DocumentBlockEditorProps {
  blocks: DocumentBlock[];
  /** Return false when the owning workspace rejects a draft mutation. */
  onChange: (blocks: DocumentBlock[]) => void | boolean;
  attachments: DocumentAttachment[];
  documentKey: string;
  readOnly?: boolean;
  /** Creation policy only: existing blocks remain visible and editable. */
  enabledTypes?: readonly DocumentBlock["type"][];
  onAttach?: (
    file: File,
    isCurrent?: () => boolean,
  ) => Promise<DocumentAttachment | null>;
  onReference?: (reference: DocumentReference) => void;
  onChooseReference?: () => Promise<DocumentReference | null>;
  renderSpreadsheet?: (
    block: SheetBlock,
    onChange: (workbook: DocumentWorkbook) => void,
    readOnly: boolean,
  ) => React.ReactNode;
  onValidityChange?: (valid: boolean) => void;
}
const LABELS: Record<DocumentBlock["type"], string> = {
  "rich-text": "Rich text",
  markdown: "Markdown",
  mermaid: "Diagram",
  note: "Note",
  wifi: "Wi-Fi",
  secret: "Secret",
  credential: "Credential",
  "email-account": "Email account",
  identity: "Personal identity",
  email: "Email address",
  attachment: "Attachment",
  reference: "Reference",
  spreadsheet: "Spreadsheet",
};
function documentBlocksValid(
  blocks: DocumentBlock[],
  attachments: DocumentAttachment[],
): boolean {
  try {
    normalizeDatabaseDocuments({
      ...emptyDatabaseDocuments(),
      attachments,
      documents: [
        {
          id: "draft",
          parentFolderId: null,
          name: "Draft",
          icon: "document",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          blocks,
        },
      ],
    });
    return true;
  } catch {
    return false;
  }
}
export default function DocumentBlockEditor(props: DocumentBlockEditorProps) {
  return <DocumentBlocks key={props.documentKey} {...props} />;
}
function DocumentBlocks(props: DocumentBlockEditorProps) {
  const addId = useId();
  const [view, setView] = useState<"write" | "blocks">("write");
  const [writer, setWriter] = useState(
    () =>
      initialDocumentBlock("rich-text") as Extract<
        DocumentBlock,
        { type: "rich-text" }
      >,
  );
  const [writerAfter, setWriterAfter] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [editorVersions, setEditorVersions] = useState<Record<string, number>>(
    {},
  );
  const surface = useRef<HTMLDivElement>(null);
  const pendingFile = useRef<((file: File | null) => void) | null>(null);
  const busyRef = useRef(false);
  const [kind, setKind] = useState<DocumentBlock["type"]>("rich-text");
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [remove, setRemove] = useState<string | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const alive = useRef(true),
    operation = useRef(0),
    input = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const picker = input.current;
    const cancel = () => {
      pendingFile.current?.(null);
      pendingFile.current = null;
    };
    picker?.addEventListener("cancel", cancel);
    return () => picker?.removeEventListener("cancel", cancel);
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pendingFile.current?.(null);
      pendingFile.current = null;
      // An operation generation, not a rendered DOM ref.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      operation.current++;
    };
  }, []);
  const valid = useMemo(
    () => documentBlocksValid(props.blocks, props.attachments),
    [props.blocks, props.attachments],
  );
  const { onValidityChange } = props;
  useEffect(
    () => onValidityChange?.(valid && !busy),
    [valid, busy, onValidityChange],
  );
  const preparing = (value: boolean) => {
    busyRef.current = value;
    setBusy(value);
  };
  useEffect(() => {
    if (!props.readOnly) return;
    ++operation.current;
    pendingFile.current?.(null);
    pendingFile.current = null;
    busyRef.current = false;
    setBusy(false);
  }, [props.readOnly]);
  useEffect(() => {
    if (!focusId || !surface.current || props.readOnly || view !== "write")
      return;
    const focus = () => {
      const section = Array.from(
        surface.current?.querySelectorAll<HTMLElement>(
          "[data-writing-block]",
        ) ?? [],
      ).find((element) => element.dataset.writingBlock === focusId);
      const target = section?.querySelector<HTMLElement>(
        '[contenteditable="true"], textarea:not([readonly]), input:not([readonly]):not([type="file"])',
      );
      if (!target) return false;
      target.focus({ preventScroll: true });
      setFocusId(null);
      return true;
    };
    if (focus()) return;
    const observer = new MutationObserver(() => {
      if (focus()) observer.disconnect();
    });
    observer.observe(surface.current, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [focusId, props.blocks, props.readOnly, view]);
  const update = (next: DocumentBlock[]) => {
    if (!latest.current.readOnly && alive.current)
      return latest.current.onChange(next) !== false;
    return false;
  };
  const change = (block: DocumentBlock) =>
    update(
      latest.current.blocks.map((item) =>
        item.id === block.id ? block : item,
      ),
    );
  const append = (block: DocumentBlock) => {
    if (
      latest.current.enabledTypes &&
      !latest.current.enabledTypes.includes(block.type)
    ) {
      setError("This block type is disabled for new content in this database.");
      return;
    }
    if (latest.current.blocks.length >= DOCUMENT_LIMITS.blocksPerDocument) {
      setError("A document can contain at most 256 blocks.");
      return;
    }
    update([...latest.current.blocks, block]);
  };
  const chooseReference = async () => {
    if (!props.onChooseReference || busyRef.current || props.readOnly) return;
    const captured = ++operation.current;
    preparing(true);
    setError(null);
    try {
      const ref = await props.onChooseReference();
      if (
        !alive.current ||
        captured !== operation.current ||
        latest.current.readOnly
      )
        return;
      if (ref) {
        validateDocumentReference(ref);
        append({
          id: generateId(),
          type: "reference",
          reference: ref,
          label: "",
        });
      }
    } catch {
      if (alive.current && captured === operation.current)
        setError("A reference could not be selected.");
    } finally {
      if (alive.current && captured === operation.current) preparing(false);
    }
  };
  const attach = async (file: File) => {
    if (!props.onAttach || busyRef.current || props.readOnly) return;
    if (file.size > DOCUMENT_LIMITS.attachmentBytes) {
      setError("Each attachment is limited to 4 MiB.");
      return;
    }
    const captured = ++operation.current;
    const current = () =>
      alive.current &&
      captured === operation.current &&
      !latest.current.readOnly &&
      latest.current.blocks.length < DOCUMENT_LIMITS.blocksPerDocument &&
      (!latest.current.enabledTypes ||
        latest.current.enabledTypes.includes("attachment"));
    if (!current()) return;
    preparing(true);
    setError(null);
    try {
      const attachment = await props.onAttach(file, current);
      if (!current()) return;
      if (attachment)
        append({
          id: generateId(),
          type: "attachment",
          attachmentId: attachment.id,
          caption: "",
        });
    } catch {
      if (alive.current && captured === operation.current)
        setError(
          "Attachment could not be added. The existing document was not saved or replaced.",
        );
    } finally {
      if (alive.current && captured === operation.current) preparing(false);
    }
  };
  const availableTypes = (
    Object.keys(LABELS) as DocumentBlock["type"][]
  ).filter(
    (type) =>
      (!props.enabledTypes || props.enabledTypes.includes(type)) &&
      (type !== "attachment" || !!props.onAttach) &&
      (type !== "reference" || !!props.onChooseReference) &&
      (type !== "spreadsheet" || !!props.renderSpreadsheet),
  );
  const insert = async (
    sourceId: string,
    request: RichTextBlockInsertion,
  ): Promise<boolean> => {
    if (busyRef.current || latest.current.readOnly || !alive.current)
      return false;
    const captured = ++operation.current;
    const current = () => {
      if (
        !alive.current ||
        captured !== operation.current ||
        latest.current.readOnly
      )
        return false;
      // The child additionally fences a moved caret, Escape and native editor state.
      if (
        "isCurrent" in request &&
        typeof request.isCurrent === "function" &&
        !request.isCurrent()
      )
        return false;
      try {
        validateRichTextBlockInsertion(
          latest.current.blocks,
          sourceId,
          request,
          latest.current.enabledTypes,
        );
        return true;
      } catch {
        return false;
      }
    };
    setError(null);
    try {
      validateRichTextBlockInsertion(
        latest.current.blocks,
        sourceId,
        request,
        latest.current.enabledTypes,
      );
      if (!current()) return false;
      if (
        (request.type === "reference" && !latest.current.onChooseReference) ||
        (request.type === "attachment" && !latest.current.onAttach) ||
        (request.type === "spreadsheet" && !latest.current.renderSpreadsheet)
      )
        return false;
      preparing(true);
      let block: DocumentBlock;
      if (request.type === "reference") {
        const reference = await latest.current.onChooseReference!();
        if (!reference || !current()) return false;
        validateDocumentReference(reference);
        block = { id: generateId(), type: "reference", reference, label: "" };
      } else if (request.type === "attachment") {
        const file = await new Promise<File | null>((resolve) => {
          pendingFile.current = resolve;
          if (input.current) input.current.click();
          else {
            pendingFile.current = null;
            resolve(null);
          }
        });
        if (!file || !current()) return false;
        if (file.size > DOCUMENT_LIMITS.attachmentBytes)
          throw new Error("Each attachment is limited to 4 MiB.");
        const attachment = await latest.current.onAttach!(file, current);
        if (!attachment || !current()) return false;
        block = {
          id: generateId(),
          type: "attachment",
          attachmentId: attachment.id,
          caption: "",
        };
      } else block = initialDocumentBlock(request.type);
      if (!current()) return false;
      const next = insertRichTextBlock(
        latest.current.blocks,
        sourceId,
        request,
        block,
        latest.current.enabledTypes,
      );
      if (!update(next.blocks)) return false;
      // Native text undo must not resurrect text moved into another block.
      setEditorVersions((previous) => ({
        ...previous,
        [sourceId]: (previous[sourceId] ?? 0) + 1,
      }));
      if (next.continuationId) setFocusId(next.continuationId);
      else {
        setWriterAfter(block.id);
        setFocusId(writer.id);
      }
      return true;
    } catch (cause) {
      if (alive.current && captured === operation.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "The block could not be inserted. Your writing is retained.",
        );
      return false;
    } finally {
      if (alive.current && captured === operation.current) preparing(false);
    }
  };
  const writeNew = (content: DocumentRichTextNode) => {
    if (
      !hasWritingContent(content) ||
      latest.current.readOnly ||
      !alive.current
    )
      return;
    if (
      latest.current.enabledTypes &&
      !latest.current.enabledTypes.includes("rich-text")
    )
      return;
    if (latest.current.blocks.length >= DOCUMENT_LIMITS.blocksPerDocument)
      return;
    const next = [...latest.current.blocks];
    const anchor = writerAfter
      ? next.findIndex((block) => block.id === writerAfter)
      : next.length - 1;
    if (writerAfter && anchor < 0) return;
    next.splice(anchor + 1, 0, { ...writer, content });
    if (!update(next)) return;
    setFocusId(writer.id);
    setWriter(
      initialDocumentBlock("rich-text") as Extract<
        DocumentBlock,
        { type: "rich-text" }
      >,
    );
    setWriterAfter(null);
  };
  const displayed = [...props.blocks];
  const writerAnchor = writerAfter
    ? displayed.findIndex((block) => block.id === writerAfter)
    : -1;
  if (
    view === "write" &&
    !props.readOnly &&
    availableTypes.includes("rich-text") &&
    displayed.length < DOCUMENT_LIMITS.blocksPerDocument &&
    (writerAnchor >= 0 || displayed[displayed.length - 1]?.type !== "rich-text")
  )
    displayed.splice(
      writerAnchor >= 0 ? writerAnchor + 1 : displayed.length,
      0,
      writer,
    );
  return (
    <div ref={surface} className={`${styles.editor} ${styles.documentEditor}`}>
      <div className={writingStyles.modeBar}>
        <div
          className={writingStyles.modes}
          role="group"
          aria-label="Document editing view"
        >
          {(["write", "blocks"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`sor-btn ${view === mode ? "sor-btn-primary" : "sor-btn-secondary"}`}
              aria-pressed={view === mode}
              disabled={busy}
              onClick={() => setView(mode)}
            >
              {mode === "write" ? "Write" : "Blocks"}
            </button>
          ))}
        </div>
        {view === "write" && !props.readOnly && (
          <p className={writingStyles.hint}>
            Start a new paragraph with / to insert a block.
          </p>
        )}
      </div>
      <input
        ref={input}
        type="file"
        hidden
        aria-label="Choose document attachment"
        accept="image/png,image/jpeg,image/webp,application/pdf,text/plain,text/markdown,.md"
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          event.target.value = "";
          if (pendingFile.current) {
            const resolve = pendingFile.current;
            pendingFile.current = null;
            resolve(file);
          } else if (file) void attach(file);
        }}
      />
      {busy && (
        <span role="status" className={styles.editorStatus}>
          Preparing block…
        </span>
      )}
      {!props.readOnly && view === "blocks" && (
        <div className={styles.actionToolbar}>
          <label htmlFor={addId}>Block type</label>
          <div className={styles.blockTypeSelect}>
            <Select
              id={addId}
              value={kind}
              onChange={(value) => setKind(value as DocumentBlock["type"])}
              options={Object.entries(LABELS).map(([value, label]) => ({
                value,
                label,
                disabled:
                  props.enabledTypes !== undefined &&
                  !props.enabledTypes.includes(value as DocumentBlock["type"]),
              }))}
            />
          </div>
          <button
            type="button"
            className="sor-btn sor-btn-primary"
            disabled={
              busy ||
              (props.enabledTypes !== undefined &&
                !props.enabledTypes.includes(kind)) ||
              props.blocks.length >= 256 ||
              (kind === "attachment" && !props.onAttach) ||
              (kind === "reference" && !props.onChooseReference) ||
              (kind === "spreadsheet" && !props.renderSpreadsheet)
            }
            onClick={() => {
              if (kind === "attachment") input.current?.click();
              else if (kind === "reference") void chooseReference();
              else append(initialDocumentBlock(kind));
            }}
          >
            <Plus size={14} aria-hidden="true" />
            Add block
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className={styles.editorAlert}>
          {error}
        </p>
      )}
      {!valid && (
        <p role="alert" className={styles.editorAlert}>
          Some draft fields are incomplete or invalid. Review email addresses,
          dates, URLs, references and size limits before saving.
        </p>
      )}
      {props.blocks.length === 0 && view === "blocks" && (
        <p className={styles.help}>
          This document is empty. Add a rich-text, credential, attachment or
          other block.
        </p>
      )}
      {displayed.map((block, index) => (
        <section
          key={block.id}
          data-writing-block={block.id}
          className={
            view === "blocks"
              ? `${styles.block} ${styles.documentBlock}`
              : block.type === "rich-text"
                ? `${writingStyles.text} ${block.id === writer.id ? writingStyles.empty : ""}`
                : writingStyles.embedded
          }
          aria-label={`${LABELS[block.type] ?? "Unsupported"} block ${index + 1}`}
        >
          {view === "blocks" ? (
            <div className={styles.blockHeading}>
              <h3 className={styles.blockTitle}>
                <span className={styles.blockNumber} aria-hidden="true">
                  {index + 1}
                </span>
                {LABELS[block.type] ?? "Unsupported block"}
              </h3>
              {!props.readOnly && (
                <div className={styles.actionGroup}>
                  <button
                    type="button"
                    className="sor-btn sor-btn-secondary"
                    disabled={index === 0 || busy}
                    aria-label={`Move block ${index + 1} up`}
                    onClick={() => {
                      const next = [...latest.current.blocks];
                      [next[index - 1], next[index]] = [
                        next[index],
                        next[index - 1],
                      ];
                      update(next);
                    }}
                  >
                    <ArrowUp size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="sor-btn sor-btn-secondary"
                    disabled={index === props.blocks.length - 1 || busy}
                    aria-label={`Move block ${index + 1} down`}
                    onClick={() => {
                      const next = [...latest.current.blocks];
                      [next[index + 1], next[index]] = [
                        next[index],
                        next[index + 1],
                      ];
                      update(next);
                    }}
                  >
                    <ArrowDown size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="sor-btn sor-btn-secondary"
                    disabled={busy}
                    aria-label={`Remove block ${index + 1}`}
                    onClick={() => setRemove(block.id)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                    Remove
                  </button>
                </div>
              )}
            </div>
          ) : (
            block.type !== "rich-text" && (
              <h3 className={writingStyles.embeddedTitle}>
                {LABELS[block.type]}
              </h3>
            )
          )}
          {remove === block.id && !props.readOnly && (
            <div role="alert" className={styles.editorAlert}>
              <span>
                Remove this block from the draft? Shared attachments are kept.
              </span>
              <button
                type="button"
                className="sor-btn sor-btn-danger"
                onClick={() => {
                  update(
                    latest.current.blocks.filter(
                      (item) => item.id !== block.id,
                    ),
                  );
                  setRemove(null);
                }}
              >
                Confirm remove block
              </button>
              <button
                type="button"
                className="sor-btn sor-btn-secondary"
                onClick={() => setRemove(null)}
              >
                Keep block
              </button>
            </div>
          )}
          <div className={styles.blockBody}>
            {block.type === "rich-text" ? (
              <RichTextEditor
                content={block.content}
                documentKey={`${props.documentKey}:${block.id}:${editorVersions[block.id] ?? 0}`}
                readOnly={props.readOnly}
                presentation={view === "write" ? "inline" : "full"}
                onChange={(content) =>
                  block.id === writer.id
                    ? writeNew(content)
                    : change({ ...block, content })
                }
                onReference={props.onReference}
                onChooseReference={props.onChooseReference}
                insertableBlocks={view === "write" ? availableTypes : []}
                onInsertBlock={
                  view === "write"
                    ? (request) => insert(block.id, request)
                    : undefined
                }
              />
            ) : (
              <BlockFields block={block} change={change} props={props} />
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
function Field({
  label,
  value,
  onChange,
  readOnly = false,
  maxLength = 4096,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  maxLength?: number;
  type?: string;
}) {
  return (
    <label className={styles.field}>
      {label}
      <input
        className="sor-form-input"
        type={type}
        value={value}
        readOnly={readOnly}
        maxLength={maxLength}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
function SecretField({
  label,
  value,
  onChange,
  readOnly,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    setRevealed(false);
  }, [value]);
  return (
    <div className={styles.editorPanel}>
      <Field
        label={label}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        type={revealed ? "text" : "password"}
        maxLength={32768}
      />
      <button
        type="button"
        className="sor-btn sor-btn-secondary"
        aria-pressed={revealed}
        onClick={() => setRevealed(!revealed)}
      >
        {revealed ? `Hide ${label}` : `Reveal ${label}`}
      </button>
    </div>
  );
}
function WifiQr({
  block,
}: {
  block: Extract<DocumentBlock, { type: "wifi" }>;
}) {
  const [revealed, setRevealed] = useState(false),
    [data, setData] = useState<string | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    setRevealed(false);
    setData(null);
    setError(false);
  }, [block.ssid, block.password, block.authentication, block.hidden]);
  useEffect(() => {
    if (!revealed) return;
    let disposed = false;
    void (async () => {
      try {
        const QR = await import("qrcode");
        const escape = (value: string) => value.replace(/[\\;,:"']/g, "\\$&");
        const text = `WIFI:T:${block.authentication};S:${escape(block.ssid)};P:${block.authentication === "nopass" ? "" : escape(block.password)};H:${block.hidden ? "true" : "false"};;`;
        const url = await QR.toDataURL(text, { width: 256, margin: 2 });
        if (!disposed) setData(url);
      } catch {
        if (!disposed) setError(true);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [revealed, block]);
  return (
    <div className={styles.editorPanel}>
      <button
        type="button"
        className="sor-btn sor-btn-secondary"
        onClick={() => {
          setRevealed(!revealed);
          setData(null);
        }}
      >
        {revealed ? "Hide Wi-Fi QR" : "Reveal Wi-Fi QR"}
      </button>
      {revealed && data && (
        <img
          width={256}
          height={256}
          src={data}
          alt="Wi-Fi join QR code containing the configured network secret"
        />
      )}
      {error && (
        <p role="alert" className={styles.editorAlert}>
          The QR code could not be generated.
        </p>
      )}
      <p className={styles.help}>
        A Wi-Fi QR code reveals the network password to anyone who scans it. It
        is not generated until you choose Reveal.
      </p>
    </div>
  );
}
function BlockFields({
  block,
  change,
  props,
}: {
  block: DocumentBlock;
  change: (next: DocumentBlock) => void;
  props: DocumentBlockEditorProps;
}) {
  const ro = props.readOnly;
  const field = (
    label: string,
    value: string,
    set: (value: string) => DocumentBlock,
    maxLength = 4096,
    type = "text",
  ) => (
    <Field
      key={label}
      label={label}
      value={value}
      onChange={(value) => change(set(value))}
      readOnly={ro}
      maxLength={maxLength}
      type={type}
    />
  );
  switch (block.type) {
    case "rich-text":
      return (
        <RichTextEditor
          content={block.content}
          onChange={(content) => change({ ...block, content })}
          documentKey={`${props.documentKey}:${block.id}`}
          readOnly={ro}
          onReference={props.onReference}
          onChooseReference={props.onChooseReference}
        />
      );
    case "note":
    case "markdown":
    case "mermaid":
      return (
        <>
          <label className={styles.field}>
            {block.type === "mermaid"
              ? "Diagram source"
              : block.type === "markdown"
                ? "Markdown source"
                : "Note"}
            <textarea
              className={`sor-form-input ${block.type === "note" ? styles.noteInput : styles.sourceInput}`}
              rows={block.type === "note" ? 4 : 8}
              value={block.text}
              readOnly={ro}
              maxLength={128 * 1024}
              onChange={(event) =>
                change({ ...block, text: event.target.value })
              }
            />
          </label>
          {block.type === "mermaid" && <MermaidBlock source={block.text} />}{" "}
          {block.type === "markdown" && (
            <details className={styles.editorHelp}>
              <summary>Safe plain-text preview</summary>
              <pre className={`${styles.text} ${styles.sourcePreview}`}>
                {block.text}
              </pre>
              <p className={styles.help}>
                Markdown source is preserved. Raw HTML and remote media are not
                rendered.
              </p>
            </details>
          )}
        </>
      );
    case "secret":
      return (
        <div className={styles.grid}>
          {field(
            "Secret label",
            block.label,
            (value) => ({ ...block, label: value }),
            256,
          )}
          <SecretField
            label="Secret value"
            value={block.value}
            onChange={(value) => change({ ...block, value })}
            readOnly={ro}
          />
        </div>
      );
    case "credential":
      return (
        <div className={styles.grid}>
          {field(
            "Credential label",
            block.label,
            (value) => ({ ...block, label: value }),
            256,
          )}
          {field(
            "Username",
            block.username,
            (value) => ({ ...block, username: value }),
            1024,
          )}
          <SecretField
            label="Password"
            value={block.password}
            onChange={(password) => change({ ...block, password })}
            readOnly={ro}
          />
          {field(
            "Website URL",
            block.url,
            (value) => ({ ...block, url: value }),
            2048,
          )}
          {field(
            "Credential notes",
            block.notes,
            (value) => ({ ...block, notes: value }),
            32768,
          )}
        </div>
      );
    case "wifi":
      return (
        <>
          <div className={styles.grid}>
            {field(
              "Network name (SSID)",
              block.ssid,
              (value) => ({ ...block, ssid: value }),
              128,
            )}
            <SecretField
              label="Wi-Fi password"
              value={block.password}
              onChange={(password) => change({ ...block, password })}
              readOnly={ro}
            />
            <label className={styles.field}>
              Wi-Fi security
              <select
                className="sor-form-select"
                value={block.authentication}
                disabled={ro}
                onChange={(event) =>
                  change({
                    ...block,
                    authentication: event.target.value as
                      "WPA" | "WEP" | "nopass",
                  })
                }
              >
                <option value="WPA">WPA / WPA2 / WPA3</option>
                <option value="WEP">WEP (legacy)</option>
                <option value="nopass">Open network</option>
              </select>
            </label>
            <label className={styles.checkboxField}>
              <input
                className={styles.checkbox}
                type="checkbox"
                disabled={ro}
                checked={block.hidden}
                onChange={(event) =>
                  change({ ...block, hidden: event.target.checked })
                }
              />{" "}
              Hidden network
            </label>
          </div>
          <WifiQr block={block} />
        </>
      );
    case "email-account":
      return (
        <div className={styles.grid}>
          {field(
            "Email address",
            block.address,
            (value) => ({ ...block, address: value }),
            320,
            "email",
          )}
          {field(
            "Mail username",
            block.username,
            (value) => ({ ...block, username: value }),
            1024,
          )}
          <SecretField
            label="Mail password"
            value={block.password}
            onChange={(password) => change({ ...block, password })}
            readOnly={ro}
          />
          {field(
            "IMAP host",
            block.imapHost ?? "",
            (value) => ({ ...block, imapHost: value }),
            253,
          )}
          {field(
            "IMAP port",
            block.imapPort?.toString() ?? "",
            (value) => ({
              ...block,
              imapPort: value ? Number(value) : undefined,
            }),
            5,
            "number",
          )}
          {field(
            "SMTP host",
            block.smtpHost ?? "",
            (value) => ({ ...block, smtpHost: value }),
            253,
          )}
          {field(
            "SMTP port",
            block.smtpPort?.toString() ?? "",
            (value) => ({
              ...block,
              smtpPort: value ? Number(value) : undefined,
            }),
            5,
            "number",
          )}
          <label className={styles.checkboxField}>
            <input
              className={styles.checkbox}
              type="checkbox"
              disabled={ro}
              checked={block.tls}
              onChange={(event) =>
                change({ ...block, tls: event.target.checked })
              }
            />{" "}
            Use TLS
          </label>
          <p className={styles.help}>
            Stored account information only; this block does not connect to a
            mail server.
          </p>
        </div>
      );
    case "identity":
      return (
        <>
          <div className={styles.grid}>
            {field(
              "Identity document type",
              block.documentType,
              (value) => ({ ...block, documentType: value }),
              128,
            )}
            {field(
              "Holder name",
              block.holderName,
              (value) => ({ ...block, holderName: value }),
              256,
            )}
            <SecretField
              label="Identity number"
              value={block.idNumber}
              onChange={(idNumber) => change({ ...block, idNumber })}
              readOnly={ro}
            />
            {field(
              "Country code (two letters)",
              block.country,
              (value) => ({ ...block, country: value.toUpperCase() }),
              2,
            )}
            {field(
              "Issue date",
              block.issueDate,
              (value) => ({ ...block, issueDate: value }),
              10,
              "date",
            )}
            {field(
              "Expiry date",
              block.expiryDate,
              (value) => ({ ...block, expiryDate: value }),
              10,
              "date",
            )}
          </div>
          <fieldset className={styles.attachmentChoices}>
            <legend>Linked attachments</legend>
            {props.attachments.map((attachment) => (
              <label key={attachment.id} className={styles.checkboxField}>
                <input
                  className={styles.checkbox}
                  type="checkbox"
                  disabled={
                    ro ||
                    (!block.attachmentIds.includes(attachment.id) &&
                      block.attachmentIds.length >= 16)
                  }
                  checked={block.attachmentIds.includes(attachment.id)}
                  onChange={(event) =>
                    change({
                      ...block,
                      attachmentIds: event.target.checked
                        ? [...block.attachmentIds, attachment.id]
                        : block.attachmentIds.filter(
                            (id) => id !== attachment.id,
                          ),
                    })
                  }
                />
                {attachment.name}
              </label>
            ))}
          </fieldset>
        </>
      );
    case "email":
      return (
        <div className={styles.grid}>
          {field(
            "Email label",
            block.label,
            (value) => ({ ...block, label: value }),
            256,
          )}
          {field(
            "Email address",
            block.address,
            (value) => ({ ...block, address: value }),
            320,
            "email",
          )}
        </div>
      );
    case "attachment": {
      const item = props.attachments.find(
        (value) => value.id === block.attachmentId,
      );
      return (
        <>
          {field("Attachment caption", block.caption, (value) => ({
            ...block,
            caption: value,
          }))}
          {item ? (
            <AttachmentPreview attachment={item} />
          ) : (
            <p role="alert" className={styles.editorAlert}>
              The referenced attachment is missing. Its identifier was
              preserved.
            </p>
          )}
        </>
      );
    }
    case "reference":
      return (
        <>
          {field(
            "Reference label",
            block.label,
            (value) => ({ ...block, label: value }),
            256,
          )}
          <p className={styles.help}>
            {block.reference.kind} · {block.reference.id} · Database{" "}
            {block.reference.databaseId}
            {block.reference.kind === "cell"
              ? ` · ${block.reference.address}`
              : ""}
          </p>
          <button
            type="button"
            className="sor-btn sor-btn-secondary"
            disabled={!props.onReference}
            onClick={() => props.onReference?.(block.reference)}
          >
            <ExternalLink size={14} aria-hidden="true" />
            Open reference
          </button>
        </>
      );
    case "spreadsheet":
      return props.renderSpreadsheet ? (
        props.renderSpreadsheet(
          block,
          (workbook) => change({ ...block, workbook }),
          !!ro,
        )
      ) : (
        <p role="status" className={styles.editorStatus}>
          The spreadsheet editor is not available in this view. Workbook data
          has been preserved.
        </p>
      );
    default:
      return (
        <p role="alert" className={styles.editorAlert}>
          This block type is unsupported. Its data has not been replaced.
        </p>
      );
  }
}
