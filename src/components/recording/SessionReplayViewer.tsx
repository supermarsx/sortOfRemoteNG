import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Play,
  Pause,
  Square,
  Download,
  Clock,
  BookmarkPlus,
  MessageSquarePlus,
  Trash2,
  Search,
  ChevronRight,
  Monitor,
  Video,
  Globe,
  Bookmark,
  MessageSquare,
  AlertCircle,
  Loader2,
  FileQuestion,
} from "lucide-react";
import { useReplay } from "../../hooks/recording/useReplay";
import type {
  ReplayAnnotation,
  ReplayBookmark,
  TimelineMarker,
  HarEntry,
} from "../../types/recording/replay";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

export interface SessionReplayViewerProps {
  recordingId: string;
  replayType: "terminal" | "video" | "har";
  onClose?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const SPEEDS = [0.5, 1, 2, 4, 8] as const;

function fmtMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusColor(code: number): string {
  if (code < 300) return "bg-success";
  if (code < 400) return "bg-warning";
  if (code < 500) return "bg-warning";
  return "bg-error";
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

type Replay = ReturnType<typeof useReplay>;

/* ---------- Header ---------- */

function Header({
  r,
  t,
  onExport,
  onClose,
}: {
  r: Replay;
  t: (k: string) => string;
  onExport: () => void;
  onClose?: () => void;
}) {
  const s = r.session;
  return (
    <div className="sor-replay-header flex items-center justify-between px-4 py-2 bg-[var(--color-surface)] border-b border-[var(--color-border)]">
      <div className="flex items-center gap-3">
        {s?.replayType === "terminal" && <Monitor size={16} className="text-success" />}
        {s?.replayType === "video" && <Video size={16} className="text-primary" />}
        {s?.replayType === "har" && <Globe size={16} className="text-accent" />}
        <span className="text-sm font-medium text-[var(--color-text)]">
          {s?.title ?? t("replay.untitled")}
        </span>
        {s && (
          <span className="text-xs text-[var(--color-textSecondary)] flex items-center gap-1">
            <Clock size={12} />
            {fmtMs(s.durationMs)} &middot; {new Date(s.startTime).toLocaleDateString()}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onExport}
          className="sor-option-chip text-xs"
          title={t("replay.export")}
        >
          <Download size={14} />
          <span>{t("replay.export")}</span>
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
            aria-label={t("common.close")}
          >
            &times;
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- Playback controls ---------- */

function PlaybackControls({
  r,
  t,
}: {
  r: Replay;
  t: (k: string) => string;
}) {
  const playing = r.playbackState === "playing";
  const canPlay = r.playbackState === "paused" || r.playbackState === "stopped";

  const handleSeekChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const pct = Number(e.target.value);
      if (r.position) {
        r.seek((pct / 100) * r.position.totalTimeMs);
      }
    },
    [r],
  );

  return (
    <div className="sor-replay-controls flex items-center gap-3 px-4 py-2 bg-[var(--color-surfaceHover)] border-b border-[var(--color-border)]">
      {/* Play / Pause */}
      <button
        onClick={() => (playing ? r.pause() : r.play())}
        disabled={!canPlay && !playing}
        className="sor-option-chip p-1.5"
        title={playing ? t("replay.pause") : t("replay.play")}
      >
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>

      {/* Stop */}
      <button
        onClick={() => r.stop()}
        disabled={r.playbackState === "idle" || r.playbackState === "stopped"}
        className="sor-option-chip p-1.5"
        title={t("replay.stop")}
      >
        <Square size={16} />
      </button>

      {/* Seek bar */}
      <input
        type="range"
        min={0}
        max={100}
        step={0.1}
        value={r.position?.percent ?? 0}
        onChange={handleSeekChange}
        className="flex-1 accent-blue-500 h-1.5 cursor-pointer"
        title={t("replay.seek")}
      />

      {/* Position label */}
      <span className="text-xs tabular-nums text-[var(--color-textSecondary)] min-w-[72px] text-right">
        {r.position ? `${fmtMs(r.position.currentTimeMs)} / ${fmtMs(r.position.totalTimeMs)}` : "--:-- / --:--"}
      </span>

      {/* Speed selector */}
      <select
        value={r.speed}
        onChange={(e) => r.setSpeed(Number(e.target.value))}
        className="px-2 py-1 text-xs bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)] cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/50"
        title={t("replay.speed")}
      >
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}x
          </option>
        ))}
      </select>
    </div>
  );
}

/* ---------- Timeline ---------- */

function Timeline({
  r,
  onMarkerClick,
}: {
  r: Replay;
  onMarkerClick: (marker: TimelineMarker) => void;
}) {
  if (!r.timeline) return null;
  const total = r.timeline.totalDurationMs || 1;

  return (
    <div className="sor-replay-timeline relative h-6 mx-4 my-1 bg-[var(--color-border)] rounded overflow-hidden">
      {/* Segments */}
      {r.timeline.segments.map((seg, i) => {
        const left = (seg.startMs / total) * 100;
        const width = ((seg.endMs - seg.startMs) / total) * 100;
        const opacity = 0.2 + seg.intensity * 0.6;
        return (
          <div
            key={i}
            className={`absolute top-0 bottom-0 ${seg.kind === "error" ? "bg-error" : seg.kind === "command" ? "bg-primary" : "bg-success"}`}
            style={{ left: `${left}%`, width: `${width}%`, opacity }}
          />
        );
      })}

      {/* Markers */}
      {r.timeline.markers.map((mk) => (
        <button
          key={mk.id}
          onClick={() => onMarkerClick(mk)}
          className="absolute top-0 w-1.5 h-full hover:w-2.5 transition-all z-10 cursor-pointer"
          style={{ left: `${(mk.timeMs / total) * 100}%`, backgroundColor: mk.color }}
          title={mk.label}
        />
      ))}

      {/* Playhead */}
      {r.position && (
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-white/80 z-20 pointer-events-none"
          style={{ left: `${r.position.percent}%` }}
        />
      )}
    </div>
  );
}

/* ---------- Terminal pane ---------- */

function TerminalPane({ r }: { r: Replay }) {
  if (!r.terminalFrame) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--color-textMuted)] text-sm">
        No terminal data
      </div>
    );
  }
  return (
    <pre className="sor-replay-terminal flex-1 overflow-auto bg-[#1e1e1e] text-success p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap">
      <code>{r.terminalFrame.text}</code>
    </pre>
  );
}

/* ---------- Video pane ---------- */

function VideoPane({ r }: { r: Replay }) {
  if (!r.videoFrame) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--color-textMuted)] text-sm">
        No video data
      </div>
    );
  }
  const src = `data:image/${r.videoFrame.format === "rgba" ? "png" : r.videoFrame.format};base64,${r.videoFrame.dataBase64}`;
  return (
    <div className="sor-replay-video flex-1 flex items-center justify-center bg-black overflow-hidden">
      <img
        src={src}
        width={r.videoFrame.width}
        height={r.videoFrame.height}
        alt="Session frame"
        className="max-w-full max-h-full object-contain"
      />
    </div>
  );
}

/* ---------- HAR waterfall pane ---------- */

function HarPane({ r }: { r: Replay }) {
  if (!r.harWaterfall || r.harWaterfall.entries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--color-textMuted)] text-sm">
        No HTTP request data
      </div>
    );
  }
  const total = r.harWaterfall.totalDurationMs || 1;

  return (
    <div className="sor-replay-har flex-1 overflow-auto">
      <table className="sor-data-table w-full text-xs">
        <thead className="bg-[var(--color-border)] sticky top-0">
          <tr>
            <th className="sor-th w-16">#</th>
            <th className="sor-th w-16">Method</th>
            <th className="sor-th">URL</th>
            <th className="sor-th w-16">Status</th>
            <th className="sor-th w-20">Size</th>
            <th className="sor-th w-20">Time</th>
            <th className="sor-th min-w-[200px]">Waterfall</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {r.harWaterfall.entries.map((entry: HarEntry) => {
            const barLeft = (entry.startTimeMs / total) * 100;
            const barWidth = Math.max((entry.durationMs / total) * 100, 0.5);
            return (
              <tr key={entry.index} className="hover:bg-[var(--color-border)]">
                <td className="px-2 py-1 text-[var(--color-textMuted)]">{entry.index + 1}</td>
                <td className="px-2 py-1 font-medium text-[var(--color-text)]">{entry.method}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)] truncate max-w-[300px]" title={entry.url}>
                  {entry.url}
                </td>
                <td className="px-2 py-1">
                  <span className={`inline-block px-1.5 py-0.5 rounded text-white text-[10px] ${statusColor(entry.statusCode)}`}>
                    {entry.statusCode}
                  </span>
                </td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{fmtBytes(entry.responseSize)}</td>
                <td className="px-2 py-1 text-[var(--color-textSecondary)]">{entry.durationMs}ms</td>
                <td className="px-2 py-1">
                  <div className="relative h-3 bg-[var(--color-border)] rounded-full overflow-hidden">
                    <div
                      className={`absolute h-full rounded-full ${statusColor(entry.statusCode)}`}
                      style={{ left: `${barLeft}%`, width: `${barWidth}%` }}
                    />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- HAR stats strip ---------- */

function HarStatsPanel({ r, t }: { r: Replay; t: (k: string) => string }) {
  if (!r.harStats) return null;
  const hs = r.harStats;

  return (
    <div className="sor-replay-har-stats flex items-center gap-4 px-4 py-2 bg-[var(--color-surfaceHover)] border-t border-[var(--color-border)] text-xs text-[var(--color-textSecondary)]">
      <span>
        <strong className="text-[var(--color-text)]">{hs.totalRequests}</strong>{" "}
        {t("replay.totalRequests")}
      </span>
      <span>
        <strong className="text-[var(--color-text)]">{fmtBytes(hs.totalTransferSize)}</strong>{" "}
        {t("replay.transferred")}
      </span>
      <span>
        <strong className="text-[var(--color-text)]">{hs.avgDurationMs.toFixed(0)}ms</strong>{" "}
        {t("replay.avgLoadTime")}
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block w-2 h-2 rounded-full bg-success" />
        {hs.successCount} ok
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block w-2 h-2 rounded-full bg-error" />
        {hs.errorCount} {t("replay.errors")}
      </span>
      {Object.entries(hs.byStatus).length > 0 && (
        <span className="ml-auto text-[var(--color-textMuted)]">
          {Object.entries(hs.byStatus)
            .map(([code, count]) => `${code}: ${count}`)
            .join(", ")}
        </span>
      )}
    </div>
  );
}

/* ---------- Side panel ---------- */

function SidePanel({
  r,
  t,
  searchQuery,
  setSearchQuery,
  onSearch,
}: {
  r: Replay;
  t: (k: string) => string;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  onSearch: () => void;
}) {
  const [annotationText, setAnnotationText] = useState("");
  const [bookmarkLabel, setBookmarkLabel] = useState("");

  const handleAddAnnotation = useCallback(() => {
    if (!annotationText.trim() || !r.position) return;
    r.addAnnotation(r.position.currentTimeMs, annotationText.trim());
    setAnnotationText("");
  }, [annotationText, r]);

  const handleAddBookmark = useCallback(() => {
    if (!bookmarkLabel.trim() || !r.position) return;
    r.addBookmark(r.position.currentTimeMs, bookmarkLabel.trim());
    setBookmarkLabel("");
  }, [bookmarkLabel, r]);

  return (
    <aside className="sor-replay-side w-72 border-l border-[var(--color-border)] bg-[var(--color-surface)] flex flex-col overflow-hidden">
      {/* Search (only for terminal) */}
      {r.session?.replayType === "terminal" && (
        <div className="px-3 py-2 border-b border-[var(--color-border)]">
          <label className="text-[10px] uppercase tracking-wider text-[var(--color-textMuted)] mb-1 block">
            {t("replay.searchTerminal")}
          </label>
          <div className="flex gap-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSearch()}
              placeholder={t("replay.searchPlaceholder")}
              className="flex-1 px-2 py-1 text-xs bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            <button onClick={onSearch} className="sor-option-chip p-1" title={t("replay.search")}>
              <Search size={14} />
            </button>
          </div>
          {r.searchResults.length > 0 && (
            <ul className="mt-1 max-h-28 overflow-auto text-xs space-y-0.5">
              {r.searchResults.map((sr, i) => (
                <li key={i}>
                  <button
                    onClick={() => r.seek(sr.timeMs)}
                    className="w-full text-left px-1 py-0.5 rounded hover:bg-[var(--color-border)] text-[var(--color-textSecondary)] truncate"
                    title={sr.context}
                  >
                    <span className="text-primary">{fmtMs(sr.timeMs)}</span>{" "}
                    {sr.matchText}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Annotations */}
      <div className="px-3 py-2 border-b border-[var(--color-border)] flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-textMuted)] flex items-center gap-1">
            <MessageSquare size={10} />
            {t("replay.annotations")} ({r.annotations.length})
          </span>
        </div>
        <div className="flex gap-1 mb-1">
          <input
            type="text"
            value={annotationText}
            onChange={(e) => setAnnotationText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddAnnotation()}
            placeholder={t("replay.addAnnotation")}
            className="flex-1 px-2 py-1 text-xs bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <button
            onClick={handleAddAnnotation}
            disabled={!annotationText.trim() || !r.position}
            className="sor-option-chip p-1"
            title={t("replay.addAnnotation")}
          >
            <MessageSquarePlus size={14} />
          </button>
        </div>
        <ul className="flex-1 overflow-auto space-y-1 text-xs">
          {r.annotations.map((a: ReplayAnnotation) => (
            <li
              key={a.id}
              className="flex items-start gap-1 px-1.5 py-1 rounded bg-[var(--color-border)]/50 group"
            >
              <span
                className="mt-0.5 w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: a.color }}
              />
              <div className="flex-1 min-w-0">
                <button
                  onClick={() => r.seek(a.timeMs)}
                  className="text-primary hover:underline tabular-nums"
                >
                  {fmtMs(a.timeMs)}
                </button>
                <p className="text-[var(--color-textSecondary)] truncate">{a.text}</p>
              </div>
              <button
                onClick={() => r.removeAnnotation(a.id)}
                className="opacity-0 group-hover:opacity-100 text-[var(--color-textMuted)] hover:text-error transition-opacity"
                title={t("replay.removeAnnotation")}
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Bookmarks */}
      <div className="px-3 py-2 flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] uppercase tracking-wider text-[var(--color-textMuted)] flex items-center gap-1">
            <Bookmark size={10} />
            {t("replay.bookmarks")} ({r.bookmarks.length})
          </span>
        </div>
        <div className="flex gap-1 mb-1">
          <input
            type="text"
            value={bookmarkLabel}
            onChange={(e) => setBookmarkLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddBookmark()}
            placeholder={t("replay.addBookmark")}
            className="flex-1 px-2 py-1 text-xs bg-[var(--color-border)] border border-[var(--color-border)] rounded text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
          <button
            onClick={handleAddBookmark}
            disabled={!bookmarkLabel.trim() || !r.position}
            className="sor-option-chip p-1"
            title={t("replay.addBookmark")}
          >
            <BookmarkPlus size={14} />
          </button>
        </div>
        <ul className="flex-1 overflow-auto space-y-1 text-xs">
          {r.bookmarks.map((b: ReplayBookmark) => (
            <li
              key={b.id}
              className="flex items-center gap-1 px-1.5 py-1 rounded bg-[var(--color-border)]/50 group"
            >
              <ChevronRight size={10} className="text-[var(--color-textMuted)]" />
              <button
                onClick={() => r.seek(b.timeMs)}
                className="text-primary hover:underline tabular-nums"
              >
                {fmtMs(b.timeMs)}
              </button>
              <span className="flex-1 truncate text-[var(--color-textSecondary)]">{b.label}</span>
              <button
                onClick={() => r.removeBookmark(b.id)}
                className="opacity-0 group-hover:opacity-100 text-[var(--color-textMuted)] hover:text-error transition-opacity"
                title={t("replay.removeBookmark")}
              >
                <Trash2 size={12} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export const SessionReplayViewer: React.FC<SessionReplayViewerProps> = ({
  recordingId,
  replayType,
  onClose,
}) => {
  const { t } = useTranslation();
  const r = useReplay();
  const [searchQuery, setSearchQuery] = useState("");

  /* ---------- Load session on mount ---------- */
  useEffect(() => {
    switch (replayType) {
      case "terminal":
        r.loadTerminal(recordingId);
        break;
      case "video":
        r.loadVideo(recordingId);
        break;
      case "har":
        r.loadHar(recordingId);
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingId, replayType]);

  /* ---------- Load annotations & bookmarks after session ready ---------- */
  useEffect(() => {
    if (r.session) {
      r.loadAnnotations();
      r.loadBookmarks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.session?.id]);

  /* ---------- Keyboard shortcuts ---------- */
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          if (r.playbackState === "playing") r.pause();
          else if (r.playbackState === "paused" || r.playbackState === "stopped") r.play();
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (r.position) r.seek(Math.max(0, r.position.currentTimeMs - 5000));
          break;
        case "ArrowRight":
          e.preventDefault();
          if (r.position)
            r.seek(Math.min(r.position.totalTimeMs, r.position.currentTimeMs + 5000));
          break;
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [r]);

  /* ---------- Search handler ---------- */
  const handleSearch = useCallback(() => {
    if (searchQuery.trim()) r.search(searchQuery.trim());
  }, [searchQuery, r]);

  /* ---------- Export handler ---------- */
  const handleExport = useCallback(() => {
    const defaultFmt = replayType === "terminal" ? "asciicast" : replayType === "video" ? "mp4" : "har";
    r.exportRecording(defaultFmt, "");
  }, [r, replayType]);

  /* ---------- Timeline marker click ---------- */
  const handleMarkerClick = useCallback(
    (marker: TimelineMarker) => r.seek(marker.timeMs),
    [r],
  );

  /* ---------- Content pane by type ---------- */
  const contentPane = useMemo(() => {
    switch (r.session?.replayType) {
      case "terminal":
        return <TerminalPane r={r} />;
      case "video":
        return <VideoPane r={r} />;
      case "har":
        return <HarPane r={r} />;
      default:
        return null;
    }
  }, [r]);

  /* ---- Loading state ---- */
  if (r.playbackState === "loading") {
    return (
      <div className="sor-replay-viewer flex items-center justify-center h-full bg-[var(--color-surface)]">
        <div className="flex flex-col items-center gap-3 text-[var(--color-textSecondary)]">
          <Loader2 size={32} className="animate-spin text-primary" />
          <span className="text-sm">{t("replay.loading")}</span>
        </div>
      </div>
    );
  }

  /* ---- Error state ---- */
  if (r.playbackState === "error" || r.error) {
    return (
      <div className="sor-replay-viewer flex items-center justify-center h-full bg-[var(--color-surface)]">
        <div className="flex flex-col items-center gap-3 text-error max-w-md text-center">
          <AlertCircle size={32} />
          <span className="text-sm font-medium">{t("replay.errorTitle")}</span>
          <p className="text-xs text-[var(--color-textSecondary)]">
            {r.error ?? t("replay.unknownError")}
          </p>
          {onClose && (
            <button onClick={onClose} className="sor-option-chip text-xs mt-2">
              {t("common.close")}
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ---- Empty / idle state ---- */
  if (!r.session) {
    return (
      <div className="sor-replay-viewer flex items-center justify-center h-full bg-[var(--color-surface)]">
        <div className="flex flex-col items-center gap-3 text-[var(--color-textMuted)]">
          <FileQuestion size={32} />
          <span className="text-sm">{t("replay.noSession")}</span>
        </div>
      </div>
    );
  }

  /* ---- Main layout ---- */
  return (
    <div className="sor-replay-viewer flex flex-col h-full bg-[var(--color-surface)] text-[var(--color-text)]">
      <Header r={r} t={t} onExport={handleExport} onClose={onClose} />
      <PlaybackControls r={r} t={t} />
      <Timeline r={r} onMarkerClick={handleMarkerClick} />

      <div className="flex flex-1 min-h-0">
        {/* Main content area */}
        <div className="flex-1 flex flex-col min-w-0">
          {contentPane}
          {r.session.replayType === "har" && <HarStatsPanel r={r} t={t} />}
        </div>

        {/* Side panel */}
        <SidePanel
          r={r}
          t={t}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onSearch={handleSearch}
        />
      </div>
    </div>
  );
};

export default SessionReplayViewer;
