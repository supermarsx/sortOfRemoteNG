import React, { useMemo } from "react";
import {
  ArrowLeft,
  Check,
  Circle,
  Clock3,
  Database,
  Download,
  FolderOpen,
  Layers,
  LoaderCircle,
  Printer,
  Save,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import type { DatabaseDocument } from "../../types/documents/document";
import { Select } from "../ui/forms";
import { DocumentIconPicker } from "./DocumentIconPicker";
import DocumentHistoryControls, {
  type DocumentHistoryControlsProps,
} from "./DocumentHistoryControls";
import styles from "./documentEditorHeader.module.css";

export interface DocumentEditorHeaderProps {
  document: DatabaseDocument;
  folders: ReadonlyArray<{ id: string; name: string; parentId?: string }>;
  scope: "app" | "database";
  busy: boolean;
  saving: boolean;
  dirty: boolean;
  valid: boolean;
  stale: boolean;
  onChange: (patch: Partial<DatabaseDocument>) => void;
  onSave: () => void;
  onBrowse: () => void;
  onPrint: () => void;
  onExport: () => void;
  onDelete: () => void;
  history?: DocumentHistoryControlsProps;
}

/** Document identity and commands; persistence stays in the owning workspace. */
export default function DocumentEditorHeader({
  document,
  folders,
  scope,
  busy,
  saving,
  dirty,
  valid,
  stale,
  onChange,
  onSave,
  onBrowse,
  onPrint,
  onExport,
  onDelete,
  history,
}: DocumentEditorHeaderProps) {
  const root = scope === "app" ? "App-wide root" : "Database root";
  const folderOptions = useMemo(() => {
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    return folders
      .map((folder) => {
        const path = [folder.name];
        const visited = new Set([folder.id]);
        let parentId = folder.parentId;
        while (parentId && !visited.has(parentId)) {
          visited.add(parentId);
          const parent = byId.get(parentId);
          if (!parent) break;
          path.unshift(parent.name);
          parentId = parent.parentId;
        }
        return { value: folder.id, label: path.join(" / "), icon: FolderOpen };
      })
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [folders]);
  const folderId = scope === "app" ? "" : (document.parentFolderId ?? "");
  const missingFolder =
    !!folderId && !folderOptions.some((folder) => folder.value === folderId);
  const location = folderId
    ? (folderOptions.find((folder) => folder.value === folderId)?.label ??
      "Unavailable folder")
    : root;
  const canSave = dirty && valid && !busy && !stale;
  const StatusIcon = saving
    ? LoaderCircle
    : stale || !valid
      ? ShieldAlert
      : dirty
        ? Circle
        : Check;
  const status = saving
    ? "Saving library…"
    : stale
      ? "Reload required · draft retained"
      : !valid
        ? "Review pending changes"
        : dirty
          ? "Unsaved library changes"
          : "Library saved";
  const edited = new Date(document.updatedAt);
  const editedLabel = Number.isFinite(edited.getTime())
    ? edited.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

  return (
    <header className={styles.header} aria-label="Document editor header">
      <div className={styles.identity}>
        <DocumentIconPicker
          value={document.icon}
          variant="compact"
          disabled={busy || stale}
          onChange={(icon) => onChange({ icon })}
        />
        <div className={styles.titleGroup}>
          <div className={styles.breadcrumb} aria-label="Document location">
            <Database size={12} aria-hidden="true" />
            <span>{scope === "app" ? "App-wide" : "Database"}</span>
            <span aria-hidden="true"> / </span>
            <span className={styles.location}>
              {folderId ? location : "Documents"}
            </span>
          </div>
          <input
            className={`sor-form-input ${styles.title}`}
            aria-label="Name"
            placeholder="Untitled document"
            value={document.name}
            maxLength={256}
            disabled={busy || stale}
            spellCheck={false}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </div>
      </div>
      <div className={styles.commandBar}>
        {history && <DocumentHistoryControls {...history} />}
        <button
          type="button"
          className={`sor-btn sor-btn-secondary ${styles.command} ${styles.iconCommand}`}
          data-tooltip="Browse documents"
          disabled={busy || !valid}
          onClick={onBrowse}
        >
          <ArrowLeft size={14} aria-hidden="true" />
          <span className="sr-only">Browse</span>
        </button>
        <div
          className={styles.commands}
          role="group"
          aria-label="Document actions"
        >
          <button
            type="button"
            className={`sor-btn sor-btn-secondary ${styles.command} ${styles.iconCommand}`}
            data-tooltip="Print document"
            disabled={busy || !valid}
            onClick={onPrint}
          >
            <Printer size={14} aria-hidden="true" />
            <span className="sr-only">Print</span>
          </button>
          <button
            type="button"
            className={`sor-btn sor-btn-secondary ${styles.command} ${styles.iconCommand}`}
            data-tooltip="Export document text"
            disabled={busy || !valid}
            onClick={onExport}
          >
            <Download size={14} aria-hidden="true" />
            <span className="sr-only">Export text</span>
          </button>
          <span className={styles.separator} aria-hidden="true" />
          <button
            type="button"
            className={`sor-btn sor-btn-secondary ${styles.command} ${styles.iconCommand} ${styles.delete}`}
            data-tooltip="Delete document"
            disabled={busy || stale}
            onClick={onDelete}
          >
            <Trash2 size={14} aria-hidden="true" />
            <span className="sr-only">Delete</span>
          </button>
          <button
            type="button"
            className={`sor-btn sor-btn-primary ${styles.command}`}
            disabled={!canSave}
            onClick={onSave}
            aria-keyshortcuts="Control+s Meta+s"
          >
            <Save size={14} aria-hidden="true" /> {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
      <div className={styles.metadata}>
        <div className={styles.folder}>
          <span className={styles.label}>Folder</span>
          <Select
            label="Owning folder"
            variant="form-sm"
            className={styles.folderSelect}
            value={folderId}
            searchable
            searchPlaceholder="Search folders…"
            disabled={busy || stale || scope === "app"}
            options={[
              { value: "", label: root, icon: FolderOpen },
              ...(scope === "app" ? [] : folderOptions),
              ...(missingFolder
                ? [
                    {
                      value: folderId,
                      label: "Unavailable folder",
                      disabled: true,
                    },
                  ]
                : []),
            ]}
            onChange={(value) => onChange({ parentFolderId: value || null })}
          />
        </div>
        <span className={styles.detail}>
          <Layers size={13} aria-hidden="true" />
          {document.blocks.length}{" "}
          {document.blocks.length === 1 ? "block" : "blocks"}
        </span>
        {editedLabel && (
          <span className={styles.detail}>
            <Clock3 size={13} aria-hidden="true" />
            Edited <time dateTime={document.updatedAt}>{editedLabel}</time>
          </span>
        )}
        <span
          className={styles.status}
          data-state={stale || !valid ? "warning" : dirty ? "dirty" : "saved"}
          role="status"
        >
          <StatusIcon
            size={13}
            aria-hidden="true"
            className={
              saving ? "animate-spin motion-reduce:animate-none" : undefined
            }
          />
          {status}
        </span>
      </div>
    </header>
  );
}
