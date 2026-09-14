import React, { useEffect, useId, useRef, useState } from "react";
import { Check, Clock3 } from "lucide-react";
import { LoadingElement } from "../../ui/display/loadingElement";
import { useSessionRenderActivity } from "../../../contexts/SessionRenderActivityContext";

const stages = {
  capabilities: {
    title: "Checking desktop capabilities…",
    detail:
      "Verifying native Synology NAS API availability in this desktop build. No NAS sign-in has started.",
  },
  signin: {
    title: "Resolving the NAS and signing in…",
    detail:
      "Waiting for the native request on the selected app-wide route: direct or an HTTP(S) proxy. QuickConnect addresses are resolved before DSM API discovery and sign-in. These steps are reported together, not as separate progress events.",
  },
  verification: {
    title: "Verifying the one-time code…",
    detail:
      "Waiting for DSM to accept the sign-in and verification code. The code is not saved and a rejected attempt is not retried automatically.",
  },
  shares: {
    title: "Loading shared folders…",
    detail:
      "The API session is established. Reading the first page of shared folders available to this DSM account; administration data loads only when its section is opened.",
  },
  folder: {
    title: "Loading folder contents…",
    detail:
      "Reading the requested File Station folder. No file changes are being made.",
  },
} as const;

/** Only observed requests become stages. There is no estimated percent or
 * invented network/authentication sub-stage in the native login call. */
export default function SynologyInitializationStatus({
  phase,
  completed = [],
  onCancel,
  compact = false,
  isActive = true,
}: {
  phase: keyof typeof stages;
  completed?: readonly string[];
  onCancel?: () => void;
  compact?: boolean;
  isActive?: boolean;
}) {
  const titleId = useId();
  const { isActive: renderActive } = useSessionRenderActivity();
  const active = isActive && renderActive;
  const [documentVisible, setDocumentVisible] = useState(
    () =>
      typeof document !== "undefined" && document.visibilityState !== "hidden",
  );
  const startedAt = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    startedAt.current = Date.now();
    setElapsed(0);
  }, [phase]);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = () =>
      setElapsed(
        Math.max(0, Math.floor((Date.now() - startedAt.current) / 1000)),
      );
    const observe = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      const visible = document.visibilityState !== "hidden";
      setDocumentVisible(visible);
      if (!active || !visible) return;
      update();
      timer = setInterval(update, 1000);
    };
    observe();
    document.addEventListener("visibilitychange", observe);
    return () => {
      if (timer !== undefined) clearInterval(timer);
      document.removeEventListener("visibilitychange", observe);
    };
  }, [phase, active]);
  const stage = stages[phase];
  return (
    <section
      aria-labelledby={titleId}
      className={`w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] ${compact ? "p-4" : "max-w-lg p-6"}`}
    >
      <div className="flex items-start gap-4">
        <div aria-hidden="true" className="shrink-0 pt-1">
          <LoadingElement
            size={48}
            paused={!active || !documentVisible}
            ariaLabel="NAS request pending"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="mb-1 text-xs text-[var(--color-textSecondary)]">
            Synology NAS API
          </p>
          <div role="status" aria-live="polite" aria-atomic="true">
            <h2
              id={titleId}
              className="text-base font-semibold text-[var(--color-text)]"
            >
              {stage.title}
            </h2>
            <p className="mt-2 text-sm text-[var(--color-textSecondary)]">
              {stage.detail}
            </p>
          </div>
          {!!completed.length && (
            <ul
              aria-label="Completed connection stages"
              className="mt-3 space-y-1 text-xs text-[var(--color-textSecondary)]"
            >
              {completed.map((label) => (
                <li key={label} className="flex items-center gap-2">
                  <Check
                    size={13}
                    aria-hidden="true"
                    className="shrink-0 text-[var(--color-primary)]"
                  />
                  {label}
                </li>
              ))}
            </ul>
          )}
          <p
            className="mt-3 flex items-center gap-1.5 text-xs tabular-nums text-[var(--color-textSecondary)]"
            aria-live="off"
          >
            <Clock3 size={12} aria-hidden="true" />
            <span aria-label="Current stage elapsed time">
              {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}{" "}
              elapsed in this stage
            </span>
          </p>
        </div>
      </div>
      {onCancel && (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className="sor-btn sor-btn-secondary"
            onClick={onCancel}
          >
            Cancel connection
          </button>
        </div>
      )}
    </section>
  );
}
