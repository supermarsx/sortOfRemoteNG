import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Download,
  File as FileIcon,
  Folder,
  FolderPlus,
  HardDrive,
  Home,
  KeyRound,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
  Unplug,
} from "lucide-react";
import type { ConnectionSession } from "../../types/connection/connection";
import type { FtpEntry } from "../../types/ftp";
import { joinFtpPath, useFTPSession } from "../../hooks/protocol/useFTPSession";
import { EmptyState } from "../ui/display";
import { TextInput } from "../ui/forms";

type FtpManager = ReturnType<typeof useFTPSession>;

const formatFileSize = (bytes: number): string => {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** unitIndex).toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const entryDate = (entry: FtpEntry): string => {
  if (!entry.modified) return "—";
  const date = new Date(entry.modified);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
};

const basename = (path: string): string => {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : "upload";
};

const FtpHeader: React.FC<{ manager: FtpManager }> = ({ manager }) => (
  <div className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
    <div className="flex min-w-0 items-center gap-3">
      <HardDrive size={20} className="shrink-0 text-primary" />
      <div className="min-w-0">
        <div className="truncate font-medium text-[var(--color-text)]">
          FTP — {manager.sessionInfo?.host ?? "connecting"}
        </div>
        <div className="truncate text-xs text-[var(--color-textSecondary)]">
          {manager.sessionInfo?.serverBanner || "Direct native FTP session"}
        </div>
      </div>
    </div>
    <div className="flex items-center gap-3">
      <span
        className={`rounded-full px-2 py-1 text-xs ${
          manager.status === "connected"
            ? "bg-success/15 text-success"
            : manager.status === "error"
              ? "bg-error/15 text-error"
              : "bg-[var(--color-border)] text-[var(--color-textSecondary)]"
        }`}
      >
        {manager.status}
      </span>
      <button
        type="button"
        className="sor-icon-btn-sm"
        aria-label="Disconnect FTP"
        title="Disconnect"
        disabled={manager.status !== "connected"}
        onClick={() => void manager.disconnect().catch(() => undefined)}
      >
        <Unplug size={16} />
      </button>
    </div>
  </div>
);

interface FtpToolbarProps {
  manager: FtpManager;
  pathDraft: string;
  setPathDraft: (value: string) => void;
  onNavigate: () => void;
  onUpload: () => void;
  onDownload: () => void;
  onCreateDirectory: () => void;
  onRename: () => void;
  onDelete: () => void;
  onChmod: () => void;
}

const FtpToolbar: React.FC<FtpToolbarProps> = ({
  manager,
  pathDraft,
  setPathDraft,
  onNavigate,
  onUpload,
  onDownload,
  onCreateDirectory,
  onRename,
  onDelete,
  onChmod,
}) => {
  const hasSelection = Boolean(manager.selectedEntry);
  const hasFileSelection =
    hasSelection && manager.selectedEntry?.kind !== "directory";

  return (
    <div className="space-y-2 border-b border-[var(--color-border)] bg-[var(--color-surfaceHover)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="sor-icon-btn-sm"
          aria-label="FTP home directory"
          title="Home"
          disabled={manager.status !== "connected" || manager.isBusy}
          onClick={() => void manager.loadDirectory("/").catch(() => undefined)}
        >
          <Home size={16} />
        </button>
        <button
          type="button"
          className="sor-icon-btn-sm"
          aria-label="FTP parent directory"
          title="Parent directory"
          disabled={
            manager.status !== "connected" ||
            manager.isBusy ||
            manager.currentPath === "/"
          }
          onClick={() => void manager.navigateUp().catch(() => undefined)}
        >
          <ArrowLeft size={16} />
        </button>
        <button
          type="button"
          className="sor-icon-btn-sm"
          aria-label="Refresh FTP directory"
          title="Refresh"
          disabled={manager.status !== "connected" || manager.isBusy}
          onClick={() => void manager.refreshDirectory().catch(() => undefined)}
        >
          <RefreshCw
            size={16}
            className={manager.isBusy ? "animate-spin" : ""}
          />
        </button>
        <form
          className="flex min-w-64 flex-1 gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onNavigate();
          }}
        >
          <TextInput
            aria-label="FTP remote path"
            variant="form-sm"
            value={pathDraft}
            onChange={setPathDraft}
            disabled={manager.status !== "connected" || manager.isBusy}
            className="min-w-0 flex-1 font-mono"
          />
          <button
            type="submit"
            className="sor-btn sor-btn-secondary"
            disabled={manager.status !== "connected" || manager.isBusy}
          >
            Go
          </button>
        </form>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="sor-btn-primary-sm"
          disabled={manager.status !== "connected" || manager.isBusy}
          onClick={onUpload}
        >
          <Upload size={14} />
          <span>Upload</span>
        </button>
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          disabled={!hasFileSelection || manager.isBusy}
          onClick={onDownload}
        >
          <Download size={14} />
          <span>Download</span>
        </button>
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          disabled={manager.status !== "connected" || manager.isBusy}
          onClick={onCreateDirectory}
        >
          <FolderPlus size={14} />
          <span>New folder</span>
        </button>
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          disabled={!hasSelection || manager.isBusy}
          onClick={onRename}
        >
          <Pencil size={14} />
          <span>Rename</span>
        </button>
        <button
          type="button"
          className="sor-btn sor-btn-secondary"
          disabled={!hasSelection || manager.isBusy}
          onClick={onChmod}
        >
          <KeyRound size={14} />
          <span>Permissions</span>
        </button>
        <button
          type="button"
          className="sor-btn sor-btn-danger"
          disabled={!hasSelection || manager.isBusy}
          onClick={onDelete}
        >
          <Trash2 size={14} />
          <span>Delete</span>
        </button>
      </div>
    </div>
  );
};

const FtpFileTable: React.FC<{ manager: FtpManager }> = ({ manager }) => {
  if (manager.status === "connecting") {
    return (
      <EmptyState
        icon={RefreshCw}
        message="Connecting to the FTP server…"
        className="h-full"
      />
    );
  }
  if (manager.status !== "connected") {
    return (
      <EmptyState
        icon={Unplug}
        message="FTP session is not connected"
        hint="The backend error is shown above when a connection attempt fails."
        className="h-full"
      />
    );
  }
  if (!manager.isBusy && manager.entries.length === 0) {
    return (
      <EmptyState
        icon={Folder}
        message="This directory is empty"
        hint={manager.currentPath}
        className="h-full"
      />
    );
  }

  return (
    <div className="h-full overflow-auto">
      <table className="sor-data-table w-full">
        <thead className="sticky top-0 bg-[var(--color-border)]">
          <tr>
            <th className="sor-th">Name</th>
            <th className="sor-th">Size</th>
            <th className="sor-th">Modified</th>
            <th className="sor-th">Permissions</th>
            <th className="sor-th">Owner</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {manager.entries.map((entry) => {
            const selected = manager.selectedName === entry.name;
            return (
              <tr
                key={`${entry.kind}:${entry.name}`}
                data-testid={`ftp-entry-${entry.name}`}
                aria-selected={selected}
                className={`cursor-pointer hover:bg-[var(--color-border)] ${selected ? "bg-primary/15" : ""}`}
                onClick={() => manager.setSelectedName(entry.name)}
                onDoubleClick={() =>
                  void manager.navigateInto(entry).catch(() => undefined)
                }
              >
                <td className="px-4 py-3 text-sm text-[var(--color-text)]">
                  <div className="flex items-center gap-2">
                    {entry.kind === "directory" ? (
                      <Folder size={16} className="shrink-0 text-primary" />
                    ) : (
                      <FileIcon
                        size={16}
                        className="shrink-0 text-[var(--color-textSecondary)]"
                      />
                    )}
                    <span className="truncate">{entry.name}</span>
                    {entry.kind === "symlink" && (
                      <span className="text-xs text-[var(--color-textMuted)]">
                        → {entry.linkTarget || "link"}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-[var(--color-textSecondary)]">
                  {entry.kind === "directory"
                    ? "—"
                    : formatFileSize(entry.size)}
                </td>
                <td className="px-4 py-3 text-sm text-[var(--color-textSecondary)]">
                  {entryDate(entry)}
                </td>
                <td className="px-4 py-3 font-mono text-sm text-[var(--color-textSecondary)]">
                  {entry.permissions || "—"}
                </td>
                <td className="px-4 py-3 text-sm text-[var(--color-textSecondary)]">
                  {[entry.owner, entry.group].filter(Boolean).join(":") || "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export interface FTPClientProps {
  session: ConnectionSession;
}

export const FTPClient: React.FC<FTPClientProps> = ({ session }) => {
  const manager = useFTPSession(session);
  const [pathDraft, setPathDraft] = useState(manager.currentPath);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => setPathDraft(manager.currentPath), [manager.currentPath]);

  const selectedRemotePath = useMemo(
    () =>
      manager.selectedEntry
        ? joinFtpPath(manager.currentPath, manager.selectedEntry.name)
        : null,
    [manager.currentPath, manager.selectedEntry],
  );

  const runUiOperation = async (operation: () => Promise<unknown>) => {
    setLocalError(null);
    try {
      await operation();
    } catch (value) {
      setLocalError(value instanceof Error ? value.message : String(value));
    }
  };

  const handleUpload = () =>
    void runUiOperation(async () => {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selection = await open({ multiple: true, directory: false });
      if (!selection) return;
      const paths = Array.isArray(selection) ? selection : [selection];
      for (const localPath of paths) {
        await manager.uploadFile(
          localPath,
          joinFtpPath(manager.currentPath, basename(localPath)),
        );
      }
    });

  const handleDownload = () =>
    void runUiOperation(async () => {
      if (!manager.selectedEntry || !selectedRemotePath) return;
      const { save } = await import("@tauri-apps/plugin-dialog");
      const localPath = await save({ defaultPath: manager.selectedEntry.name });
      if (!localPath) return;
      await manager.downloadFile(selectedRemotePath, localPath);
    });

  const handleCreateDirectory = () => {
    const name = window.prompt("New FTP directory name")?.trim();
    if (name) void runUiOperation(() => manager.createDirectory(name));
  };

  const handleRename = () => {
    if (!manager.selectedEntry) return;
    const name = window
      .prompt("Rename FTP entry", manager.selectedEntry.name)
      ?.trim();
    if (name && name !== manager.selectedEntry.name) {
      void runUiOperation(() =>
        manager.renameEntry(manager.selectedEntry!, name),
      );
    }
  };

  const handleDelete = () => {
    if (!manager.selectedEntry) return;
    const confirmed = window.confirm(
      `Delete ${manager.selectedEntry.name}${
        manager.selectedEntry.kind === "directory"
          ? " and all of its contents"
          : ""
      }?`,
    );
    if (confirmed) {
      void runUiOperation(() => manager.deleteEntry(manager.selectedEntry!));
    }
  };

  const handleChmod = () => {
    if (!manager.selectedEntry) return;
    const mode = window
      .prompt("FTP permissions (octal, for example 755)", "755")
      ?.trim();
    if (mode && /^[0-7]{3,4}$/.test(mode)) {
      void runUiOperation(() =>
        manager.chmodEntry(manager.selectedEntry!, mode),
      );
    } else if (mode) {
      setLocalError("Permissions must be a three- or four-digit octal mode.");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-background)]">
      <FtpHeader manager={manager} />
      <FtpToolbar
        manager={manager}
        pathDraft={pathDraft}
        setPathDraft={setPathDraft}
        onNavigate={() =>
          void runUiOperation(() => manager.loadDirectory(pathDraft))
        }
        onUpload={handleUpload}
        onDownload={handleDownload}
        onCreateDirectory={handleCreateDirectory}
        onRename={handleRename}
        onDelete={handleDelete}
        onChmod={handleChmod}
      />
      {(manager.error || localError) && (
        <div
          role="alert"
          className="border-b border-error/30 bg-error/10 px-4 py-2 text-sm text-error"
        >
          {localError || manager.error}
        </div>
      )}
      <div className="min-h-0 flex-1">
        <FtpFileTable manager={manager} />
      </div>
      <div className="flex min-h-8 items-center justify-between border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-xs text-[var(--color-textSecondary)]">
        <span>
          {manager.entries.length} entries
          {manager.selectedEntry ? ` · ${manager.selectedEntry.name}` : ""}
        </span>
        <span>
          {manager.lastTransfer
            ? `${manager.lastTransfer.direction} completed · ${formatFileSize(
                manager.lastTransfer.bytesTransferred,
              )}`
            : manager.sessionInfo?.systemType || ""}
        </span>
      </div>
    </div>
  );
};

export default FTPClient;
