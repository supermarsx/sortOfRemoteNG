import { Minimize2 } from "lucide-react";
import { useSessionFullscreenController } from "../../hooks/session/useSessionFullscreen";

interface SessionFullscreenExitControlProps {
  sessionId: string;
  sessionName: string;
  isFullscreen: boolean;
  onExit: () => void;
}

export function SessionFullscreenExitControl({
  sessionId,
  sessionName,
  isFullscreen,
  onExit,
}: SessionFullscreenExitControlProps) {
  const controller = useSessionFullscreenController();
  const isActive = controller
    ? controller.activeSessionId === sessionId
    : isFullscreen;
  if (!isActive) return null;

  return (
    <div
      className="group pointer-events-none absolute inset-x-0 top-0 z-[1400] flex justify-center"
      role="toolbar"
      aria-label="Fullscreen session controls"
      data-testid="session-fullscreen-exit-control"
    >
      <button
        type="button"
        onClick={() =>
          controller ? controller.exitFullscreen(sessionId) : onExit()
        }
        className="pointer-events-auto flex -translate-y-[calc(100%-0.5rem)] items-center gap-2 rounded-b-lg border border-t-0 border-[var(--color-border)] bg-[var(--color-surface)]/95 px-4 pb-2 pt-2.5 text-xs font-medium text-[var(--color-text)] shadow-xl backdrop-blur transition-transform duration-200 hover:translate-y-0 focus:translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary group-hover:translate-y-0 motion-reduce:transition-none"
        aria-label={`Exit no-distraction fullscreen for ${sessionName}`}
        aria-keyshortcuts="Escape"
        title="Exit no-distraction fullscreen (Esc)"
      >
        <Minimize2 size={14} aria-hidden="true" />
        <span>Exit fullscreen</span>
        <kbd className="rounded border border-[var(--color-border)] px-1 py-0.5 text-[10px] text-[var(--color-textMuted)]">
          Esc
        </kbd>
      </button>
    </div>
  );
}
