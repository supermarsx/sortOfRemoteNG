"use client";

import { open, save } from "@tauri-apps/plugin-dialog";
import {
  ArrowUp,
  Download,
  File as FileIcon,
  Folder,
  FolderPlus,
  Hash,
  Home,
  LogOut,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import {
  joinScpRemotePath,
  useScpClient,
} from "../../hooks/protocol/useScpClient";
import type { ConnectionSession } from "../../types/connection/connection";
import type { ScpRemoteDirEntry } from "../../types/scp";

const formatFileSize = (bytes: number): string => {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** unit).toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
};

const localName = (path: string): string =>
  path.split(/[\\/]/).filter(Boolean).pop() || "transfer";

const joinLocalPath = (directory: string, name: string): string => {
  const separator =
    /\\/.test(directory) || /^[A-Za-z]:/.test(directory) ? "\\" : "/";
  return directory.endsWith("/") || directory.endsWith("\\")
    ? `${directory}${name}`
    : `${directory}${separator}${name}`;
};

const asSinglePath = (selection: string | string[] | null): string | null =>
  Array.isArray(selection) ? (selection[0] ?? null) : selection;

export interface ScpClientProps {
  session: ConnectionSession;
}

export const ScpClient: React.FC<ScpClientProps> = ({ session }) => {
  const model = useScpClient(session);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [pathDraft, setPathDraft] = useState(model.currentPath);
  const [newFolderName, setNewFolderName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const selectedEntry = useMemo(
    () => model.entries.find((entry) => entry.path === selectedPath) ?? null,
    [model.entries, selectedPath],
  );

  useEffect(() => setPathDraft(model.currentPath), [model.currentPath]);
  useEffect(() => {
    if (
      selectedPath &&
      !model.entries.some((entry) => entry.path === selectedPath)
    ) {
      setSelectedPath(null);
    }
  }, [model.entries, selectedPath]);

  const perform = async (operation: () => Promise<void>) => {
    setActionError(null);
    setActionMessage(null);
    try {
      await operation();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const uploadFile = () =>
    perform(async () => {
      const localPath = asSinglePath(
        await open({
          multiple: false,
          directory: false,
          title: "Choose a file to upload with SCP",
        }),
      );
      if (!localPath) return;
      const remotePath = joinScpRemotePath(
        model.currentPath,
        localName(localPath),
      );
      const result = await model.uploadFile(localPath, remotePath);
      setActionMessage(
        `Uploaded ${formatFileSize(result.bytesTransferred)} to ${remotePath}.`,
      );
    });

  const uploadFolder = () =>
    perform(async () => {
      const localPath = asSinglePath(
        await open({
          multiple: false,
          directory: true,
          title: "Choose a folder to upload with SCP",
        }),
      );
      if (!localPath) return;
      const remotePath = joinScpRemotePath(
        model.currentPath,
        localName(localPath),
      );
      const result = await model.uploadDirectory(localPath, remotePath);
      setActionMessage(
        `Uploaded ${result.filesTransferred} file(s) to ${remotePath}.`,
      );
    });

  const downloadSelected = () =>
    perform(async () => {
      if (!selectedEntry) return;
      if (selectedEntry.isDir) {
        const directory = asSinglePath(
          await open({
            multiple: false,
            directory: true,
            title: "Choose a destination for the SCP folder",
          }),
        );
        if (!directory) return;
        const localPath = joinLocalPath(directory, selectedEntry.name);
        const result = await model.downloadDirectory(
          selectedEntry.path,
          localPath,
        );
        setActionMessage(
          `Downloaded ${result.filesTransferred} file(s) to ${localPath}.`,
        );
        return;
      }

      const localPath = await save({
        title: "Save SCP download",
        defaultPath: selectedEntry.name,
      });
      if (!localPath) return;
      const result = await model.downloadFile(selectedEntry.path, localPath);
      setActionMessage(
        `Downloaded ${formatFileSize(result.bytesTransferred)} to ${localPath}.`,
      );
    });

  const createFolder = () =>
    perform(async () => {
      const name = newFolderName.trim();
      if (!name || name === "." || name === ".." || /[\\/]/.test(name)) {
        throw new Error("Enter one valid folder name without path separators.");
      }
      await model.mkdir(joinScpRemotePath(model.currentPath, name));
      setNewFolderName("");
      setActionMessage(`Created ${name}.`);
    });

  const deleteSelected = () =>
    perform(async () => {
      if (!selectedEntry) return;
      const confirmed = window.confirm(
        `Permanently delete ${selectedEntry.name}${
          selectedEntry.isDir ? " and everything inside it" : ""
        }?`,
      );
      if (!confirmed) return;
      await model.deleteEntry(selectedEntry);
      setSelectedPath(null);
      setActionMessage(`Deleted ${selectedEntry.name}.`);
    });

  const checksumSelected = () =>
    perform(async () => {
      if (!selectedEntry || selectedEntry.isDir) return;
      const digest = await model.checksum(selectedEntry.path);
      setActionMessage(`SHA-256: ${digest}`);
    });

  const openEntry = (entry: ScpRemoteDirEntry) => {
    if (entry.isDir)
      void perform(() => model.loadDirectory(entry.path).then(() => undefined));
  };

  const connected = model.status === "connected";
  const disabled = !connected || model.isBusy;

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-[var(--color-background)] text-[var(--color-text)]"
      aria-label={`SCP files on ${session.hostname}`}
      data-testid="scp-client"
    >
      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)] p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <strong className="text-sm">SCP · {session.hostname}</strong>
          <span
            className="rounded-full border border-[var(--color-border)] px-2 py-1 uppercase"
            role="status"
            aria-live="polite"
          >
            {model.status}
          </span>
          {model.isBusy ? (
            <span className="text-[var(--color-textMuted)]">Working…</span>
          ) : null}
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1 disabled:opacity-50"
            onClick={() => void perform(model.disconnect)}
            disabled={model.status === "disconnected"}
          >
            <LogOut size={13} aria-hidden /> Disconnect
          </button>
        </div>

        <form
          className="flex min-w-0 items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void perform(() =>
              model.loadDirectory(pathDraft).then(() => undefined),
            );
          }}
        >
          <button
            type="button"
            className="sor-icon-btn-sm"
            aria-label="Remote home"
            title="Remote home"
            disabled={disabled}
            onClick={() =>
              void perform(() =>
                model.loadDirectory(model.homePath).then(() => undefined),
              )
            }
          >
            <Home size={15} />
          </button>
          <button
            type="button"
            className="sor-icon-btn-sm"
            aria-label="Parent folder"
            title="Parent folder"
            disabled={disabled || model.currentPath === model.homePath}
            onClick={() =>
              void perform(() => model.navigateUp().then(() => undefined))
            }
          >
            <ArrowUp size={15} />
          </button>
          <button
            type="button"
            className="sor-icon-btn-sm"
            aria-label="Refresh files"
            title="Refresh files"
            disabled={disabled}
            onClick={() =>
              void perform(() => model.refreshDirectory().then(() => undefined))
            }
          >
            <RefreshCw size={15} />
          </button>
          <label className="sr-only" htmlFor={`scp-path-${session.id}`}>
            Remote path
          </label>
          <input
            id={`scp-path-${session.id}`}
            className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 font-mono text-xs"
            value={pathDraft}
            onChange={(event) => setPathDraft(event.target.value)}
            disabled={!connected}
          />
          <button
            type="submit"
            className="rounded border border-[var(--color-border)] px-3 py-1.5 text-xs disabled:opacity-50"
            disabled={disabled}
          >
            Go
          </button>
        </form>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-3 py-2 text-xs">
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded bg-primary px-2 py-1.5 text-primary-foreground disabled:opacity-50"
          disabled={disabled}
          onClick={() => void uploadFile()}
        >
          <Upload size={14} aria-hidden /> Upload file
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1.5 disabled:opacity-50"
          disabled={disabled}
          onClick={() => void uploadFolder()}
        >
          <FolderPlus size={14} aria-hidden /> Upload folder
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1.5 disabled:opacity-50"
          disabled={disabled || !selectedEntry}
          onClick={() => void downloadSelected()}
        >
          <Download size={14} aria-hidden /> Download
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-[var(--color-border)] px-2 py-1.5 disabled:opacity-50"
          disabled={disabled || !selectedEntry || selectedEntry.isDir}
          onClick={() => void checksumSelected()}
        >
          <Hash size={14} aria-hidden /> Checksum
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-error/40 px-2 py-1.5 text-error disabled:opacity-50"
          disabled={disabled || !selectedEntry}
          onClick={() => void deleteSelected()}
        >
          <Trash2 size={14} aria-hidden /> Delete
        </button>
        <div className="ml-auto flex items-center gap-1">
          <label htmlFor={`scp-new-folder-${session.id}`}>New folder</label>
          <input
            id={`scp-new-folder-${session.id}`}
            className="w-36 rounded border border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1"
            value={newFolderName}
            onChange={(event) => setNewFolderName(event.target.value)}
            disabled={disabled}
          />
          <button
            type="button"
            className="rounded border border-[var(--color-border)] px-2 py-1 disabled:opacity-50"
            disabled={disabled || !newFolderName.trim()}
            onClick={() => void createFolder()}
          >
            Create
          </button>
        </div>
      </div>

      {(model.error || actionError) && (
        <div
          className="border-b border-error/30 bg-error/10 px-3 py-2 text-xs text-error"
          role="alert"
        >
          {actionError || model.error}
        </div>
      )}
      {actionMessage && (
        <div
          className="border-b border-success/30 bg-success/10 px-3 py-2 text-xs text-success"
          role="status"
        >
          {actionMessage}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="sor-data-table w-full" aria-label="Remote SCP files">
          <thead className="sticky top-0 bg-[var(--color-surface)]">
            <tr>
              <th className="sor-th">Name</th>
              <th className="sor-th">Size</th>
              <th className="sor-th">Modified</th>
              <th className="sor-th">Mode</th>
              <th className="sor-th">Owner</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {model.entries.map((entry) => (
              <tr
                key={entry.path}
                className={`cursor-pointer hover:bg-[var(--color-surfaceHover)] ${
                  selectedPath === entry.path ? "bg-primary/15" : ""
                }`}
                aria-selected={selectedPath === entry.path}
                tabIndex={0}
                onClick={() => setSelectedPath(entry.path)}
                onDoubleClick={() => openEntry(entry)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") openEntry(entry);
                  if (event.key === " ") {
                    event.preventDefault();
                    setSelectedPath(entry.path);
                  }
                }}
              >
                <td className="px-3 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    {entry.isDir ? (
                      <Folder size={16} className="text-primary" aria-hidden />
                    ) : (
                      <FileIcon
                        size={16}
                        className="text-[var(--color-textMuted)]"
                        aria-hidden
                      />
                    )}
                    {entry.name}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-[var(--color-textSecondary)]">
                  {entry.isDir ? "—" : formatFileSize(entry.size)}
                </td>
                <td className="px-3 py-2 text-xs text-[var(--color-textSecondary)]">
                  {entry.mtime || "—"}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-[var(--color-textSecondary)]">
                  {entry.mode || "—"}
                </td>
                <td className="px-3 py-2 text-xs text-[var(--color-textSecondary)]">
                  {[entry.owner, entry.group].filter(Boolean).join(":") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {connected && !model.isBusy && model.entries.length === 0 ? (
          <p className="p-6 text-center text-sm text-[var(--color-textMuted)]">
            This remote folder is empty.
          </p>
        ) : null}
        {!connected && model.status !== "error" ? (
          <p className="p-6 text-center text-sm text-[var(--color-textMuted)]">
            Establishing the SCP session…
          </p>
        ) : null}
      </div>
    </section>
  );
};

export default ScpClient;
