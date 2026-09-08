"use client";

import React, { useEffect, useRef, useState } from "react";
import type { SavedRDPRecording } from "../../types/recording/macroTypes";
import {
  loadRdpRecordings,
  rdpRecordingToBlob,
} from "../../utils/recording/macroService";
import { saveRdpRecordingToFile } from "../../utils/recording/recordingFileExport";
import { formatDuration } from "../../utils/core/formatters";
import { useSessionRenderActivity } from "../../contexts/SessionRenderActivityContext";

export interface RecordingPlayerTabProps {
  recordingId: string;
}

/** A local library player: never creates or depends on a live RDP session. */
export const RecordingPlayerTab: React.FC<RecordingPlayerTabProps> = ({
  recordingId,
}) => {
  const { isActive } = useSessionRenderActivity();
  const [loadedMedia, setMedia] = useState<{
    recording: SavedRDPRecording;
    url: string;
  } | null>(null);
  const media = loadedMedia?.recording.id === recordingId ? loadedMedia : null;
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const recordingIdRef = useRef(recordingId);
  recordingIdRef.current = recordingId;
  const videoRef = useRef<HTMLVideoElement>(null);
  const activeRef = useRef(isActive);
  activeRef.current = isActive;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isActive) videoRef.current?.pause();
    // Returning to the tab does not resume a user-paused recording.
  }, [isActive]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (activeRef.current) void video.play()?.catch(() => {});
    return () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [media?.url]);

  useEffect(() => {
    let cancelled = false;
    let url: string | undefined;
    setMedia(null);
    setError(null);
    void loadRdpRecordings()
      .then((recordings) => {
        if (cancelled) return;
        const recording = recordings.find(
          (candidate) => candidate.id === recordingId,
        );
        if (!recording)
          throw new Error("This recording is no longer in the library.");
        url = URL.createObjectURL(rdpRecordingToBlob(recording));
        setMedia({ recording, url });
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(`Unable to open recording: ${String(cause)}`);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [recordingId]);

  const saveRecording = async () => {
    if (!media || savingRef.current) return;
    savingRef.current = true;
    const savedRecordingId = media.recording.id;
    setSaving(true);
    setError(null);
    try {
      await saveRdpRecordingToFile(media.recording);
    } catch (cause) {
      if (mountedRef.current && recordingIdRef.current === savedRecordingId) {
        setError(`Unable to save recording: ${String(cause)}`);
      }
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-[var(--color-background)]"
      aria-label="Recording player"
    >
      <header className="flex items-center gap-3 border-b border-[var(--color-border)] p-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-medium">
            {media?.recording.name ?? "Recording player"}
          </h2>
          {media && (
            <p className="text-xs text-[var(--color-textSecondary)]">
              {media.recording.width} × {media.recording.height} ·{" "}
              {formatDuration(media.recording.durationMs)} ·{" "}
              {media.recording.format.toUpperCase()}
            </p>
          )}
        </div>
        <button
          className="sor-tag"
          disabled={!media || saving}
          onClick={() => void saveRecording()}
        >
          {saving ? "Saving…" : "Save to File"}
        </button>
      </header>
      {error && (
        <p role="alert" className="p-3 text-error">
          {error}
        </p>
      )}
      {!media && !error && (
        <p role="status" className="p-4">
          Loading recording…
        </p>
      )}
      {media && (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-3">
          {media.recording.format === "gif" ? (
            isActive && (
              <img
                src={media.url}
                alt={`Recording: ${media.recording.name}`}
                className="max-h-full max-w-full object-contain"
                onError={() =>
                  setError(
                    "This GIF could not be displayed. You can still save the original recording.",
                  )
                }
              />
            )
          ) : (
            <video
              ref={videoRef}
              src={media.url}
              controls
              playsInline
              preload="metadata"
              className="max-h-full max-w-full"
              aria-label={`Recording: ${media.recording.name}`}
              onPlay={() => {
                if (!activeRef.current) videoRef.current?.pause();
              }}
              onError={() =>
                setError(
                  "This recording could not be played by the webview. You can still save the original recording.",
                )
              }
            />
          )}
        </div>
      )}
    </section>
  );
};
