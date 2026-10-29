import React from "react";
import {
  BROWSER_SESSION_STATUS_META,
  type BrowserSessionStatus,
} from "./browserSessionList";

const TONE_CLASSES = {
  ok: "bg-success/15 text-success border-success/30",
  warn: "bg-warning/15 text-warning border-warning/30",
  err: "bg-error/15 text-error border-error/30",
  muted:
    "bg-[var(--color-textMuted)]/10 text-[var(--color-textMuted)] border-[var(--color-border)]",
} as const;

/** Same pill shape and tones as the Session Manager's RDP status column. */
export const BrowserSessionStatusPill: React.FC<{
  status: BrowserSessionStatus;
  title?: string;
}> = ({ status, title }) => {
  const meta = BROWSER_SESSION_STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 text-[10px] uppercase tracking-wide rounded border ${TONE_CLASSES[meta.tone]}`}
      data-testid={`browser-session-status-${status}`}
      title={title}
    >
      {meta.label}
    </span>
  );
};
