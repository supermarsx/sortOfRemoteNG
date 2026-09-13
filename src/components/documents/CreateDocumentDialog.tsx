"use client";
import React, { useEffect, useId, useRef, useState } from "react";
import {
  AtSign,
  File,
  FileCode,
  FileText,
  Folder,
  GitBranch,
  IdCard,
  KeyRound,
  Loader2,
  Mail,
  NotebookPen,
  Plus,
  Shield,
  Table2,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import type {
  DatabaseDocument,
  DocumentBlock,
} from "../../types/documents/document";
import { createEmptyDocument } from "../../utils/documents/documentService";
import { initialDocumentBlock } from "../../utils/documents/documentBlocks";
import {
  emptyDatabaseDocuments,
  normalizeDatabaseDocuments,
} from "../../utils/documents/validation";
import { getRuntimeIconEntry } from "../../utils/icons/iconLibraryRuntime";
import { Select } from "../ui/forms";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "../ui/overlays/Modal";
import { DocumentIconPicker } from "./DocumentIconPicker";

type Starter =
  "blank" | Exclude<DocumentBlock["type"], "attachment" | "reference">;
const GROUPS: readonly {
  label: string;
  templates: readonly {
    id: Starter;
    label: string;
    description: string;
    icon: LucideIcon;
  }[];
}[] = [
  {
    label: "Start simple",
    templates: [
      {
        id: "blank",
        label: "Blank document",
        description: "Choose your blocks as you go.",
        icon: File,
      },
      {
        id: "rich-text",
        label: "Rich text",
        description: "Formatted writing, lists and links.",
        icon: FileText,
      },
      {
        id: "markdown",
        label: "Markdown",
        description: "Write with lightweight markup.",
        icon: FileCode,
      },
      {
        id: "spreadsheet",
        label: "Spreadsheet",
        description: "A fresh sheet for tabular data.",
        icon: Table2,
      },
    ],
  },
  {
    label: "Notes and diagrams",
    templates: [
      {
        id: "note",
        label: "Note",
        description: "Capture a quick plain-text note.",
        icon: NotebookPen,
      },
      {
        id: "mermaid",
        label: "Diagram",
        description: "Start with an editable flowchart.",
        icon: GitBranch,
      },
    ],
  },
  {
    label: "Structured details",
    templates: [
      {
        id: "wifi",
        label: "Wi-Fi",
        description: "Network name and access details.",
        icon: Wifi,
      },
      {
        id: "secret",
        label: "Secret",
        description: "A labelled protected value.",
        icon: Shield,
      },
      {
        id: "credential",
        label: "Credential",
        description: "Username, password and notes.",
        icon: KeyRound,
      },
      {
        id: "email-account",
        label: "Email account",
        description: "Mailbox and server settings.",
        icon: Mail,
      },
      {
        id: "identity",
        label: "Personal identity",
        description: "Identity document details.",
        icon: IdCard,
      },
      {
        id: "email",
        label: "Email address",
        description: "A labelled contact address.",
        icon: AtSign,
      },
    ],
  },
];

export interface CreateDocumentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Adds a draft only; the owning workspace retains its normal save review. */
  onCreate: (document: DatabaseDocument) => void | Promise<void>;
  folders: readonly { id: string; name: string }[];
  initialParentFolderId: string | null;
  /** Required verified policy; callers disable this dialog while policy is loading. */
  enabledTypes: readonly DocumentBlock["type"][];
  disabled?: boolean;
}

/** The owner keys this component by its database/access lease. Closing drops the draft. */
export default function CreateDocumentDialog(props: CreateDocumentDialogProps) {
  return props.isOpen ? <DocumentCreationForm {...props} /> : null;
}

function DocumentCreationForm(props: CreateDocumentDialogProps) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("file-text");
  const [folder, setFolder] = useState(props.initialParentFolderId ?? "");
  const [starter, setStarter] = useState<Starter>("blank");
  const [emailAddress, setEmailAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const id = useId();
  const unavailable = props.disabled || busy;
  const hasEnabledTypes = props.enabledTypes.length > 0;
  const allowed =
    hasEnabledTypes &&
    (starter === "blank" || props.enabledTypes.includes(starter));
  const folderExists =
    !folder || props.folders.some((item) => item.id === folder);
  const close = () => {
    if (!pending.current) latest.current.onClose();
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending.current || latest.current.disabled || !alive.current) return;
    if (latest.current.enabledTypes.length === 0) {
      setError(
        "All document block types are disabled. Enable a type in this database's content settings before creating a document.",
      );
      return;
    }
    const title = name.trim();
    if (!title || title.length > 256 || title.includes("\0")) {
      setError("Enter a document name of 1–256 characters.");
      return;
    }
    if (starter !== "blank" && !latest.current.enabledTypes.includes(starter)) {
      setError(
        "This starting layout is now disabled for this database. Choose another layout.",
      );
      return;
    }
    if (folder && !latest.current.folders.some((item) => item.id === folder)) {
      setError(
        "The selected folder is no longer available. Choose a destination.",
      );
      return;
    }
    if (!getRuntimeIconEntry(icon)) {
      setError("This icon is no longer available. Choose another icon.");
      return;
    }
    if (
      starter === "email-account" &&
      (emailAddress.trim().length > 320 ||
        !/^[^\s@]+@[^\s@]+$/.test(emailAddress.trim()))
    ) {
      setError("Enter an email address for the email account.");
      return;
    }
    let document: DatabaseDocument;
    try {
      document = {
        ...createEmptyDocument(title, folder || null),
        icon,
        blocks: starter === "blank" ? [] : [initialDocumentBlock(starter)],
      };
      if (document.blocks[0]?.type === "email-account")
        document.blocks[0].address = emailAddress.trim();
      document = normalizeDatabaseDocuments({
        ...emptyDatabaseDocuments(),
        documents: [document],
      }).documents[0];
    } catch {
      setError(
        "These document details are not valid. Review the name, folder and starting layout.",
      );
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    const create = latest.current.onCreate;
    try {
      await create(document);
      if (alive.current && !latest.current.disabled) latest.current.onClose();
    } catch {
      if (alive.current)
        setError(
          "Could not create the document. Your details are still here; check database access and try again.",
        );
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <Modal
      isOpen
      onClose={close}
      closeOnEscape={!busy}
      closeOnBackdrop={!busy}
      ariaLabel="Create new document"
      panelClassName="max-w-2xl mx-4"
      dataTestId="create-document-dialog"
    >
      <ModalHeader
        title={
          <span className="flex items-center gap-2">
            <FileText size={18} aria-hidden="true" /> Create new document
          </span>
        }
        showCloseButton={false}
      />
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={submit}
        aria-label="New document details"
        aria-busy={busy}
      >
        <ModalBody className="space-y-5 px-5 py-4">
          <p className="text-sm text-[var(--color-textSecondary)]">
            Give your document a name and a starting layout. You can add more
            enabled blocks in the editor.
          </p>
          <div className="space-y-2">
            <label
              htmlFor={`${id}-name`}
              className="block text-sm font-medium text-[var(--color-text)]"
            >
              Document name
            </label>
            <input
              id={`${id}-name`}
              className="sor-form-input w-full"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Network handover"
              maxLength={256}
              required
              disabled={unavailable}
              autoComplete="off"
            />
          </div>
          <div className="space-y-4">
            <div className="min-w-0 space-y-2">
              <label
                htmlFor={`${id}-folder`}
                className="block text-sm font-medium text-[var(--color-text)]"
              >
                Destination folder
              </label>
              <Select
                id={`${id}-folder`}
                value={folder}
                onChange={setFolder}
                disabled={unavailable}
                variant="form"
                searchable
                searchPlaceholder="Find a folder…"
                className="w-full"
                options={[
                  { value: "", label: "Database root", icon: Folder },
                  ...props.folders.map((item) => ({
                    value: item.id,
                    label: item.name,
                    icon: Folder,
                  })),
                ]}
              />
            </div>
            <DocumentIconPicker
              value={icon}
              onChange={setIcon}
              disabled={unavailable}
            />
          </div>
          <fieldset disabled={unavailable} className="space-y-4">
            <legend className="mb-2 text-sm font-medium text-[var(--color-text)]">
              Starting layout
            </legend>
            {GROUPS.map((group) => (
              <div key={group.label}>
                <h3 className="mb-2 text-xs font-medium text-[var(--color-textSecondary)]">
                  {group.label}
                </h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {group.templates.map((template) => {
                    const enabled =
                      hasEnabledTypes &&
                      (template.id === "blank" ||
                        props.enabledTypes.includes(template.id));
                    return (
                      <label
                        key={template.id}
                        className={`flex min-w-0 items-start gap-3 rounded-lg border p-3 ${!enabled ? "cursor-not-allowed border-[var(--color-border)] opacity-50" : starter === template.id ? "cursor-pointer border-primary bg-primary/10" : "cursor-pointer border-[var(--color-border)] bg-[var(--color-background)] hover:border-primary/50"}`}
                      >
                        <input
                          className="sr-only peer"
                          type="radio"
                          name={`${id}-starter`}
                          value={template.id}
                          aria-label={template.label}
                          checked={starter === template.id}
                          disabled={!enabled || unavailable}
                          onChange={() => setStarter(template.id)}
                        />
                        <span className="rounded p-1 text-[var(--color-textSecondary)] peer-focus-visible:ring-2 peer-focus-visible:ring-primary">
                          <template.icon size={20} aria-hidden="true" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-[var(--color-text)]">
                            {template.label}
                          </span>
                          <span className="mt-0.5 block text-xs text-[var(--color-textSecondary)]">
                            {enabled
                              ? template.description
                              : "Disabled for this database"}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </fieldset>
          {starter === "email-account" && (
            <div className="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
              <label
                htmlFor={`${id}-email`}
                className="block text-sm font-medium text-[var(--color-text)]"
              >
                Email account address
              </label>
              <input
                id={`${id}-email`}
                type="email"
                className="sor-form-input w-full"
                value={emailAddress}
                onChange={(event) => setEmailAddress(event.target.value)}
                placeholder="name@example.com"
                required
                maxLength={320}
                disabled={unavailable}
                autoComplete="off"
              />
              <p className="text-xs text-[var(--color-textSecondary)]">
                Add server settings and credentials in the editor. No mailbox
                connection is made.
              </p>
            </div>
          )}
          {(props.enabledTypes.includes("attachment") ||
            props.enabledTypes.includes("reference")) && (
            <p className="text-xs text-[var(--color-textSecondary)]">
              {[
                props.enabledTypes.includes("attachment") && "Attachments",
                props.enabledTypes.includes("reference") && "references",
              ]
                .filter(Boolean)
                .join(" and ")}{" "}
              can be added in the editor after you choose a real file or target.
            </p>
          )}
          {!hasEnabledTypes && (
            <p role="alert" className="text-sm text-warning">
              All document block types are disabled. Enable a type in this
              database's content settings before creating a document.
            </p>
          )}
          {hasEnabledTypes && !allowed && (
            <p role="alert" className="text-sm text-warning">
              This starting layout is now disabled for this database. Choose
              another layout.
            </p>
          )}
          {!folderExists && (
            <p role="alert" className="text-sm text-warning">
              The selected folder is no longer available. Choose a destination.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          )}
          {props.disabled && (
            <p
              role="status"
              className="text-sm text-[var(--color-textSecondary)]"
            >
              Document creation is unavailable until this database and its
              content settings are ready.
            </p>
          )}
        </ModalBody>
        <ModalFooter className="items-center">
          <span className="mr-auto text-xs text-[var(--color-textSecondary)]">
            Opens a draft for review.
          </span>
          <button
            type="button"
            className="sor-btn-secondary"
            onClick={close}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="sor-btn-primary flex items-center gap-2"
            disabled={unavailable || !name.trim() || !allowed || !folderExists}
          >
            {busy ? (
              <Loader2 size={15} className="animate-spin" aria-hidden="true" />
            ) : (
              <Plus size={15} aria-hidden="true" />
            )}
            {busy ? "Creating…" : "Create document"}
          </button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
