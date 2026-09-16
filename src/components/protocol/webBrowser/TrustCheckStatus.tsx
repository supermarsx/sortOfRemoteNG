import type { WebTrustCheck } from "../../../types/security/certificateInspection";

import React, { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { displayAuthority } from "../../../utils/security/certificateInspectionFailure";

const TICK_MS = 500;
/** The caption stays hidden for quick checks so it never flashes. */
const CAPTION_DELAY_MS = 1_000;
/** Screen readers hear the counter in coarse steps, not every tick. */
const ANNOUNCE_STEP_SECS = 5;

/** Wall-clock milliseconds since `startedAt` (epoch ms), refreshed every tick. */
function useElapsedMs(startedAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : 0;
}

function formatWholeSeconds(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds} s`;
  return `${Math.floor(totalSeconds / 60)} min ${totalSeconds % 60} s`;
}

function ElapsedText({ seconds }: { seconds: number }) {
  const announced =
    Math.floor(seconds / ANNOUNCE_STEP_SECS) * ANNOUNCE_STEP_SECS;
  return (
    <>
      <span aria-hidden="true">{formatWholeSeconds(seconds)}</span>
      {announced > 0 && (
        <span className="sr-only">
          {`, ${formatWholeSeconds(announced)} elapsed`}
        </span>
      )}
    </>
  );
}

/**
 * Live whole-second counter. The ticking digits are hidden from assistive
 * technology; a visually hidden copy changes only every few seconds so a
 * surrounding live region is not re-announced on every tick. Remount it (via
 * `key`) when a new attempt starts.
 */
export const ElapsedSeconds: React.FC<{ startedAt: number }> = ({
  startedAt,
}) => <ElapsedText seconds={Math.floor(useElapsedMs(startedAt) / 1000)} />;

/**
 * Non-blocking caption shown while the native certificate inspection runs, so
 * a slow or silent host visibly counts up instead of looking stalled.
 */
const TrustCheckStatus: React.FC<{ trustCheck: WebTrustCheck }> = ({
  trustCheck,
}) => {
  const elapsedMs = useElapsedMs(trustCheck.startedAt);
  const authority = displayAuthority(trustCheck.host, trustCheck.port);
  // The live region stays mounted for the whole check so its later content is
  // announced reliably; the caption itself appears only after the delay.
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-4"
      role="status"
      aria-live="polite"
    >
      {elapsedMs >= CAPTION_DELAY_MS && (
        <p
          className="flex max-w-full items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-textSecondary)] shadow-sm"
          data-testid="web-trust-check-status"
        >
          <ShieldCheck
            size={14}
            className="shrink-0 text-primary"
            aria-hidden="true"
          />
          <span className="min-w-0 break-words">
            {trustCheck.route === "proxy"
              ? `Checking the HTTPS certificate for ${authority} through the configured proxy`
              : `Checking the HTTPS certificate for ${authority}`}
          </span>{" "}
          <span className="shrink-0 font-mono text-[var(--color-textMuted)]">
            <span aria-hidden="true">· </span>
            <ElapsedText seconds={Math.floor(elapsedMs / 1000)} />
          </span>
        </p>
      )}
    </div>
  );
};

export default TrustCheckStatus;
