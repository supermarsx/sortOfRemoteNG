import React, { useEffect, useRef, useState } from "react";
import { Download, FolderOpen, Pencil, Trash2 } from "lucide-react";
import type { useNetworkDiscovery } from "../../hooks/network/useNetworkDiscovery";
import {
  DISCOVERY_HISTORY_NAME_MAX_LENGTH,
  DISCOVERY_HISTORY_RETENTION_NOTICE,
  type SavedDiscoveryScan,
} from "../../utils/discovery/scanHistory";
import { exportDiscoveryScanCsv } from "../../utils/discovery/exportDiscoveryScan";

function discoveryScanLabel(scan: SavedDiscoveryScan) {
  return scan.name?.trim() || new Date(scan.startedAt).toLocaleString();
}

export function DiscoveryScanHistory({
  scanHistory,
  onOpen,
  onDelete,
  onClear,
}: {
  scanHistory: ReturnType<typeof useNetworkDiscovery>["scanHistory"];
  onOpen: (scan: SavedDiscoveryScan) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<{ id?: string; message: string } | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const busy = pending || scanHistory.loading;
  const buttonClass = "sor-btn-secondary-sm disabled:opacity-50";

  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);

  async function perform(action: () => void | Promise<void>, id?: string) {
    if (locked.current || scanHistory.loading) return;
    locked.current = true;
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError({
        id,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      locked.current = false;
      setPending(false);
    }
  }

  return (
    <section aria-label="Scan history" className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Previous scans</h3>
        <button
          type="button"
          className={buttonClass}
          disabled={busy}
          onClick={() => void perform(() => scanHistory.reload())}
        >
          Reload history
        </button>
      </div>
      <p className="text-xs text-[var(--color-textSecondary)]">
        {DISCOVERY_HISTORY_RETENTION_NOTICE}
      </p>
      {(scanHistory.scans.length > 0 || scanHistory.error) && (
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={() => {
              if (!confirmClear) {
                setConfirmClear(true);
                return;
              }
              void perform(async () => {
                await scanHistory.clearScans();
                onClear();
                setConfirmClear(false);
              });
            }}
          >
            {confirmClear
              ? "Confirm clear all scan history"
              : "Clear scan history"}
          </button>
          {confirmClear && (
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => setConfirmClear(false)}
            >
              Cancel
            </button>
          )}
        </div>
      )}
      {error && !error.id && (
        <p role="alert" className="text-sm text-error">
          {error.message}
        </p>
      )}
      {scanHistory.loading && <p role="status">Loading scan history…</p>}
      {scanHistory.scans.map((scan) => {
        const label = discoveryScanLabel(scan);
        return (
          <div
            key={scan.id}
            role="group"
            aria-label={`Saved scan: ${label}`}
            className="space-y-3 rounded-lg border border-[var(--color-border)] p-3"
          >
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <span className="block break-words text-sm font-medium">
                  {label} · {scan.outcome}
                </span>
                {scan.name?.trim() && (
                  <time
                    dateTime={new Date(scan.startedAt).toISOString()}
                    className="block text-xs text-[var(--color-textSecondary)]"
                  >
                    {new Date(scan.startedAt).toLocaleString()}
                  </time>
                )}
                <span className="block truncate font-mono text-xs text-[var(--color-textSecondary)]">
                  {scan.config.ipRange}
                </span>
                <span className="text-xs">
                  {scan.hosts.length} hosts ·{" "}
                  {scan.hosts.reduce(
                    (total, host) => total + host.openPorts.length,
                    0,
                  )}{" "}
                  open ports
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy}
                  aria-label={`Open scan: ${label}`}
                  onClick={() => onOpen(scan)}
                >
                  <FolderOpen size={15} />
                  Open scan
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy}
                  aria-label={`Export CSV: ${label}`}
                  onClick={() =>
                    void perform(() => exportDiscoveryScanCsv(scan), scan.id)
                  }
                >
                  <Download size={15} />
                  Export CSV
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy}
                  aria-label={`Rename scan: ${label}`}
                  onClick={() => {
                    setEditing(scan.id);
                    setDraft(label);
                    setConfirmDelete(null);
                    setError(null);
                  }}
                >
                  <Pencil size={15} />
                  Rename
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy}
                  aria-label={`Delete scan: ${label}`}
                  onClick={() => {
                    setConfirmDelete(scan.id);
                    setEditing(null);
                    setError(null);
                  }}
                >
                  <Trash2 size={15} />
                  Delete
                </button>
              </div>
            </div>
            {editing === scan.id && (
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!draft.trim()) return;
                  void perform(async () => {
                    await scanHistory.renameScan(scan.id, draft.trim());
                    setEditing(null);
                  }, scan.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!busy) {
                      setEditing(null);
                      setError(null);
                    }
                  }
                }}
              >
                <input
                  ref={input}
                  aria-label={`Scan name: ${label}`}
                  className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-primary focus:outline-none"
                  value={draft}
                  maxLength={DISCOVERY_HISTORY_NAME_MAX_LENGTH}
                  required
                  disabled={busy}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <button
                  type="submit"
                  className={buttonClass}
                  disabled={busy || !draft.trim()}
                >
                  Save name
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy}
                  onClick={() => {
                    setEditing(null);
                    setError(null);
                  }}
                >
                  Cancel rename
                </button>
              </form>
            )}
            {confirmDelete === scan.id && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span>
                  Delete “{label}” from history? This cannot be undone.
                </span>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy}
                  aria-label={`Confirm delete scan: ${label}`}
                  onClick={() =>
                    void perform(async () => {
                      await scanHistory.deleteScan(scan.id);
                      onDelete(scan.id);
                      setConfirmDelete(null);
                    }, scan.id)
                  }
                >
                  Confirm delete
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={busy}
                  onClick={() => {
                    setConfirmDelete(null);
                    setError(null);
                  }}
                >
                  Cancel delete
                </button>
              </div>
            )}
            {error?.id === scan.id && (
              <p role="alert" className="text-sm text-error">
                {error.message}
              </p>
            )}
          </div>
        );
      })}
      {!scanHistory.loading && scanHistory.scans.length === 0 && (
        <p className="text-sm text-[var(--color-textSecondary)]">
          No saved scans yet.
        </p>
      )}
    </section>
  );
}
