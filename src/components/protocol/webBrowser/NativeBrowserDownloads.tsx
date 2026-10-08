"use client";

import React, { useRef, useState } from "react";
import {
  Download,
  FileDown,
  FolderOpen,
  Pause,
  Play,
  RefreshCw,
  X,
} from "lucide-react";
import { PopoverSurface } from "../../ui/overlays/PopoverSurface";
import type { NativeBrowserDownloadsController } from "../../../hooks/protocol/useNativeBrowserDownloads";
import type { NativeDownload } from "../../../types/protocols/nativeBrowserDownloads";

const labels: Record<NativeDownload["status"], string> = {
  "awaiting-destination": "Choose where to save…",
  "in-progress": "Downloading",
  paused: "Paused",
  completed: "Completed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};
function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let amount = value / 1024,
    index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index++;
  }
  return `${amount.toFixed(1)} ${units[index]}`;
}
export default function NativeBrowserDownloads({
  controller,
  allowed,
  onOpenSettings,
}: {
  controller: NativeBrowserDownloadsController;
  allowed: boolean;
  onOpenSettings?: () => void;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const [openScope, setOpenScope] = useState<string | null>(null);
  const open = !!controller.scope && openScope === controller.scope;
  return (
    <div ref={anchor} className="relative shrink-0">
      <button
        type="button"
        className="sor-btn sor-icon-btn-sm relative"
        aria-label="Downloads"
        data-tooltip="Downloads"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={!controller.scope}
        onClick={() => setOpenScope(open ? null : controller.scope)}
      >
        <Download size={16} aria-hidden="true" />
        {controller.activeCount > 0 && (
          <span
            className="absolute -right-1 -top-1 rounded-full bg-primary px-1 text-[10px] text-white"
            aria-label={`${controller.activeCount} active downloads`}
          >
            {controller.activeCount}
          </span>
        )}
      </button>
      <PopoverSurface
        isOpen={open}
        anchorRef={anchor}
        onClose={() => setOpenScope(null)}
        align="end"
        offset={6}
        className="sor-popover-panel sor-popover-panel-strong w-[26rem] max-w-[calc(100vw-2rem)] max-h-[75dvh] overflow-hidden"
      >
        <section
          role="dialog"
          aria-label="Website downloads"
          className="flex max-h-[75dvh] flex-col text-[var(--color-text)]"
        >
          <header className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Download size={16} />
              Downloads
            </h3>
            <div className="flex gap-1">
              <button
                type="button"
                className="sor-btn sor-icon-btn-sm"
                aria-label="Refresh downloads"
                data-tooltip="Refresh downloads"
                onClick={controller.refresh}
              >
                <RefreshCw size={14} />
              </button>
              <button
                type="button"
                className="sor-btn sor-icon-btn-sm"
                aria-label="Close downloads"
                onClick={() => setOpenScope(null)}
              >
                <X size={14} />
              </button>
            </div>
          </header>
          <div className="overflow-auto p-4 space-y-3">
            {!allowed && (
              <div className="sor-alert-warning space-y-2 text-sm">
                <p>
                  Website downloads are disabled in Web Browser settings. Enable
                  them and reopen this website to download files.
                </p>
                {onOpenSettings && (
                  <button
                    type="button"
                    className="sor-btn sor-btn-secondary"
                    onClick={onOpenSettings}
                  >
                    Open settings
                  </button>
                )}
              </div>
            )}
            {controller.error && (
              <p role="alert" className="sor-alert-error text-sm">
                {controller.error}
              </p>
            )}
            {!controller.rows.length && (
              <p className="py-5 text-center text-sm text-[var(--color-textSecondary)]">
                No downloads in this browser session.
              </p>
            )}
            {controller.rows.map((row) => (
              <article
                key={row.downloadId}
                className="rounded-lg border border-[var(--color-border)] p-3 space-y-2"
              >
                <div className="flex items-start gap-2">
                  <FileDown
                    size={16}
                    className="mt-0.5 shrink-0 text-[var(--color-textSecondary)]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="break-all text-sm font-medium">
                      {row.fileName}
                    </p>
                    <p className="text-xs text-[var(--color-textSecondary)]">
                      {labels[row.status]} · {bytes(row.receivedBytes)}
                      {row.totalBytes !== null && ` / ${bytes(row.totalBytes)}`}
                      {row.status === "in-progress" &&
                        row.bytesPerSecond > 0 &&
                        ` · ${bytes(row.bytesPerSecond)}/s`}
                    </p>
                  </div>
                </div>
                {["in-progress", "paused"].includes(row.status) && (
                  <progress
                    aria-label={`Download progress for ${row.fileName}`}
                    className="h-1.5 w-full accent-primary"
                    max={row.totalBytes || undefined}
                    value={
                      row.totalBytes
                        ? Math.min(row.receivedBytes, row.totalBytes)
                        : undefined
                    }
                  />
                )}
                <div className="flex justify-end gap-1">
                  {row.canPause && (
                    <button
                      type="button"
                      className="sor-btn sor-btn-secondary text-xs"
                      disabled={controller.busy.has(row.downloadId)}
                      onClick={() =>
                        void controller.act(row.downloadId, "pause")
                      }
                    >
                      <Pause size={12} />
                      Pause
                    </button>
                  )}
                  {row.canResume && (
                    <button
                      type="button"
                      className="sor-btn sor-btn-secondary text-xs"
                      disabled={controller.busy.has(row.downloadId)}
                      onClick={() =>
                        void controller.act(row.downloadId, "resume")
                      }
                    >
                      <Play size={12} />
                      Resume
                    </button>
                  )}
                  {row.canCancel && (
                    <button
                      type="button"
                      className="sor-btn sor-btn-secondary text-xs"
                      disabled={controller.busy.has(row.downloadId)}
                      onClick={() =>
                        void controller.act(row.downloadId, "cancel")
                      }
                    >
                      <X size={12} />
                      Cancel
                    </button>
                  )}
                  {row.canReveal && (
                    <button
                      type="button"
                      className="sor-btn sor-btn-secondary text-xs"
                      disabled={controller.busy.has(row.downloadId)}
                      onClick={() =>
                        void controller.act(row.downloadId, "reveal")
                      }
                    >
                      <FolderOpen size={12} />
                      Show in folder
                    </button>
                  )}
                </div>
              </article>
            ))}
            <p className="text-xs leading-relaxed text-[var(--color-textSecondary)]">
              Files use this connection’s native browser session and private
              proxy. Closing the session or locking its database cancels active
              downloads. Files are never opened automatically.
            </p>
          </div>
        </section>
      </PopoverSurface>
    </div>
  );
}
