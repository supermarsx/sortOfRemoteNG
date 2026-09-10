"use client";
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type {
  DocumentAttachment,
  DocumentBlock,
  DocumentReference,
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

const RichTextEditor = dynamic(() => import("./RichTextEditor"), {
  ssr: false,
  loading: () => <p>Loading text editor…</p>,
});
const MermaidBlock = dynamic(() => import("./MermaidBlock"), { ssr: false });
const AttachmentPreview = dynamic(() => import("./AttachmentPreview"), {
  ssr: false,
});
type SheetBlock = Extract<DocumentBlock, { type: "spreadsheet" }>;
export interface DocumentBlockEditorProps {
  blocks: DocumentBlock[];
  onChange: (blocks: DocumentBlock[]) => void;
  attachments: DocumentAttachment[];
  documentKey: string;
  readOnly?: boolean;
  onAttach?: (file: File) => Promise<DocumentAttachment | null>;
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
function initialBlock(type: DocumentBlock["type"]): DocumentBlock {
  const id = generateId();
  switch (type) {
    case "rich-text":
      return {
        id,
        type,
        content: { type: "doc", content: [{ type: "paragraph" }] },
      };
    case "markdown":
    case "mermaid":
    case "note":
      return {
        id,
        type,
        text:
          type === "mermaid" ? "flowchart LR\n  A[Start] --> B[Finish]" : "",
      };
    case "wifi":
      return {
        id,
        type,
        ssid: "",
        password: "",
        authentication: "WPA",
        hidden: false,
      };
    case "secret":
      return { id, type, label: "Secret", value: "" };
    case "credential":
      return {
        id,
        type,
        label: "Credential",
        username: "",
        password: "",
        url: "",
        notes: "",
      };
    case "email-account":
      return { id, type, address: "", username: "", password: "", tls: true };
    case "identity":
      return {
        id,
        type,
        documentType: "",
        holderName: "",
        idNumber: "",
        country: "",
        issueDate: "",
        expiryDate: "",
        attachmentIds: [],
      };
    case "email":
      return { id, type, address: "", label: "" };
    case "spreadsheet":
      return {
        id,
        type,
        workbook: {
          version: 1,
          styles: {},
          validations: {},
          sheets: [
            {
              id: generateId(),
              name: "Sheet 1",
              rows: 100,
              columns: 26,
              cells: {},
              merges: [],
              rowMetadata: {},
              columnMetadata: {},
            },
          ],
        },
      };
    default:
      throw new Error("Select the target before creating this block.");
  }
}
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
    alive.current = true;
    return () => {
      alive.current = false;
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
  useEffect(() => onValidityChange?.(valid), [valid, onValidityChange]);
  const update = (next: DocumentBlock[]) => {
    if (!latest.current.readOnly && alive.current)
      latest.current.onChange(next);
  };
  const change = (block: DocumentBlock) =>
    update(
      latest.current.blocks.map((item) =>
        item.id === block.id ? block : item,
      ),
    );
  const append = (block: DocumentBlock) => {
    if (latest.current.blocks.length >= DOCUMENT_LIMITS.blocksPerDocument) {
      setError("A document can contain at most 256 blocks.");
      return;
    }
    update([...latest.current.blocks, block]);
  };
  const chooseReference = async () => {
    if (!props.onChooseReference || busy || props.readOnly) return;
    const captured = ++operation.current;
    setBusy(true);
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
      if (alive.current && captured === operation.current) setBusy(false);
    }
  };
  const attach = async (file: File) => {
    if (!props.onAttach || busy || props.readOnly) return;
    if (file.size > DOCUMENT_LIMITS.attachmentBytes) {
      setError("Each attachment is limited to 4 MiB.");
      return;
    }
    const captured = ++operation.current;
    setBusy(true);
    setError(null);
    try {
      const attachment = await props.onAttach(file);
      if (
        !alive.current ||
        captured !== operation.current ||
        latest.current.readOnly
      )
        return;
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
      if (alive.current && captured === operation.current) setBusy(false);
    }
  };
  return (
    <div className={styles.editor}>
      {!props.readOnly && (
        <div className={styles.toolbar}>
          <label htmlFor={addId}>Block type</label>
          <div style={{ width: 200 }}>
            <Select
              id={addId}
              value={kind}
              onChange={(value) => setKind(value as DocumentBlock["type"])}
              options={Object.entries(LABELS).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </div>
          <button
            type="button"
            className="sor-btn sor-btn-primary"
            disabled={
              busy ||
              props.blocks.length >= 256 ||
              (kind === "attachment" && !props.onAttach) ||
              (kind === "reference" && !props.onChooseReference) ||
              (kind === "spreadsheet" && !props.renderSpreadsheet)
            }
            onClick={() => {
              if (kind === "attachment") input.current?.click();
              else if (kind === "reference") void chooseReference();
              else append(initialBlock(kind));
            }}
          >
            Add block
          </button>
          <input
            ref={input}
            type="file"
            hidden
            accept="image/png,image/jpeg,image/webp,application/pdf,text/plain,text/markdown,.md"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void attach(file);
            }}
          />
          {busy && <span role="status">Preparing block…</span>}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {!valid && (
        <p role="alert">
          Some draft fields are incomplete or invalid. Review email addresses,
          dates, URLs, references and size limits before saving.
        </p>
      )}
      {props.blocks.length === 0 && (
        <p className={styles.help}>
          This document is empty. Add a rich-text, credential, attachment or
          other block.
        </p>
      )}
      {props.blocks.map((block, index) => (
        <section
          key={block.id}
          className={styles.block}
          aria-label={`${LABELS[block.type] ?? "Unsupported"} block ${index + 1}`}
        >
          <div className={styles.heading}>
            <h3>{LABELS[block.type] ?? "Unsupported block"}</h3>
            {!props.readOnly && (
              <div className={styles.toolbar}>
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
                  ↑
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
                  ↓
                </button>
                <button
                  type="button"
                  className="sor-btn sor-btn-secondary"
                  disabled={busy}
                  aria-label={`Remove block ${index + 1}`}
                  onClick={() => setRemove(block.id)}
                >
                  Remove
                </button>
              </div>
            )}
          </div>
          {remove === block.id && !props.readOnly && (
            <div role="alert" className={styles.toolbar}>
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
          <BlockFields block={block} change={change} props={props} />
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
    <div>
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
    <div>
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
      {error && <p role="alert">The QR code could not be generated.</p>}
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
              className="sor-form-input"
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
            <details>
              <summary>Safe plain-text preview</summary>
              <pre className={styles.text}>{block.text}</pre>
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
                className="sor-form-input"
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
            <label>
              <input
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
          <label>
            <input
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
          <fieldset>
            <legend>Linked attachments</legend>
            {props.attachments.map((attachment) => (
              <label
                key={attachment.id}
                className="mr-3 inline-flex items-center gap-1"
              >
                <input
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
            <p role="alert">
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
        <p role="status">
          The spreadsheet editor is not available in this view. Workbook data
          has been preserved.
        </p>
      );
    default:
      return (
        <p role="alert">
          This block type is unsupported. Its data has not been replaced.
        </p>
      );
  }
}
