"use client";

import React from "react";
import type { NativeBrowserRecordingController } from "../../../hooks/protocol/useNativeBrowserRecording";

/** Content only: the owner mounts the hook outside its menu/dialog and owns the
 * overlay's native occlusion. Closing this panel does not save/discard a capture. */
export default function NativeBrowserRecordingControls({
  controller: c,
}: {
  controller: NativeBrowserRecordingController;
}) {
  const videoBusy = ["starting", "stopping", "saving"].includes(c.video.phase);
  const harBusy = ["starting", "stopping", "saving"].includes(c.har.phase);
  return (
    <section
      aria-label="Native browser recording"
      className="space-y-4 text-sm"
    >
      <p className="text-[var(--color-textSecondary)]">
        Recordings stay temporary until you explicitly save them. Closing the
        session, changing its selected view, or losing owner access discards
        unsaved recordings. Closing this panel does not stop recording.
      </p>
      <fieldset className="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
        <legend className="px-1 font-semibold">Network archive (HAR)</legend>
        <p className="text-xs text-[var(--color-textSecondary)]">
          Metadata-only HAR: origin, method, status, byte count and aggregate
          timing. Paths, query strings, headers, cookies and bodies are omitted.
          At most 2,048 entries / 30 minutes. Review archives before sharing.
        </p>
        {!c.harAvailable && (
          <p>HAR recording is unavailable for this native view.</p>
        )}
        <p role="status">
          HAR: {c.har.phase} · {c.har.entryCount} entries · {c.har.seconds}s
        </p>
        {c.har.droppedEntries > 0 && (
          <p role="status">
            {c.har.droppedEntries} requests omitted or incomplete.
          </p>
        )}
        {c.har.message && <p role="status">{c.har.message}</p>}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="sor-btn sor-btn-secondary"
            disabled={!c.available || !c.harAvailable || c.har.phase !== "idle"}
            onClick={() => void c.startHar()}
          >
            Start HAR
          </button>
          {c.har.phase === "recording" && (
            <button
              type="button"
              className="sor-btn sor-btn-secondary"
              disabled={!c.available}
              onClick={() => void c.stopHar()}
            >
              Stop HAR
            </button>
          )}
          {c.har.phase === "ready" && (
            <button
              type="button"
              className="sor-btn sor-btn-primary"
              disabled={!c.available}
              onClick={() => void c.saveHar()}
            >
              Save HAR…
            </button>
          )}
          {c.har.phase !== "idle" && (
            <button
              type="button"
              className="sor-btn sor-btn-secondary"
              disabled={harBusy}
              onClick={() => void c.discardHar()}
            >
              Discard HAR
            </button>
          )}
        </div>
      </fieldset>
      <fieldset className="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
        <legend className="px-1 font-semibold">Screen / window video</legend>
        <p className="text-xs text-[var(--color-textSecondary)]">
          Choose a screen or window in the system picker. Everything visible in
          that selection may be captured, including other tabs and private data.
          Audio is off. Maximum 10 minutes (including pauses) and 64 MiB of
          retained video. An oversized encoder output is discarded with a
          warning.
        </p>
        {!c.videoSupported && (
          <p>Screen recording is unavailable in this runtime.</p>
        )}
        <p role="status">
          Video: {c.video.phase} · {c.video.seconds}s ·{" "}
          {(c.video.bytes / (1024 * 1024)).toFixed(1)} MiB
        </p>
        {c.video.message && <p role="status">{c.video.message}</p>}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="sor-btn sor-btn-secondary"
            disabled={
              !c.available || !c.videoSupported || c.video.phase !== "idle"
            }
            onClick={() => void c.startVideo()}
          >
            Start video
          </button>
          {["recording", "paused"].includes(c.video.phase) && (
            <>
              <button
                type="button"
                className="sor-btn sor-btn-secondary"
                disabled={!c.available}
                onClick={c.pauseVideo}
              >
                {c.video.phase === "paused" ? "Resume video" : "Pause video"}
              </button>
              <button
                type="button"
                className="sor-btn sor-btn-secondary"
                disabled={!c.available}
                onClick={c.stopVideo}
              >
                Stop video
              </button>
            </>
          )}
          {c.video.phase === "ready" && (
            <button
              type="button"
              className="sor-btn sor-btn-primary"
              disabled={!c.available}
              onClick={() => void c.saveVideo()}
            >
              Save video…
            </button>
          )}
          {c.video.phase !== "idle" && (
            <button
              type="button"
              className="sor-btn sor-btn-secondary"
              disabled={videoBusy && c.video.phase !== "starting"}
              onClick={c.discardVideo}
            >
              {c.video.phase === "starting"
                ? "Cancel capture"
                : "Discard video"}
            </button>
          )}
        </div>
      </fieldset>
      {!c.available && (
        <p role="alert">The selected native browser owner is unavailable.</p>
      )}
    </section>
  );
}
