"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  FileText,
  FolderOpen,
  Link2,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  Download,
  Users,
  Ticket,
  Printer,
  X,
} from "lucide-react";
import { useConnections } from "../../contexts/useConnections";
import { useDocumentsWorkspace } from "../../hooks/documents/useDocumentsWorkspace";
import { createEmptyDocument } from "../../utils/documents/documentService";
import { createDocumentAttachment } from "../../utils/documents/documentAttachments";
import {
  appendDocumentArchive,
  exportDocumentArchive,
  importDocumentArchive,
  type DocumentArchive,
} from "../../utils/documents/documentArchive";
import {
  DOCUMENT_LIMITS,
  normalizeDatabaseDocuments,
} from "../../utils/documents/validation";
import { validateNewPassword } from "../../utils/security/passwordPolicy";
import { generateId } from "../../utils/core/id";
import { registerDocumentDraft } from "../../utils/documents/documentDrafts";
import {
  documentTextExport,
  printDocumentText,
} from "../../utils/documents/documentTextExport";
import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import type {
  DatabaseDocument,
  DatabaseDocuments,
  DocumentAttachment,
  DocumentReference,
  DocumentPerson,
  DocumentTicket,
} from "../../types/documents/document";
import { Select, PasswordInput } from "../ui/forms";
import { ConfirmDialog } from "../ui/dialogs/ConfirmDialog";
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from "../ui/overlays/Modal";
import DocumentReferencePicker from "./DocumentReferencePicker";
import DocumentBlockEditor from "./DocumentBlockEditor";
import ServiceDeskTags from "./ServiceDeskTags";
import {
  serviceDeskTagSuggestions,
  ticketMatchesFilters,
  type TicketFilters,
} from "../../utils/documents/serviceDesk";
import styles from "./documents.module.css";
import CreateDocumentDialog from "./CreateDocumentDialog";
import { useCurrentDatabaseSettings } from "../../hooks/settings/useCurrentDatabaseSettings";
import {
  DOCUMENT_TYPE_OPTIONS,
  assertDocumentTypesAllowedForChange,
  isDocumentTypeEnabled,
} from "../../utils/documents/documentTypePolicy";
import type { DatabaseDocumentType } from "../../types/settings/databaseSettings";
import type { DocumentBlock } from "../../types/documents/document";

const SpreadsheetEditor = dynamic(() => import("./SpreadsheetEditor"), {
  ssr: false,
  loading: () => <p>Loading spreadsheet editor…</p>,
});
const ConnectionIconPicker = dynamic(
  () =>
    import("../connection/editor/ConnectionIconPicker").then(
      (module) => module.ConnectionIconPicker,
    ),
  { ssr: false },
);
type Section = "documents" | "people" | "tickets";
type Request = NonNullable<ConnectionSession["documentsWorkspace"]>;
function pruneAttachments(data: DatabaseDocuments): DatabaseDocuments {
  const used = new Set<string>();
  for (const document of data.documents)
    for (const block of document.blocks) {
      if (block.type === "attachment") used.add(block.attachmentId);
      if (block.type === "identity")
        for (const id of block.attachmentIds) used.add(id);
    }
  return {
    ...data,
    attachments: data.attachments.filter((item) => used.has(item.id)),
  };
}

export default function DocumentsWorkspace({
  sessionId,
  request,
  onOpenConnection,
  onOpenSecurity,
}: {
  sessionId: string;
  request: Request;
  onOpenConnection?: (connection: Connection) => void;
  onOpenSecurity?: () => void;
}) {
  const { state } = useConnections();
  const [valid, setValid] = useState(true);
  const [sheetValidity, setSheetValidity] = useState<Record<string, boolean>>(
    {},
  );
  const allValid = valid && Object.values(sheetValidity).every(Boolean);
  const workspace = useDocumentsWorkspace(request.databaseId, !allValid);
  const typePolicy = useCurrentDatabaseSettings();
  const { data } = workspace;
  const policyReady =
    !typePolicy.loading &&
    !!typePolicy.settings &&
    !!typePolicy.scope &&
    !!workspace.scope &&
    typePolicy.scope.databaseId === workspace.scope.databaseId &&
    typePolicy.scope.generation === workspace.scope.generation;
  const enabledTypes = DOCUMENT_TYPE_OPTIONS.filter(
    (option) =>
      option.type !== "person" &&
      option.type !== "ticket" &&
      policyReady &&
      isDocumentTypeEnabled(typePolicy.settings!, option.type),
  ).map((option) => option.type as DocumentBlock["type"]);
  const [createKey, setCreateKey] = useState<string | null>(null);
  const [createParent, setCreateParent] = useState<string | null>(null);
  const latestPolicy = useRef({
    settings: typePolicy.settings,
    ready: policyReady,
    data,
  });
  latestPolicy.current = {
    settings: typePolicy.settings,
    ready: policyReady,
    data,
  };
  const [section, setSection] = useState<Section>("documents");
  const [selectedId, setSelectedId] = useState("");
  const [folder, setFolder] = useState(request.parentFolderId ?? "*");
  const [query, setQuery] = useState("");
  const [ticketStatus, setTicketStatus] = useState<TicketFilters["status"]>("");
  const [ticketPriority, setTicketPriority] =
    useState<TicketFilters["priority"]>("");
  const [ticketTag, setTicketTag] = useState("");
  const [browsePage, setBrowsePage] = useState(0);
  const [focusReference, setFocusReference] =
    useState<Extract<DocumentReference, { kind: "cell" }>>();
  const [ioBusy, setIoBusy] = useState(false);
  const [ioError, setIoError] = useState("");
  const [confirm, setConfirm] = useState<{
    title: string;
    message: string;
    run: () => void;
    cancel?: () => void;
    destructive?: boolean;
  } | null>(null);
  const [chooseLink, setChooseLink] = useState(false);
  const linkResolver = useRef<
    ((value: DocumentReference | null) => void) | null
  >(null);
  const [archiveMode, setArchiveMode] = useState<"import" | "export" | null>(
    null,
  );
  const [archivePassword, setArchivePassword] = useState("");
  const [archiveFile, setArchiveFile] = useState<File | null>(null);
  const [archiveReview, setArchiveReview] = useState<DocumentArchive | null>(
    null,
  );
  const [archiveError, setArchiveError] = useState("");
  const [textMode, setTextMode] = useState<"print" | "export" | null>(null);
  const [includeSensitive, setIncludeSensitive] = useState(false);
  const printCleanup = useRef<(() => void) | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const access = useRef(workspace.accessKey);
  access.current = workspace.accessKey;
  const live = useRef(true);
  const selection = useRef({ section, selectedId });
  selection.current = { section, selectedId };
  const consumed = useRef("");
  const busy = workspace.busy || ioBusy;
  const guard = useRef({
    databaseId: request.databaseId,
    dirty: false,
    busy: false,
    revision: 0,
  });
  const previousDraft = useRef(data);
  if (previousDraft.current !== data) {
    previousDraft.current = data;
    guard.current.revision += 1;
  }
  guard.current = {
    ...guard.current,
    databaseId: request.databaseId,
    dirty: workspace.dirty || !allValid,
    busy,
  };
  const pendingConfirm = useRef(confirm);
  pendingConfirm.current = confirm;
  useEffect(
    () => registerDocumentDraft(sessionId, () => guard.current),
    [sessionId],
  );
  const currentDocument = data?.documents.find(
    (item) => item.id === selectedId,
  );
  const currentPerson = data?.people.find((item) => item.id === selectedId);
  const currentTicket = data?.tickets.find((item) => item.id === selectedId);
  const folders = state.connections.filter((item) => item.isGroup);
  const active = (key: string) =>
    live.current && !!key && access.current === key;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      linkResolver.current?.(null);
      linkResolver.current = null;
      pendingConfirm.current?.cancel?.();
      printCleanup.current?.();
    };
  }, []);
  useEffect(() => {
    if (!data || consumed.current === request.requestId) return;
    if (!allValid) return;
    consumed.current = request.requestId;
    setSection("documents");
    setFolder(request.parentFolderId ?? "*");
    if (request.create) {
      const parent =
        request.parentFolderId &&
        folders.some((item) => item.id === request.parentFolderId)
          ? request.parentFolderId
          : null;
      setCreateParent(parent);
      setCreateKey(workspace.accessKey);
    } else setSelectedId(request.documentId ?? "");
  }, [data, request, workspace, folders, allValid]);

  useEffect(() => {
    setSheetValidity({});
    setValid(true);
  }, [workspace.accessKey, selectedId]);
  useEffect(() => {
    setQuery("");
    setTicketStatus("");
    setTicketPriority("");
    setTicketTag("");
    setBrowsePage(0);
    setCreateKey(null);
  }, [workspace.accessKey]);

  const clearFilters = () => {
    setQuery("");
    setTicketStatus("");
    setTicketPriority("");
    setTicketTag("");
    setBrowsePage(0);
  };
  const requireType = (type: DatabaseDocumentType) => {
    const current = latestPolicy.current;
    if (!current.ready || !current.settings)
      throw new Error(
        "Wait for this database’s document-type settings to load, or retry in Current Database settings.",
      );
    if (!isDocumentTypeEnabled(current.settings, type))
      throw new Error(
        "This type is disabled for new content in this database. Enable it in Settings → Current Database → Document types. Existing records remain available.",
      );
  };
  const assertAllowed = (next: DatabaseDocuments) => {
    const current = latestPolicy.current;
    if (!current.ready || !current.settings || !current.data)
      throw new Error(
        "The owning database’s document-type settings are unavailable. Reload before adding content.",
      );
    assertDocumentTypesAllowedForChange(current.settings, current.data, next);
  };
  const createDocument = (entry: DatabaseDocument) => {
    if (!createKey || !active(createKey) || busy || !allValid || !data) return;
    const next = normalizeDatabaseDocuments({
      ...data,
      documents: [...data.documents, entry],
    });
    assertAllowed(next);
    if (
      entry.parentFolderId &&
      !folders.some((item) => item.id === entry.parentFolderId)
    )
      throw new Error(
        "The selected folder is no longer available in this database.",
      );
    workspace.update(() => next);
    setSelectedId(entry.id);
    setSection("documents");
    setFolder(entry.parentFolderId ?? "*");
    clearFilters();
    setCreateKey(null);
  };

  const pickReference = useCallback(
    () =>
      new Promise<DocumentReference | null>((resolve) => {
        linkResolver.current?.(null);
        linkResolver.current = resolve;
        setChooseLink(true);
      }),
    [],
  );
  const finishReference = (reference: DocumentReference | null) => {
    setChooseLink(false);
    linkResolver.current?.(reference);
    linkResolver.current = null;
  };
  const follow = (reference: DocumentReference) => {
    if (!allValid) {
      setIoError(
        "Review the pending editor changes before leaving this document.",
      );
      return;
    }
    if (reference.databaseId !== request.databaseId) {
      setIoError(
        "This link belongs to another database. Open that database explicitly; records are never resolved against a different owner.",
      );
      return;
    }
    if (reference.kind === "connection") {
      const connection = state.connections.find(
        (item) => item.id === reference.id && !item.isGroup,
      );
      if (!connection) {
        setIoError("The linked connection is unavailable or was deleted.");
        return;
      }
      if (!onOpenConnection) {
        setIoError(
          "Return this workspace to the main window to open a connection.",
        );
        return;
      }
      onOpenConnection(connection);
      return;
    }
    const target =
      reference.kind === "person"
        ? data?.people
        : reference.kind === "ticket"
          ? data?.tickets
          : data?.documents;
    if (!target?.some((item) => item.id === reference.id)) {
      setIoError("The linked record is unavailable or was deleted.");
      return;
    }
    setSection(
      reference.kind === "person"
        ? "people"
        : reference.kind === "ticket"
          ? "tickets"
          : "documents",
    );
    setFolder("*");
    clearFilters();
    setSelectedId(reference.id);
    setFocusReference(reference.kind === "cell" ? reference : undefined);
  };
  const referenceLabel = (reference: DocumentReference) => {
    if (reference.databaseId !== request.databaseId)
      return `Other database · ${reference.kind}`;
    if (reference.kind === "connection")
      return (
        state.connections.find((item) => item.id === reference.id)?.name ??
        "Missing connection"
      );
    if (reference.kind === "person")
      return (
        data?.people.find((item) => item.id === reference.id)?.name ??
        "Missing person"
      );
    if (reference.kind === "ticket")
      return (
        data?.tickets.find((item) => item.id === reference.id)?.title ??
        "Missing ticket"
      );
    return `${data?.documents.find((item) => item.id === reference.id)?.name ?? "Missing document"}${reference.kind === "cell" ? ` · ${reference.address}` : ""}`;
  };
  const updateDocument = (patch: Partial<DatabaseDocument>) => {
    if (!currentDocument) return;
    if (
      patch.blocks &&
      data &&
      patch.blocks.some(
        (block) =>
          !currentDocument.blocks.some(
            (old) => old.id === block.id && old.type === block.type,
          ),
      )
    ) {
      try {
        assertAllowed({
          ...data,
          documents: data.documents.map((entry) =>
            entry.id === currentDocument.id ? { ...entry, ...patch } : entry,
          ),
        });
      } catch (cause) {
        setIoError(
          cause instanceof Error
            ? cause.message
            : "The block could not be added.",
        );
        return;
      }
    }
    workspace.update((previous) =>
      pruneAttachments({
        ...previous,
        documents: previous.documents.map((entry) =>
          entry.id === currentDocument.id
            ? { ...entry, ...patch, updatedAt: new Date().toISOString() }
            : entry,
        ),
      }),
    );
  };
  const updatePerson = (patch: Partial<DocumentPerson>) =>
    workspace.update((previous) => ({
      ...previous,
      people: previous.people.map((entry) =>
        entry.id === selectedId ? { ...entry, ...patch } : entry,
      ),
    }));
  const updateTicket = (patch: Partial<DocumentTicket>) =>
    workspace.update((previous) => ({
      ...previous,
      tickets: previous.tickets.map((entry) =>
        entry.id === selectedId ? { ...entry, ...patch } : entry,
      ),
    }));
  const add = () => {
    const id = generateId();
    if (section === "documents") {
      setCreateParent(
        folders.some((item) => item.id === folder) ? folder : null,
      );
      setCreateKey(workspace.accessKey);
      return;
    } else if (section === "people") {
      try {
        requireType("person");
      } catch (cause) {
        setIoError((cause as Error).message);
        return;
      }
      workspace.update((previous) => ({
        ...previous,
        people: [
          ...previous.people,
          {
            id,
            name: "New person",
            email: "",
            phone: "",
            organization: "",
            notes: "",
            references: [],
            tags: [],
          },
        ],
      }));
      setSelectedId(id);
    } else {
      try {
        requireType("ticket");
      } catch (cause) {
        setIoError((cause as Error).message);
        return;
      }
      workspace.update((previous) => ({
        ...previous,
        tickets: [
          ...previous.tickets,
          {
            id,
            title: "New ticket",
            status: "open",
            priority: "normal",
            description: "",
            references: [],
            tags: [],
          },
        ],
      }));
      setSelectedId(id);
    }
    clearFilters();
  };
  const remove = () =>
    setConfirm({
      title: "Delete this record?",
      message:
        "This removes the record when you save. Existing links may become unavailable. Document records are not kept in the connection recycle bin.",
      destructive: true,
      run: () => {
        workspace.update((previous) =>
          pruneAttachments({
            ...previous,
            [section]: previous[section].filter(
              (entry) => entry.id !== selectedId,
            ),
          }),
        );
        setSelectedId("");
      },
    });
  const attach = async (file: File): Promise<DocumentAttachment | null> => {
    requireType("attachment");
    const key = access.current;
    if (!active(key) || file.size > DOCUMENT_LIMITS.attachmentBytes)
      throw new Error("Choose a supported attachment up to 4 MB.");
    const attachment = await createDocumentAttachment(
      new Uint8Array(await file.arrayBuffer()),
      file.name,
      file.type as DocumentAttachment["mimeType"],
    );
    if (!active(key)) return null;
    requireType("attachment");
    workspace.update((previous) => ({
      ...previous,
      attachments: [...previous.attachments, attachment],
    }));
    return attachment;
  };
  const saveFile = async (
    name: string,
    bytes: Uint8Array,
    key: string,
  ): Promise<"saved" | "cancelled"> => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    if (!active(key)) return "cancelled";
    const extension = name.split(".").pop() ?? "bin";
    const path = await save({
      title: "Export document data",
      defaultPath: name.replace(/[\\/:*?"<>|\p{Cc}]/gu, "_"),
      filters: [{ name: "Document file", extensions: [extension] }],
    });
    if (!path || !active(key)) return "cancelled";
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    if (!active(key)) return "cancelled";
    await writeFile(path, bytes);
    return "saved";
  };
  const importSpreadsheet = async () => {
    const key = access.current;
    const { open } = await import("@tauri-apps/plugin-dialog");
    if (!active(key)) return null;
    const path = await open({
      title: "Import spreadsheet",
      multiple: false,
      directory: false,
      filters: [{ name: "Spreadsheet", extensions: ["xlsx", "csv"] }],
    });
    if (!path || typeof path !== "string" || !active(key)) return null;
    const { stat, readFile } = await import("@tauri-apps/plugin-fs");
    const metadata = await stat(path);
    if (!active(key)) return null;
    if (metadata.size > 8 * 1024 * 1024)
      throw new Error("Spreadsheet imports are limited to 8 MB.");
    const bytes = await readFile(path);
    if (!active(key)) return null;
    return { name: path.split(/[\\/]/).pop() ?? "workbook.xlsx", bytes };
  };
  const textAction = async () => {
    const key = access.current;
    if (!currentDocument || !active(key)) return;
    const text = documentTextExport(currentDocument, includeSensitive);
    setIoBusy(true);
    try {
      if (textMode === "print") {
        printCleanup.current?.();
        printCleanup.current = printDocumentText(text, (message) => {
          if (active(key)) setIoError(message);
        });
      } else
        await saveFile(
          `${currentDocument.name || "document"}.md`,
          new TextEncoder().encode(text),
          key,
        );
      if (active(key)) {
        setTextMode(null);
        setIncludeSensitive(false);
      }
    } catch (cause) {
      if (active(key))
        setIoError(cause instanceof Error ? cause.message : "Export failed.");
    } finally {
      if (active(key)) setIoBusy(false);
    }
  };
  const closeArchive = () => {
    if (ioBusy) return;
    setArchiveMode(null);
    setArchivePassword("");
    setArchiveFile(null);
    setArchiveReview(null);
    setArchiveError("");
  };
  const archiveAction = async () => {
    const key = access.current;
    if (!data || !active(key) || ioBusy) return;
    setIoBusy(true);
    setArchiveError("");
    try {
      if (archiveMode === "export") {
        await validateNewPassword(archivePassword, "export");
        if (!active(key)) return;
        const content = await exportDocumentArchive(
          data,
          request.databaseId,
          archivePassword,
        );
        if (!active(key)) return;
        await saveFile(
          "documents.sorngdocs",
          new TextEncoder().encode(content),
          key,
        );
        if (active(key)) {
          setArchiveMode(null);
          setArchivePassword("");
        }
      } else if (archiveFile) {
        if (archiveFile.size > 48 * 1024 * 1024)
          throw new Error("Document archives are limited to 48 MB.");
        const review = await importDocumentArchive(
          await archiveFile.text(),
          archivePassword,
        );
        if (active(key)) {
          setArchiveReview(review);
          setArchivePassword("");
        }
      }
    } catch (cause) {
      if (active(key))
        setArchiveError(
          cause instanceof Error
            ? cause.message
            : "The archive could not be processed.",
        );
    } finally {
      if (active(key)) setIoBusy(false);
    }
  };
  const importFile = async (file: File) => {
    if (file.name.toLowerCase().endsWith(".sorngdocs")) {
      setArchiveFile(file);
      setArchiveMode("import");
      setArchiveError("");
      return;
    }
    const key = access.current;
    if (!data || !active(key)) return;
    setIoBusy(true);
    setIoError("");
    try {
      const doc = createEmptyDocument(
        file.name,
        folders.some((item) => item.id === folder) ? folder : null,
      );
      let attachment: DocumentAttachment | null = null;
      if (/\.(md|markdown|txt)$/i.test(file.name)) {
        if (file.size > 64 * 1024)
          throw new Error("Text imports are limited to 64 KB per block.");
        doc.blocks = [
          {
            id: generateId(),
            type: file.name.endsWith(".txt") ? "note" : "markdown",
            text: await file.text(),
          },
        ];
      } else {
        if (file.size > DOCUMENT_LIMITS.attachmentBytes)
          throw new Error("Attachments are limited to 4 MB.");
        attachment = await createDocumentAttachment(
          new Uint8Array(await file.arrayBuffer()),
          file.name,
          file.type as DocumentAttachment["mimeType"],
        );
        doc.blocks = [
          {
            id: generateId(),
            type: "attachment",
            attachmentId: attachment.id,
            caption: "",
          },
        ];
      }
      if (!active(key)) return;
      const next = normalizeDatabaseDocuments({
        ...data,
        documents: [...data.documents, doc],
        attachments: attachment
          ? [...data.attachments, attachment]
          : data.attachments,
      });
      assertAllowed(next);
      workspace.update(() => next);
      setSection("documents");
      setSelectedId(doc.id);
      setQuery("");
    } catch (cause) {
      if (active(key))
        setIoError(
          cause instanceof Error
            ? cause.message
            : "The file could not be imported.",
        );
    } finally {
      if (active(key)) setIoBusy(false);
    }
  };

  if (!data)
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-lg space-y-3 text-center">
          <ShieldCheck className="mx-auto h-9 w-9 text-primary" />
          <h2 className="text-lg font-semibold">
            {workspace.busy
              ? "Opening protected documents…"
              : "Documents need database protection"}
          </h2>
          <p
            role={workspace.error ? "alert" : "status"}
            className="text-sm text-[var(--color-textSecondary)]"
          >
            {workspace.error ||
              "Open and unlock the owning database in the desktop app. Documents need one verified protection layer: managed protection under Security → Current database, or applicable global Connections encryption with its key unlocked and the existing database file encrypted. An OS-vaulted global key qualifies when that encryption is active; a stored or unlocked key alone is not enough."}
          </p>
          <div className="flex justify-center gap-2">
            <button
              className="sor-btn sor-btn-secondary"
              disabled={workspace.busy}
              onClick={() => void workspace.reload()}
            >
              Retry
            </button>
            {onOpenSecurity && (
              <button
                className="sor-btn sor-btn-primary"
                onClick={onOpenSecurity}
              >
                Database security
              </button>
            )}
          </div>
        </div>
      </div>
    );

  const records =
    section === "documents"
      ? data.documents
          .filter(
            (entry) =>
              folder === "*" || (entry.parentFolderId ?? "") === folder,
          )
          .map((entry) => ({
            id: entry.id,
            label: entry.name,
            tags: [] as string[],
            search: entry.name,
            detail: entry.parentFolderId
              ? (folders.find((item) => item.id === entry.parentFolderId)
                  ?.name ?? "Unavailable folder")
              : "Database root",
          }))
      : section === "people"
        ? data.people.map((entry) => ({
            id: entry.id,
            label: entry.name,
            detail: entry.organization || entry.email,
            tags: entry.tags ?? [],
            search: `${entry.name} ${entry.organization} ${entry.email} ${entry.phone} ${entry.notes} ${(entry.tags ?? []).join(" ")}`,
          }))
        : data.tickets
            .filter((entry) =>
              ticketMatchesFilters(entry, {
                text: query,
                status: ticketStatus,
                priority: ticketPriority,
                tag: ticketTag,
              }),
            )
            .map((entry) => ({
              id: entry.id,
              label: entry.title,
              detail: `${entry.status} · ${entry.priority}`,
              tags: entry.tags ?? [],
              search: `${entry.title} ${entry.description} ${(entry.tags ?? []).join(" ")}`,
            }));
  const visible = records
    .filter(
      (entry) =>
        section === "tickets" ||
        `${entry.search} ${entry.detail}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => a.label.localeCompare(b.label));
  const ticketTags = serviceDeskTagSuggestions(data.tickets);
  const tagSuggestions = serviceDeskTagSuggestions([
    ...data.people,
    ...data.tickets,
  ]);
  const lastBrowsePage = Math.max(0, Math.ceil(visible.length / 50) - 1);
  const currentBrowsePage = Math.min(browsePage, lastBrowsePage);
  const browseRows = visible.slice(
    currentBrowsePage * 50,
    (currentBrowsePage + 1) * 50,
  );
  const references =
    section === "people"
      ? currentPerson?.references
      : currentTicket?.references;
  const updateReferences = (next: DocumentReference[]) =>
    section === "people"
      ? updatePerson({ references: next })
      : updateTicket({ references: next });
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-[var(--color-background)] text-[var(--color-text)]"
      data-testid="documents-workspace"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <FileText size={18} />
            Documents
          </h2>
          <p className="text-xs text-[var(--color-textMuted)]">
            {workspace.dirty || !allValid
              ? "Unsaved changes"
              : "Saved in the protected database"}{" "}
            · Documents, people and service desk
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="sor-btn sor-btn-secondary"
            disabled={busy || !allValid}
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={14} />
            Import
          </button>
          <button
            className="sor-btn sor-btn-secondary"
            disabled={busy || !allValid}
            onClick={() => {
              setArchiveMode("export");
              setArchiveError("");
            }}
          >
            <Download size={14} />
            Protected export
          </button>
          <button
            className="sor-btn sor-btn-secondary"
            disabled={busy}
            onClick={() =>
              workspace.dirty || !allValid
                ? setConfirm({
                    title: "Discard unsaved changes?",
                    message:
                      "This reloads the saved library. Private drafts cannot be recovered after discarding.",
                    destructive: true,
                    run: () => {
                      setSheetValidity({});
                      setValid(true);
                      void workspace.reload();
                    },
                  })
                : void workspace.reload()
            }
          >
            Reload
          </button>
          <button
            className="sor-btn sor-btn-primary"
            disabled={busy || !workspace.dirty || !allValid || workspace.stale}
            onClick={() => void workspace.save()}
          >
            <Save size={14} />
            {workspace.busy ? "Saving…" : "Save"}
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".sorngdocs,.md,.markdown,.txt,.pdf,.png,.jpg,.jpeg,.webp"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void importFile(file);
          }}
        />
      </header>
      {(workspace.error || ioError || workspace.stale) && (
        <div
          role="alert"
          className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm"
        >
          {workspace.error ||
            ioError ||
            "The saved library changed. Keep or export your draft, then reload before editing again."}
          {ioError && (
            <button className="ml-3 underline" onClick={() => setIoError("")}>
              Dismiss
            </button>
          )}
        </div>
      )}
      {(!policyReady || typePolicy.error) && (
        <p
          role={typePolicy.error ? "alert" : "status"}
          className="px-4 py-2 text-xs text-[var(--color-textMuted)]"
        >
          {typePolicy.error ||
            "Loading this database’s document-type settings…"}{" "}
          Existing records remain visible.
          {typePolicy.error && (
            <button
              type="button"
              className="sor-btn sor-btn-secondary ml-2"
              onClick={() => void typePolicy.reload()}
            >
              Retry settings
            </button>
          )}
        </p>
      )}
      <nav
        className="flex gap-1 border-b border-[var(--color-border)] px-3 py-2"
        aria-label="Document workspace sections"
      >
        {(
          [
            { id: "documents", label: "Documents", icon: FileText },
            { id: "people", label: "People", icon: Users },
            { id: "tickets", label: "Service desk", icon: Ticket },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            className={`sor-btn ${section === item.id ? "sor-btn-primary" : "sor-btn-secondary"}`}
            aria-pressed={section === item.id}
            disabled={busy || !allValid}
            onClick={() => {
              setSection(item.id);
              setSelectedId("");
              setQuery("");
              setValid(true);
            }}
          >
            <item.icon size={14} />
            {item.label}
          </button>
        ))}
      </nav>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 min-w-48 shrink-0 flex-col gap-3 border-r border-[var(--color-border)] p-3">
          <label className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-3 text-[var(--color-textMuted)]"
            />
            <input
              className="sor-form-input !pl-9"
              aria-label="Search documents and records"
              placeholder={
                section === "documents"
                  ? "Search names and folders"
                  : section === "tickets"
                    ? "Search tickets and tags"
                    : "Search people and tags"
              }
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setBrowsePage(0);
              }}
            />
          </label>
          {section === "documents" && (
            <Select
              aria-label="Document folder"
              value={folder}
              onChange={(value) => {
                setFolder(value);
                setBrowsePage(0);
              }}
              options={[
                { value: "*", label: "All folders" },
                { value: "", label: "Database root" },
                ...folders.map((item) => ({
                  value: item.id,
                  label: item.name,
                })),
              ]}
            />
          )}
          {section === "tickets" && (
            <div className={styles.ticketFilters} aria-label="Ticket filters">
              <Select
                label="Filter ticket status"
                variant="form-sm"
                value={ticketStatus}
                onChange={(value) => {
                  setTicketStatus(value as TicketFilters["status"]);
                  setBrowsePage(0);
                }}
                options={[
                  { value: "", label: "All statuses" },
                  { value: "open", label: "Open" },
                  { value: "in-progress", label: "In progress" },
                  { value: "resolved", label: "Resolved" },
                  { value: "closed", label: "Closed" },
                ]}
              />
              <Select
                label="Filter ticket priority"
                variant="form-sm"
                value={ticketPriority}
                onChange={(value) => {
                  setTicketPriority(value as TicketFilters["priority"]);
                  setBrowsePage(0);
                }}
                options={[
                  { value: "", label: "All priorities" },
                  { value: "low", label: "Low" },
                  { value: "normal", label: "Normal" },
                  { value: "high", label: "High" },
                  { value: "urgent", label: "Urgent" },
                ]}
              />
              <Select
                label="Filter ticket tag"
                variant="form-sm"
                searchable
                value={ticketTag}
                onChange={(value) => {
                  setTicketTag(value);
                  setBrowsePage(0);
                }}
                options={[
                  { value: "", label: "All tags" },
                  ...ticketTags.map((tag) => ({ value: tag, label: tag })),
                ]}
              />
              <div className="flex items-center justify-between gap-2">
                <span role="status">
                  {visible.length} of {data.tickets.length} tickets
                </span>
                {(query || ticketStatus || ticketPriority || ticketTag) && (
                  <button
                    type="button"
                    className="sor-btn sor-btn-secondary"
                    onClick={clearFilters}
                  >
                    <X size={12} />
                    Clear filters
                  </button>
                )}
              </div>
            </div>
          )}
          <button
            className="sor-btn sor-btn-secondary"
            disabled={
              busy ||
              !allValid ||
              !policyReady ||
              (section === "documents" && enabledTypes.length === 0) ||
              (section !== "documents" &&
                !isDocumentTypeEnabled(
                  typePolicy.settings!,
                  section === "people" ? "person" : "ticket",
                ))
            }
            onClick={add}
          >
            <Plus size={14} />
            New{" "}
            {section === "documents"
              ? "document"
              : section === "people"
                ? "person"
                : "ticket"}
          </button>
          <div
            className="min-h-0 flex-1 space-y-1 overflow-auto"
            aria-label="Records"
          >
            {browseRows.map((entry) => (
              <button
                key={entry.id}
                aria-label={`Open ${entry.label || "Untitled"}`}
                disabled={busy || !allValid}
                className={`w-full rounded border px-3 py-2 text-left ${selectedId === entry.id ? "border-primary/50 bg-primary/10" : "border-transparent hover:bg-[var(--color-surfaceHover)]"}`}
                onClick={() => {
                  setSelectedId(entry.id);
                  setValid(true);
                }}
              >
                <span className="block truncate text-sm font-medium">
                  {entry.label || "Untitled"}
                </span>
                <span className="block truncate text-xs text-[var(--color-textMuted)]">
                  {entry.detail}
                </span>
                {!!entry.tags.length && (
                  <span className={`${styles.tags} mt-1`}>
                    {entry.tags.slice(0, 3).map((tag) => (
                      <span key={tag} className={styles.tag}>
                        {tag}
                      </span>
                    ))}
                    {entry.tags.length > 3 && (
                      <span className={styles.tag}>
                        +{entry.tags.length - 3}
                      </span>
                    )}
                  </span>
                )}
              </button>
            ))}
            {!visible.length && (
              <p className="p-2 text-sm text-[var(--color-textMuted)]">
                {(section === "tickets" ? data.tickets.length : records.length)
                  ? "No matching records. Clear the search or filters."
                  : "No records in this view. Add a record or import a document."}
              </p>
            )}
          </div>
          {lastBrowsePage > 0 && (
            <div className="flex items-center justify-between gap-2 text-xs">
              <button
                aria-label="Previous records page"
                className="sor-btn sor-btn-secondary"
                disabled={currentBrowsePage === 0}
                onClick={() => setBrowsePage(currentBrowsePage - 1)}
              >
                Previous
              </button>
              <span>
                {currentBrowsePage + 1} / {lastBrowsePage + 1}
              </span>
              <button
                aria-label="Next records page"
                className="sor-btn sor-btn-secondary"
                disabled={currentBrowsePage === lastBrowsePage}
                onClick={() => setBrowsePage(currentBrowsePage + 1)}
              >
                Next
              </button>
            </div>
          )}
        </aside>
        <main className="min-w-0 flex-1 overflow-auto p-4">
          {selectedId &&
          ((section === "documents" && currentDocument) ||
            (section === "people" && currentPerson) ||
            (section === "tickets" && currentTicket)) ? (
            <div className="mx-auto max-w-6xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">
                  {section === "documents"
                    ? "Document"
                    : section === "people"
                      ? "Person"
                      : "Service desk ticket"}
                </h3>
                <div className="flex gap-2">
                  <button
                    className="sor-btn sor-btn-secondary"
                    disabled={busy || !allValid}
                    onClick={() => setSelectedId("")}
                  >
                    <FolderOpen size={14} /> Browse
                  </button>
                  {section === "documents" && currentDocument && (
                    <>
                      <button
                        className="sor-btn sor-btn-secondary"
                        disabled={busy || !allValid}
                        onClick={() => {
                          setIncludeSensitive(false);
                          setTextMode("print");
                        }}
                      >
                        <Printer size={14} />
                        Print
                      </button>
                      <button
                        className="sor-btn sor-btn-secondary"
                        disabled={busy || !allValid}
                        onClick={() => {
                          setIncludeSensitive(false);
                          setTextMode("export");
                        }}
                      >
                        <Download size={14} />
                        Export text
                      </button>
                    </>
                  )}
                  <button
                    className="sor-btn sor-btn-secondary text-error"
                    disabled={busy}
                    onClick={remove}
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                </div>
              </div>
              {section === "documents" && currentDocument && (
                <>
                  <label className="block space-y-1 text-sm">
                    Name
                    <input
                      className="sor-form-input"
                      value={currentDocument.name}
                      maxLength={256}
                      disabled={busy}
                      onChange={(event) =>
                        updateDocument({ name: event.target.value })
                      }
                    />
                  </label>
                  <div className="flex flex-wrap items-center gap-3">
                    <FolderOpen size={15} />
                    <Select
                      aria-label="Owning folder"
                      value={currentDocument.parentFolderId ?? ""}
                      disabled={busy}
                      onChange={(value) =>
                        updateDocument({ parentFolderId: value || null })
                      }
                      options={[
                        { value: "", label: "Database root" },
                        ...folders.map((item) => ({
                          value: item.id,
                          label: item.name,
                        })),
                      ]}
                    />
                    <details className="min-w-64">
                      <summary className="cursor-pointer text-sm">
                        Choose document icon
                      </summary>
                      <ConnectionIconPicker
                        connection={{
                          protocol: "http",
                          icon: currentDocument.icon as Connection["icon"],
                        }}
                        onChange={(icon) =>
                          updateDocument({ icon: icon ?? "file-text" })
                        }
                      />
                    </details>
                  </div>
                  <DocumentBlockEditor
                    enabledTypes={enabledTypes}
                    key={`${workspace.accessKey}:${currentDocument.id}`}
                    documentKey={`${workspace.accessKey}:${currentDocument.id}`}
                    blocks={currentDocument.blocks}
                    attachments={data.attachments}
                    readOnly={busy}
                    onChange={(blocks) => {
                      updateDocument({ blocks });
                      setSheetValidity((previous) =>
                        Object.fromEntries(
                          Object.entries(previous).filter(([id]) =>
                            blocks.some((block) => block.id === id),
                          ),
                        ),
                      );
                    }}
                    onAttach={attach}
                    onReference={follow}
                    onChooseReference={pickReference}
                    onValidityChange={setValid}
                    renderSpreadsheet={(block, onChange, readOnly) => (
                      <SpreadsheetEditor
                        documentKey={`${workspace.accessKey}:${currentDocument.id}:${block.id}`}
                        workbook={block.workbook}
                        onChange={onChange}
                        readOnly={readOnly}
                        onChooseReference={pickReference}
                        onReference={follow}
                        focusReference={
                          focusReference?.id === currentDocument.id &&
                          focusReference?.blockId === block.id
                            ? focusReference
                            : undefined
                        }
                        onValidityChange={(value) =>
                          setSheetValidity((previous) =>
                            previous[block.id] === value
                              ? previous
                              : { ...previous, [block.id]: value },
                          )
                        }
                        onImport={importSpreadsheet}
                        onExport={async (file) => {
                          const key = access.current;
                          return new Promise<"saved" | "cancelled">(
                            (resolve, reject) =>
                              setConfirm({
                                title: "Export unprotected spreadsheet?",
                                cancel: () => resolve("cancelled"),
                                message:
                                  "Spreadsheet exports may contain private cell values, notes and links. The exported file is not protected by your database. Continue only to a trusted destination.",
                                run: () => {
                                  void saveFile(file.name, file.bytes, key)
                                    .then(resolve)
                                    .catch((cause) => {
                                      if (active(key))
                                        setIoError(
                                          cause instanceof Error
                                            ? cause.message
                                            : "Export failed.",
                                        );
                                      reject(cause);
                                    });
                                },
                              }),
                          );
                        }}
                      />
                    )}
                  />
                </>
              )}
              {section === "people" && currentPerson && (
                <>
                  {(["name", "email", "phone", "organization"] as const).map(
                    (field) => (
                      <label
                        className="block space-y-1 text-sm capitalize"
                        key={field}
                      >
                        {field}
                        <input
                          className="sor-form-input"
                          value={currentPerson[field]}
                          disabled={busy}
                          onChange={(event) =>
                            updatePerson({ [field]: event.target.value })
                          }
                        />
                      </label>
                    ),
                  )}
                  <label className="block space-y-1 text-sm">
                    Notes
                    <textarea
                      className="sor-form-input min-h-32"
                      value={currentPerson.notes}
                      disabled={busy}
                      onChange={(event) =>
                        updatePerson({ notes: event.target.value })
                      }
                    />
                  </label>
                  <p className="text-xs text-[var(--color-textMuted)]">
                    These are local contact records, not operating-system or
                    remote application accounts.
                  </p>
                  <ServiceDeskTags
                    key={`${workspace.accessKey}:${currentPerson.id}`}
                    tags={currentPerson.tags ?? []}
                    suggestions={tagSuggestions}
                    disabled={busy}
                    onChange={(tags) => updatePerson({ tags })}
                  />
                </>
              )}
              {section === "tickets" && currentTicket && (
                <>
                  <label className="block space-y-1 text-sm">
                    Title
                    <input
                      className="sor-form-input"
                      value={currentTicket.title}
                      disabled={busy}
                      onChange={(event) =>
                        updateTicket({ title: event.target.value })
                      }
                    />
                  </label>
                  <div className="flex flex-wrap gap-3">
                    <Select
                      label="Ticket status"
                      value={currentTicket.status}
                      disabled={busy}
                      onChange={(value) =>
                        updateTicket({
                          status: value as DocumentTicket["status"],
                        })
                      }
                      options={[
                        { value: "open", label: "Open" },
                        { value: "in-progress", label: "In progress" },
                        { value: "resolved", label: "Resolved" },
                        { value: "closed", label: "Closed" },
                      ]}
                    />
                    <Select
                      label="Ticket priority"
                      value={currentTicket.priority}
                      disabled={busy}
                      onChange={(value) =>
                        updateTicket({
                          priority: value as DocumentTicket["priority"],
                        })
                      }
                      options={[
                        { value: "low", label: "Low" },
                        { value: "normal", label: "Normal" },
                        { value: "high", label: "High" },
                        { value: "urgent", label: "Urgent" },
                      ]}
                    />
                  </div>
                  <label className="block space-y-1 text-sm">
                    Description
                    <textarea
                      className="sor-form-input min-h-40"
                      value={currentTicket.description}
                      disabled={busy}
                      onChange={(event) =>
                        updateTicket({ description: event.target.value })
                      }
                    />
                  </label>
                  <ServiceDeskTags
                    key={`${workspace.accessKey}:${currentTicket.id}`}
                    tags={currentTicket.tags ?? []}
                    suggestions={tagSuggestions}
                    disabled={busy}
                    onChange={(tags) => updateTicket({ tags })}
                  />
                </>
              )}
              {section !== "documents" && references && (
                <section className="space-y-2">
                  <h4 className="text-sm font-medium">Linked records</h4>
                  {references.map((reference, index) => (
                    <div
                      key={`${reference.kind}:${reference.id}:${index}`}
                      className="flex items-center gap-2"
                    >
                      <button
                        className="sor-btn sor-btn-secondary"
                        onClick={() => follow(reference)}
                      >
                        <Link2 size={14} />
                        {referenceLabel(reference)}
                      </button>
                      <button
                        className="sor-btn sor-btn-secondary"
                        aria-label="Remove link"
                        disabled={busy}
                        onClick={() =>
                          updateReferences(
                            references.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    className="sor-btn sor-btn-secondary"
                    disabled={busy}
                    onClick={async () => {
                      const id = selectedId;
                      const ref = await pickReference();
                      if (
                        ref &&
                        id === selection.current.selectedId &&
                        section === selection.current.section &&
                        active(workspace.accessKey)
                      )
                        updateReferences([...references, ref]);
                    }}
                  >
                    <Plus size={14} />
                    Link connection, document, person, ticket or cell
                  </button>
                </section>
              )}
            </div>
          ) : (
            <div
              className="mx-auto flex h-full min-h-0 max-w-6xl flex-col gap-4"
              data-testid="documents-browser"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="flex items-center gap-2 font-semibold">
                    <FolderOpen size={18} />{" "}
                    {section === "documents"
                      ? "Browse documents"
                      : section === "people"
                        ? "Browse people"
                        : "Browse service desk"}
                  </h3>
                  <p className="mt-1 text-xs text-[var(--color-textMuted)]">
                    {visible.length}{" "}
                    {visible.length === 1 ? "record" : "records"} · Current
                    protected database
                  </p>
                </div>
                <span className="text-xs text-[var(--color-textMuted)]">
                  Select a name to open. Search uses metadata only.
                </span>
              </div>
              <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--color-border)]">
                <table
                  className="w-full text-left text-sm"
                  aria-label="Document browser records"
                >
                  <thead className="sticky top-0 bg-[var(--color-surface)] text-xs text-[var(--color-textMuted)]">
                    <tr>
                      <th className="px-4 py-3 font-medium">Name</th>
                      <th className="px-4 py-3 font-medium">
                        {section === "documents"
                          ? "Folder"
                          : section === "people"
                            ? "Organization / email"
                            : "Status / priority"}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {browseRows.map((entry) => (
                      <tr
                        key={entry.id}
                        className="border-t border-[var(--color-border)] hover:bg-[var(--color-surfaceHover)]"
                      >
                        <td className="px-4 py-3">
                          <button
                            className="text-left font-medium text-primary hover:underline break-words"
                            disabled={busy || !allValid}
                            onClick={() => setSelectedId(entry.id)}
                          >
                            {entry.label || "Untitled"}
                          </button>
                        </td>
                        <td className="max-w-64 break-words px-4 py-3 text-[var(--color-textMuted)]">
                          {entry.detail}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!visible.length && (
                  <div className="flex flex-col items-center gap-3 p-10 text-center text-sm text-[var(--color-textMuted)]">
                    <FileText size={32} />
                    <p>
                      {query || folder !== "*"
                        ? "No records match this view. Adjust the search or folder filter."
                        : "Your protected library is ready. Create a record or import a document to get started."}
                    </p>
                  </div>
                )}
              </div>
              {lastBrowsePage > 0 && (
                <div className="flex items-center justify-end gap-3 text-xs">
                  <button
                    className="sor-btn sor-btn-secondary"
                    disabled={currentBrowsePage === 0}
                    onClick={() => setBrowsePage(currentBrowsePage - 1)}
                  >
                    Previous
                  </button>
                  <span>
                    Page {currentBrowsePage + 1} of {lastBrowsePage + 1}
                  </span>
                  <button
                    className="sor-btn sor-btn-secondary"
                    disabled={currentBrowsePage === lastBrowsePage}
                    onClick={() => setBrowsePage(currentBrowsePage + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </main>
      </div>
      {chooseLink && (
        <DocumentReferencePicker
          data={data}
          connections={state.connections}
          databaseId={request.databaseId}
          onClose={finishReference}
        />
      )}
      {createKey === workspace.accessKey && createKey && (
        <CreateDocumentDialog
          key={createKey}
          isOpen
          onClose={() => setCreateKey(null)}
          onCreate={createDocument}
          folders={folders}
          initialParentFolderId={createParent}
          disabled={busy || !allValid || !policyReady}
          enabledTypes={enabledTypes}
        />
      )}
      {confirm && (
        <ConfirmDialog
          isOpen
          title={confirm.title}
          message={confirm.message}
          confirmText="Continue"
          variant={confirm.destructive ? "danger" : "warning"}
          onConfirm={() => {
            const action = confirm.run;
            setConfirm(null);
            action();
          }}
          onCancel={() => {
            confirm.cancel?.();
            setConfirm(null);
          }}
        />
      )}
      {archiveMode && (
        <Modal
          isOpen
          onClose={closeArchive}
          panelClassName="max-w-lg w-full mx-4"
          ariaLabel="Protected document archive"
        >
          <ModalHeader
            title={
              archiveMode === "export"
                ? "Export protected documents"
                : "Import protected documents"
            }
            onClose={closeArchive}
          />
          <ModalBody className="space-y-3">
            <p className="text-sm text-[var(--color-textSecondary)]">
              {archiveMode === "export"
                ? `The archive includes all ${data.documents.length} documents, people, tickets, attachments and any secrets in this workspace. A separate password protects the exported file.`
                : "Decrypt and review the archive before adding it. Existing records are never overwritten; links to connections keep their original database owner."}
            </p>
            {archiveReview ? (
              <p className="text-sm">
                Ready to add {archiveReview.data.documents.length} documents,{" "}
                {archiveReview.data.people.length} people,{" "}
                {archiveReview.data.tickets.length} tickets and{" "}
                {archiveReview.data.attachments.length} attachments.
              </p>
            ) : (
              <label className="block space-y-1 text-sm">
                Archive password
                <PasswordInput
                  value={archivePassword}
                  onChange={(event) => setArchivePassword(event.target.value)}
                  aria-label="Archive password"
                  disabled={ioBusy}
                  placeholder={
                    archiveMode === "export"
                      ? "At least 12 characters"
                      : "Password used for this archive"
                  }
                />
              </label>
            )}
            {archiveError && (
              <p role="alert" className="text-sm text-error">
                {archiveError}
              </p>
            )}
          </ModalBody>
          <ModalFooter>
            <button
              className="sor-btn sor-btn-secondary"
              disabled={ioBusy}
              onClick={closeArchive}
            >
              Cancel
            </button>
            <button
              className="sor-btn sor-btn-primary"
              disabled={ioBusy || (!archiveReview && !archivePassword)}
              onClick={() => {
                if (archiveReview) {
                  try {
                    const next = appendDocumentArchive(
                      data,
                      archiveReview,
                      request.databaseId,
                      folders.some((item) => item.id === folder)
                        ? folder
                        : null,
                    );
                    assertAllowed(next);
                    workspace.update(() => next);
                    closeArchive();
                  } catch (cause) {
                    setArchiveError(
                      cause instanceof Error
                        ? cause.message
                        : "Import exceeds the database limits.",
                    );
                  }
                } else void archiveAction();
              }}
            >
              {ioBusy
                ? "Working…"
                : archiveReview
                  ? "Add to draft"
                  : archiveMode === "export"
                    ? "Choose save location"
                    : "Decrypt and review"}
            </button>
          </ModalFooter>
        </Modal>
      )}
      {textMode && currentDocument && (
        <Modal
          isOpen
          onClose={() => {
            if (!ioBusy) setTextMode(null);
          }}
          panelClassName="max-w-2xl w-full mx-4"
          ariaLabel="Review document output"
        >
          <ModalHeader
            title={
              textMode === "print" ? "Print document" : "Export readable text"
            }
            onClose={() => {
              if (!ioBusy) setTextMode(null);
            }}
          />
          <ModalBody className="space-y-3">
            <p className="text-sm">
              This copy is outside database protection. Structured secrets and
              personal identifiers are redacted by default, but ordinary notes
              and cells may still be private. Attachments, rich formatting and
              diagrams are not rendered in this text copy. Use Protected export
              for a complete, encrypted archive.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={includeSensitive}
                disabled={ioBusy}
                onChange={(event) => setIncludeSensitive(event.target.checked)}
              />
              Include sensitive field values in this copy
            </label>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded border border-[var(--color-border)] p-3 text-xs">
              {documentTextExport(currentDocument, includeSensitive)}
            </pre>
          </ModalBody>
          <ModalFooter>
            <button
              className="sor-btn sor-btn-secondary"
              disabled={ioBusy}
              onClick={() => setTextMode(null)}
            >
              Cancel
            </button>
            <button
              className="sor-btn sor-btn-primary"
              disabled={ioBusy}
              onClick={() => void textAction()}
            >
              {textMode === "print"
                ? "Open system print dialog"
                : "Choose save location"}
            </button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}
