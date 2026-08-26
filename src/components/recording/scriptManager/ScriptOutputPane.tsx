import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, Loader2, WrapText, X } from "lucide-react";

/**
 * Structural types for the pane. They deliberately mirror the
 * `useScriptRun` contract (see `src/types/ssh/scriptRun.ts`) without
 * importing it so the pane stays a pure presentational component that
 * any producer of stdout/stderr chunks can drive.
 */
export type ScriptOutputStream = "stdout" | "stderr";

export interface ScriptOutputChunkLike {
  stream: ScriptOutputStream;
  data: string;
  sequence: number;
}

export type ScriptOutputStatus =
  | "idle"
  | "running"
  | "finished"
  | "failed"
  | "cancelled";

export interface ScriptOutputPaneProps {
  chunks: ReadonlyArray<ScriptOutputChunkLike>;
  status: ScriptOutputStatus;
  exitCode?: number | null;
  error?: string | null;
  truncated?: boolean;
  durationMs?: number | null;
  notices?: ReadonlyArray<string>;
  onCancel?: () => void;
  onDismiss?: () => void;
  /** Initial pane height in px (user-resizable afterwards). */
  initialHeight?: number;
}

/** Distance from the bottom (px) still considered "at the bottom". */
export const FOLLOW_THRESHOLD_PX = 8;
export const MIN_PANE_HEIGHT_PX = 160;
export const MAX_PANE_HEIGHT_PX = 2000;
const DEFAULT_PANE_HEIGHT_PX = 300;

interface Segment {
  stream: ScriptOutputStream;
  data: string;
  key: number;
}

/** Merge runs of adjacent same-stream chunks so a chatty script does not
 *  produce one DOM node per chunk. Arrival order is preserved. */
function coalesce(chunks: ReadonlyArray<ScriptOutputChunkLike>): Segment[] {
  const out: Segment[] = [];
  for (const chunk of chunks) {
    const last = out[out.length - 1];
    if (last && last.stream === chunk.stream) {
      last.data += chunk.data;
    } else {
      out.push({ stream: chunk.stream, data: chunk.data, key: chunk.sequence });
    }
  }
  return out;
}

function isAtBottom(el: HTMLElement): boolean {
  return (
    el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD_PX
  );
}

function ScriptOutputPane({
  chunks,
  status,
  exitCode = null,
  error = null,
  truncated = false,
  durationMs = null,
  notices = [],
  onCancel,
  onDismiss,
  initialHeight = DEFAULT_PANE_HEIGHT_PX,
}: ScriptOutputPaneProps) {
  const { t } = useTranslation();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const [wrap, setWrap] = useState(false);
  const [height, setHeight] = useState(() =>
    Math.min(MAX_PANE_HEIGHT_PX, Math.max(MIN_PANE_HEIGHT_PX, initialHeight)),
  );
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const segments = useMemo(() => coalesce(chunks), [chunks]);

  const scrollToBottom = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  // Auto-follow: after every append, stick to the bottom while following.
  // When not following we touch nothing, so the user's offset is preserved
  // (new content grows below the viewport and scrollTop stays put).
  useLayoutEffect(() => {
    if (following) scrollToBottom();
  }, [segments, following, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const atBottom = isAtBottom(el);
    setFollowing((prev) => (prev === atBottom ? prev : atBottom));
  }, []);

  const resumeFollowing = useCallback(() => {
    setFollowing(true);
    scrollToBottom();
  }, [scrollToBottom]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const el = scrollerRef.current;
      if (!el) return;
      if (e.key === "Home") {
        e.preventDefault();
        el.scrollTop = 0;
        setFollowing(false);
      } else if (e.key === "End") {
        e.preventDefault();
        resumeFollowing();
      }
    },
    [resumeFollowing],
  );

  // Resize handle (pointer drag on the bottom edge).
  const handleResizeStart = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragRef.current = { startY: e.clientY, startHeight: height };
    },
    [height],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const next = Math.min(
        MAX_PANE_HEIGHT_PX,
        Math.max(
          MIN_PANE_HEIGHT_PX,
          drag.startHeight + (e.clientY - drag.startY),
        ),
      );
      setHeight(next);
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      // Height changed → re-evaluate follow state without moving the user.
      if (following) scrollToBottom();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
  }, [following, scrollToBottom]);

  const running = status === "running";
  const failed =
    status === "failed" ||
    status === "cancelled" ||
    (exitCode !== null && exitCode !== 0);
  const showEmpty = !running && segments.length === 0 && !error;

  const title = running
    ? t("scriptManager.output.running", "Running…")
    : status === "cancelled"
      ? t("scriptManager.output.cancelled", "Execution Cancelled")
      : status === "failed"
        ? t("scriptManager.output.failed", "Execution Failed")
        : t("scriptManager.output.title", "Execution Output");

  const frameClass = running
    ? "border-[var(--color-border)] bg-[var(--color-background)]"
    : failed
      ? "border-red-500/30 bg-red-500/5"
      : "border-green-500/30 bg-green-500/5";
  const titleClass = running
    ? "text-[var(--color-text)]"
    : failed
      ? "text-red-400"
      : "text-green-400";

  const scrollerStyle: CSSProperties = {
    height,
    minHeight: MIN_PANE_HEIGHT_PX,
    overscrollBehavior: "contain",
    scrollBehavior: "auto",
  };

  return (
    <div
      data-testid="script-output-pane"
      data-status={status}
      className={`mt-4 rounded-lg border ${frameClass}`}
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          {running && (
            <Loader2
              size={14}
              className="animate-spin text-[var(--color-textMuted)]"
            />
          )}
          <span className={`text-sm font-medium ${titleClass}`}>{title}</span>
          {exitCode !== null && (
            <span
              data-testid="script-output-exit"
              className={`text-xs px-1.5 py-0.5 rounded font-mono ${
                exitCode === 0
                  ? "bg-green-500/20 text-green-400"
                  : "bg-red-500/20 text-red-400"
              }`}
            >
              {t("scriptManager.output.exit", "exit")} {exitCode}
            </span>
          )}
          {durationMs !== null && !running && (
            <span className="text-xs text-[var(--color-textMuted)] font-mono">
              {(durationMs / 1000).toFixed(1)}s
            </span>
          )}
          {truncated && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400">
              {t("scriptManager.output.truncated", "truncated")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setWrap((w) => !w)}
            aria-pressed={wrap}
            data-testid="script-output-wrap"
            className={`sor-icon-btn ${wrap ? "text-primary" : ""}`}
            title={t("scriptManager.output.wrap", "Wrap long lines")}
          >
            <WrapText size={14} />
          </button>
          {running && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              data-testid="script-output-cancel"
              className="text-xs px-2 py-1 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10"
            >
              {t("scriptManager.output.cancel", "Cancel")}
            </button>
          )}
          {!running && onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="sor-icon-btn"
              title={t("scriptManager.output.dismiss", "Dismiss")}
              aria-label={t("scriptManager.output.dismiss", "Dismiss")}
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {notices.length > 0 && (
        <div className="px-4 pb-2 space-y-1">
          {notices.map((n, i) => (
            <div key={i} className="text-xs text-yellow-400">
              {n}
            </div>
          ))}
        </div>
      )}

      <div className="relative">
        <div
          ref={scrollerRef}
          data-testid="script-output-scroller"
          role="log"
          aria-live="polite"
          tabIndex={0}
          onScroll={handleScroll}
          onKeyDown={handleKeyDown}
          style={scrollerStyle}
          className="mx-4 overflow-auto rounded border border-[var(--color-border)] bg-[var(--color-background)] focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <pre
            data-testid="script-output-text"
            style={{ whiteSpace: wrap ? "pre-wrap" : "pre" }}
            className={`text-xs font-mono p-2 text-[var(--color-text)] ${
              wrap ? "break-words" : ""
            }`}
          >
            {segments.map((s) => (
              <span
                key={s.key}
                data-stream={s.stream}
                className={
                  s.stream === "stderr"
                    ? "script-output-stderr text-red-300"
                    : "script-output-stdout"
                }
              >
                {s.data}
              </span>
            ))}
            {error && (
              <span
                data-stream="error"
                className="script-output-stderr text-red-300"
              >
                {segments.length > 0 ? "\n" : ""}
                {error}
              </span>
            )}
            {showEmpty && (
              <span className="text-[var(--color-textMuted)]">
                {t("scriptManager.output.empty", "(no output)")}
              </span>
            )}
          </pre>
        </div>
        {!following && (
          <button
            type="button"
            data-testid="script-output-follow"
            onClick={resumeFollowing}
            className="absolute bottom-3 right-8 inline-flex items-center gap-1 rounded-full bg-primary text-white text-xs px-3 py-1 shadow-lg hover:opacity-90"
          >
            {t("scriptManager.output.jumpToLatest", "Jump to latest")}
            <ArrowDown size={12} />
          </button>
        )}
      </div>

      <div
        data-testid="script-output-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("scriptManager.output.resize", "Resize output")}
        onPointerDown={handleResizeStart}
        className="mx-4 my-1 h-2 cursor-row-resize flex items-center justify-center"
      >
        <div className="h-0.5 w-10 rounded bg-[var(--color-border)]" />
      </div>
    </div>
  );
}

export default ScriptOutputPane;
