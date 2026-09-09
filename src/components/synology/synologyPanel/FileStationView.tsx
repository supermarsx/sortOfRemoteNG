import React, { useId, useState } from "react";
import {
  ArrowLeft,
  Copy,
  Download,
  File,
  Folder,
  FolderPlus,
  Loader2,
  Move,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { Modal, ModalBody, ModalFooter } from "../../ui/overlays/Modal";
import { DialogHeader } from "../../ui/overlays/DialogHeader";
import type { SubProps } from "./types";
import type {
  FileStationReview,
  useSynologyFileStation,
} from "../../../hooks/synology/useSynologyFileStation";

type Explorer = ReturnType<typeof useSynologyFileStation>;
const field =
  "rounded-md border border-[var(--color-border)] bg-[var(--color-surfaceHover)] px-3 py-2 text-sm min-w-0";
const labels = {
  create: "Create folder",
  rename: "Rename item",
  delete: "Delete selected items",
  copy: "Copy selected items",
  move: "Move selected items",
};
function TaskProgress({ fs }: { fs: Explorer }) {
  const value = fs.task?.progress;
  if (
    !fs.task ||
    fs.task.finished ||
    value == null ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  )
    return null;
  // A request can report 1 before its completion flag. Do not call it finished.
  const percent = Math.min(99, Math.floor(value * 100));
  return (
    <div className="flex items-center gap-2 text-xs">
      <progress
        aria-label="NAS file task progress"
        value={percent}
        max={100}
        className="h-2 min-w-0 flex-1 accent-teal-500"
      />
      <span>{percent}%</span>
    </div>
  );
}
const formatBytes = (bytes: number | undefined) => {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (!bytes) return "0 B";
  const power = Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** power).toFixed(power ? 1 : 0)} ${["B", "KiB", "MiB", "GiB", "TiB"][power]}`;
};

function ActionReview({
  fs,
  review,
}: {
  fs: Explorer;
  review: FileStationReview;
}) {
  const id = useId();
  const [value, setValue] = useState(
    review.kind === "rename"
      ? review.items[0].name
      : review.kind === "copy" || review.kind === "move"
        ? review.scope.path
        : "",
  );
  const destination = review.kind === "copy" || review.kind === "move";
  return (
    <Modal
      isOpen
      ariaLabel={labels[review.kind]}
      onClose={fs.cancelReview}
      closeOnEscape={!fs.busy}
      closeOnBackdrop={!fs.busy}
      panelClassName="max-w-lg max-h-[calc(100dvh-2rem)] overflow-hidden"
      contentClassName="flex min-h-0 flex-col p-0 overflow-hidden"
    >
      <DialogHeader
        title={labels[review.kind]}
        icon={review.kind === "delete" ? Trash2 : Folder}
        variant="compact"
        onClose={fs.busy ? undefined : fs.cancelReview}
      />
      <ModalBody className="min-h-0 overflow-y-auto space-y-3 p-5">
        <p className="text-xs text-[var(--color-textSecondary)] break-all">
          Folder: {review.scope.path}
        </p>
        {!!review.items.length && (
          <ul className="max-h-40 overflow-y-auto rounded border border-[var(--color-border)] p-3 text-sm space-y-1">
            {review.items.map((item) => (
              <li key={item.path} className="break-all">
                {item.name}
              </li>
            ))}
          </ul>
        )}
        {review.kind === "delete" ? (
          <p className="text-sm text-warning">
            Delete {review.items.length} selected item(s) and any contents on
            the NAS? Recovery depends on the NAS shared-folder recycle-bin
            settings; it is not guaranteed.
          </p>
        ) : (
          <label htmlFor={id} className="block space-y-1 text-sm">
            {destination ? "Destination folder" : "Name"}
            <input
              id={id}
              className={`${field} w-full`}
              autoComplete="off"
              value={value}
              maxLength={destination ? 4096 : 255}
              onChange={(e) => setValue(e.target.value)}
              disabled={fs.busy}
              placeholder={
                destination ? "/shared-folder/destination" : "New folder"
              }
            />
          </label>
        )}
        {destination && (
          <p className="text-xs text-[var(--color-textSecondary)]">
            Enter an existing absolute folder path inside a share. Name
            collisions fail; existing files are not overwritten or silently
            skipped.
          </p>
        )}
        {fs.error && (
          <p role="alert" className="text-sm text-error break-words">
            {fs.error}
          </p>
        )}
        {fs.busy && (
          <p role="status" className="text-sm">
            {fs.task
              ? `Waiting for the NAS ${fs.task.operation} task to finish…`
              : "Sending request…"}
          </p>
        )}
        <TaskProgress fs={fs} />
      </ModalBody>
      <ModalFooter className="shrink-0 flex-wrap gap-2 px-5 py-3">
        {fs.busy && fs.task && !fs.task.finished ? (
          <button
            className="sor-btn sor-btn-secondary"
            onClick={() => void fs.cancelTask()}
          >
            Cancel task
          </button>
        ) : (
          <button
            className="sor-btn sor-btn-secondary"
            disabled={fs.busy}
            onClick={fs.cancelReview}
          >
            Cancel
          </button>
        )}
        <button
          className={
            review.kind === "delete"
              ? "sor-btn sor-btn-danger"
              : "sor-btn sor-btn-primary"
          }
          disabled={fs.busy || (review.kind !== "delete" && !value.trim())}
          onClick={() => void fs.confirmReview(value)}
        >
          {fs.busy ? "Working…" : labels[review.kind]}
        </button>
      </ModalFooter>
    </Modal>
  );
}

export function FileStationExplorer({ fs }: { fs: Explorer }) {
  const id = useId();
  const [pathDraft, setPathDraft] = useState(fs.currentPath);
  const [pathBase, setPathBase] = useState(fs.currentPath);
  if (pathBase !== fs.currentPath) {
    setPathBase(fs.currentPath);
    setPathDraft(fs.currentPath);
  }
  const items = fs.fileList?.files ?? [];
  const selected = new Set(fs.selected);
  const root = fs.currentPath === "/";
  const parts = fs.currentPath.split("/").filter(Boolean);
  const total = fs.fileList?.total ?? 0;
  const downloadReady =
    fs.selected.length === 1 &&
    items.some((item) => selected.has(item.path) && !item.isdir);
  return (
    <div
      className="flex flex-1 min-h-0 min-w-0 flex-col"
      data-testid="synology-file-station"
    >
      <div className="shrink-0 space-y-3 border-b border-[var(--color-border)] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="mr-auto flex items-center gap-2 font-semibold">
            <Folder className="h-4 w-4 text-teal-500" />
            File Station
          </h3>
          <button
            className="sor-btn-secondary-sm"
            disabled={fs.loading || fs.busy}
            onClick={() => void fs.refresh()}
            title="Reload this NAS folder"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh files
          </button>
        </div>
        <nav
          aria-label="File Station folders"
          className="flex flex-wrap items-center gap-1 text-xs text-[var(--color-textSecondary)]"
        >
          <button
            disabled={fs.busy || root}
            className="sor-btn-secondary-sm"
            aria-label="Parent folder"
            onClick={() =>
              fs.navigateToFolder(`/${parts.slice(0, -1).join("/")}`)
            }
          >
            <ArrowLeft className="h-3 w-3" />
          </button>
          <button disabled={fs.busy} onClick={() => fs.navigateToFolder("/")}>
            Shared folders
          </button>
          {parts.map((part, index) => (
            <React.Fragment key={`${index}:${part}`}>
              <span aria-hidden>/</span>
              <button
                disabled={fs.busy}
                className="break-all"
                onClick={() =>
                  fs.navigateToFolder(`/${parts.slice(0, index + 1).join("/")}`)
                }
              >
                {part}
              </button>
            </React.Fragment>
          ))}
        </nav>
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            fs.navigateToFolder(pathDraft);
          }}
        >
          <label htmlFor={`${id}-path`} className="min-w-0 flex-1 text-xs">
            Folder path
            <input
              id={`${id}-path`}
              className={`${field} mt-1 w-full`}
              value={pathDraft}
              onChange={(e) => setPathDraft(e.target.value)}
              disabled={fs.busy}
              maxLength={4096}
            />
          </label>
          <button className="sor-btn sor-btn-secondary" disabled={fs.busy}>
            Go
          </button>
        </form>
        <div className="flex flex-wrap items-end gap-3">
          <form
            className="flex min-w-0 items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void fs.searchFiles();
            }}
          >
            <label htmlFor={`${id}-search`} className="min-w-0 text-xs">
              Search within folder
              <div className="relative mt-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-textSecondary)]" />
                <input
                  id={`${id}-search`}
                  className={`${field} w-48 max-w-full !pl-9`}
                  placeholder="Name or pattern"
                  value={fs.fileSearch}
                  onChange={(e) => fs.setFileSearch(e.target.value)}
                  disabled={fs.busy || root}
                  maxLength={255}
                />
              </div>
            </label>
            <button
              className="sor-btn sor-btn-secondary"
              disabled={fs.busy || root}
            >
              Search
            </button>
          </form>
          <label htmlFor={`${id}-sort`} className="text-xs">
            Sort
            <select
              id={`${id}-sort`}
              className={`${field} mt-1 block w-auto`}
              value={fs.sortBy}
              disabled={fs.busy || fs.task?.operation === "search"}
              onChange={(e) => {
                fs.setPage(0);
                fs.setSortBy(e.target.value);
              }}
            >
              <option value="name">Name</option>
              <option value="size">Size</option>
              <option value="mtime">Modified</option>
              <option value="type">Type</option>
            </select>
          </label>
          <label htmlFor={`${id}-direction`} className="text-xs">
            Order
            <select
              id={`${id}-direction`}
              className={`${field} mt-1 block w-auto`}
              value={fs.sortDirection}
              disabled={fs.busy || fs.task?.operation === "search"}
              onChange={(e) => {
                fs.setPage(0);
                fs.setSortDirection(e.target.value);
              }}
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="sor-btn-secondary-sm"
            disabled={fs.busy || root}
            onClick={() => fs.requestReview("create")}
          >
            <FolderPlus className="h-4 w-4" />
            New folder
          </button>
          <button
            className="sor-btn-secondary-sm"
            disabled={fs.busy || root}
            onClick={() => void fs.upload()}
            title="Choose a local file in the native Open dialog"
          >
            <Upload className="h-4 w-4" />
            Upload
          </button>
          <button
            className="sor-btn-secondary-sm"
            disabled={fs.busy || !downloadReady}
            onClick={() => void fs.download()}
            title="Save one selected file to a NEW filename; existing local files are never overwritten"
          >
            <Download className="h-4 w-4" />
            Download
          </button>
          <button
            className="sor-btn-secondary-sm"
            disabled={fs.busy || root || fs.selected.length !== 1}
            onClick={() => fs.requestReview("rename")}
          >
            <Pencil className="h-4 w-4" />
            Rename
          </button>
          <button
            className="sor-btn-secondary-sm"
            disabled={fs.busy || root || !selected.size}
            onClick={() => fs.requestReview("copy")}
          >
            <Copy className="h-4 w-4" />
            Copy
          </button>
          <button
            className="sor-btn-secondary-sm"
            disabled={fs.busy || root || !selected.size}
            onClick={() => fs.requestReview("move")}
          >
            <Move className="h-4 w-4" />
            Move
          </button>
          <button
            className="sor-btn-secondary-sm text-error"
            disabled={fs.busy || root || !selected.size}
            onClick={() => fs.requestReview("delete")}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
        {root && (
          <p className="text-xs text-[var(--color-textSecondary)]">
            Open a shared folder to manage its files. This explorer does not
            create or delete NAS shares.
          </p>
        )}
        {fs.task?.operation === "search" && fs.task.finished && (
          <p className="text-xs text-[var(--color-textSecondary)]">
            Search results. Clear the search field and choose Search to return
            to this folder.
          </p>
        )}
        {fs.error && !fs.review && (
          <p role="alert" className="text-sm text-error break-words">
            {fs.error}
          </p>
        )}
        {fs.message && (
          <p
            role="status"
            className="text-sm text-[var(--color-textSecondary)] break-words"
          >
            {fs.message}
          </p>
        )}
        {(fs.loading || fs.busy || (fs.task && !fs.task.finished)) && (
          <div className="flex items-center gap-2 text-sm" role="status">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>
              {fs.busy
                ? fs.task
                  ? `NAS ${fs.task.operation} in progress`
                  : "Waiting for the native dialog or NAS…"
                : fs.loading
                  ? "Loading files…"
                  : "Task still needs cancellation"}
            </span>
            {fs.task && !fs.task.finished && (
              <button
                className="sor-btn-secondary-sm ml-auto"
                onClick={() => void fs.cancelTask()}
              >
                Cancel task
              </button>
            )}
          </div>
        )}
        {!fs.review && <TaskProgress fs={fs} />}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[520px] text-xs">
          <thead className="sticky top-0 bg-[var(--color-surface)] text-left text-[var(--color-textSecondary)]">
            <tr>
              <th className="p-3">
                <input
                  type="checkbox"
                  aria-label="Select this page"
                  checked={
                    items.length > 0 &&
                    items.every((item) => selected.has(item.path))
                  }
                  disabled={fs.busy || !items.length || root}
                  onChange={(event) =>
                    event.target.checked ? fs.selectPage() : fs.clearSelection()
                  }
                />
              </th>
              <th className="p-3">Name</th>
              <th className="p-3">Type</th>
              <th className="p-3">Size</th>
              <th className="p-3">Modified</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.path}
                className="border-t border-[var(--color-border)] hover:bg-[var(--color-surfaceHover)]"
              >
                <td className="p-3">
                  <input
                    type="checkbox"
                    aria-label={`Select ${item.name}`}
                    checked={selected.has(item.path)}
                    onChange={() => fs.toggleSelection(item.path)}
                    disabled={fs.busy || root}
                  />
                </td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    {item.isdir ? (
                      <Folder className="h-4 w-4 shrink-0 text-warning" />
                    ) : (
                      <File className="h-4 w-4 shrink-0" />
                    )}
                    {item.isdir ? (
                      <button
                        className="break-all text-left text-teal-400 hover:underline"
                        disabled={fs.busy}
                        onClick={() => fs.navigateToFolder(item.path)}
                      >
                        {item.name}
                      </button>
                    ) : (
                      <span className="break-all">{item.name}</span>
                    )}
                  </div>
                </td>
                <td className="p-3">
                  {item.isdir ? "Folder" : (item.additional?.type ?? "File")}
                </td>
                <td className="p-3 whitespace-nowrap">
                  {item.isdir ? "—" : formatBytes(item.additional?.size)}
                </td>
                <td className="p-3 whitespace-nowrap">
                  {item.additional?.time?.mtime
                    ? new Date(
                        item.additional.time.mtime * 1000,
                      ).toLocaleString()
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && !fs.loading && (
          <p className="p-10 text-center text-sm text-[var(--color-textSecondary)]">
            {fs.error
              ? "Files could not be loaded. Correct the error and refresh."
              : root
                ? "No shared folders are available to this account."
                : fs.task?.operation === "search"
                  ? "No matching files."
                  : "This folder is empty."}
          </p>
        )}
      </div>
      <div className="shrink-0 flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] p-3 text-xs">
        <span>
          {total} items · {selected.size} selected
        </span>
        <span className="ml-auto">
          Page {fs.page + 1} of {Math.max(1, Math.ceil(total / fs.pageSize))}
        </span>
        <button
          className="sor-btn-secondary-sm"
          disabled={!fs.page || fs.busy || fs.loading}
          onClick={() => fs.setPage(fs.page - 1)}
        >
          Previous
        </button>
        <button
          className="sor-btn-secondary-sm"
          disabled={
            (fs.page + 1) * fs.pageSize >= total || fs.busy || fs.loading
          }
          onClick={() => fs.setPage(fs.page + 1)}
        >
          Next
        </button>
      </div>
      {fs.review && (
        <ActionReview key={fs.review.id} fs={fs} review={fs.review} />
      )}
    </div>
  );
}
const FileStationView: React.FC<SubProps> = ({ mgr }) => (
  <FileStationExplorer fs={mgr.fileStation} />
);
export default FileStationView;
