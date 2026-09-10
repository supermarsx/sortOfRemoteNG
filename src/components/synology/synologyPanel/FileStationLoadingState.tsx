import { useEffect, useRef, useState } from "react";
import { LoadingElement } from "../../ui/display/loadingElement";
import { useSessionRenderActivity } from "../../../contexts/SessionRenderActivityContext";

/** An observed folder read, kept inside the mounted explorer viewport. */
export default function FileStationLoadingState({
  root,
  refreshing,
  isActive,
}: {
  root: boolean;
  refreshing: boolean;
  isActive: boolean;
}) {
  const { isActive: renderActive } = useSessionRenderActivity();
  const active = isActive && renderActive;
  const started = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [visible, setVisible] = useState(
    () =>
      typeof document !== "undefined" && document.visibilityState !== "hidden",
  );
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const observe = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      const shown = document.visibilityState !== "hidden";
      setVisible(shown);
      if (!active || !shown) return;
      const tick = () =>
        setElapsed(
          Math.max(0, Math.floor((Date.now() - started.current) / 1000)),
        );
      tick();
      timer = setInterval(tick, 1000);
    };
    observe();
    document.addEventListener("visibilitychange", observe);
    return () => {
      if (timer !== undefined) clearInterval(timer);
      document.removeEventListener("visibilitychange", observe);
    };
  }, [active]);
  return (
    <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-textSecondary)]">
      <span aria-hidden="true" className="shrink-0">
        <LoadingElement
          size={24}
          paused={!active || !visible}
          ariaLabel="NAS folder request pending"
        />
      </span>
      <div role="status" aria-live="polite" className="min-w-0 flex-1">
        <h4 className="font-medium text-[var(--color-text)]">
          {refreshing
            ? "Refreshing folder contents…"
            : root
              ? "Loading shared folders…"
              : "Loading folder contents…"}
        </h4>
        <span>
          {refreshing
            ? "Displayed rows are read-only until this request finishes."
            : "Waiting for the NAS file listing. Navigation remains available."}
        </span>
      </div>
      <span
        className="shrink-0 tabular-nums"
        aria-label="Current folder request elapsed time"
        aria-live="off"
      >
        {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
      </span>
    </div>
  );
}
