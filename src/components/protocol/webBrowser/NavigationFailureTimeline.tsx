import type {
  WebNavigationTimeline,
  WebNavigationTimelineStep,
} from "../../../types/security/certificateInspection";

import React, { useId } from "react";
import { CheckCircle2, Circle, XCircle } from "lucide-react";
import { formatDurationMs } from "../../../utils/security/certificateInspectionFailure";

const STATUS_TEXT: Record<WebNavigationTimelineStep["status"], string> = {
  pass: "passed",
  fail: "failed",
  not_started: "not started",
};

function StepIcon({ status }: { status: WebNavigationTimelineStep["status"] }) {
  switch (status) {
    case "pass":
      return (
        <CheckCircle2
          size={15}
          className="mt-0.5 shrink-0 text-success"
          aria-hidden="true"
        />
      );
    case "fail":
      return (
        <XCircle
          size={15}
          className="mt-0.5 shrink-0 text-error"
          aria-hidden="true"
        />
      );
    default:
      return (
        <Circle
          size={15}
          className="mt-0.5 shrink-0 text-[var(--color-textMuted)]"
          aria-hidden="true"
        />
      );
  }
}

/** Measured start and end of the failed attempt, in the viewer's locale. */
function AttemptSummary({ timeline }: { timeline: WebNavigationTimeline }) {
  const failedAfter = `failed after ${formatDurationMs(Math.max(0, timeline.failedAfterMs))}`;
  const started = new Date(timeline.startedAt);
  if (!Number.isFinite(started.getTime())) {
    return <>Attempt {failedAfter}</>;
  }
  return (
    <>
      Attempt started{" "}
      <time dateTime={started.toISOString()}>
        {started.toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })}
      </time>{" "}
      · {failedAfter}
    </>
  );
}

/**
 * The stages this page load actually went through before it failed, with the
 * durations the app measured. Stages after the failure are listed as not
 * started so the page never implies a later check (such as the certificate
 * trust check) ran.
 */
const NavigationFailureTimeline: React.FC<{
  timeline: WebNavigationTimeline;
}> = ({ timeline }) => {
  const headingId = useId();
  return (
    <section
      className="mt-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
      aria-labelledby={headingId}
      data-testid="web-navigation-timeline"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={headingId} className="text-sm font-semibold">
          Connection timeline
        </h3>
        <span className="text-xs text-[var(--color-textMuted)]">
          {timeline.route === "proxy"
            ? "Through the configured proxy"
            : "Direct connection"}
        </span>
      </div>
      <p className="mt-1 text-xs text-[var(--color-textSecondary)]">
        <AttemptSummary timeline={timeline} />
      </p>
      {timeline.steps.length > 0 && (
        <ol className="mt-3 space-y-2" aria-label="Connection stages">
          {timeline.steps.map((step) => (
            <li
              key={step.id}
              className="flex items-start gap-2"
              data-status={step.status}
            >
              <StepIcon status={step.status} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span
                    className={`text-xs font-semibold ${
                      step.status === "not_started"
                        ? "text-[var(--color-textMuted)]"
                        : ""
                    }`}
                  >
                    {step.label}
                    <span className="sr-only">{`: ${STATUS_TEXT[step.status]}`}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-[var(--color-textMuted)]">
                    {step.durationMs !== null
                      ? formatDurationMs(Math.max(0, step.durationMs))
                      : step.status === "not_started"
                        ? "Not started"
                        : null}
                  </span>
                </div>
                {step.detail && (
                  <p
                    className={`mt-0.5 text-xs leading-5 ${
                      step.status === "fail"
                        ? "text-error"
                        : "text-[var(--color-textSecondary)]"
                    }`}
                  >
                    {step.detail}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
};

export default NavigationFailureTimeline;
