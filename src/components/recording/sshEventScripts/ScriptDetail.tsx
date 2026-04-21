import React from "react";
import { TRIGGER_TYPES } from "../../../types/ssh/sshScripts";
import type { ScriptDetailProps } from "./types";
import { Section, InfoCard } from "./helpers";

export const ScriptDetail: React.FC<ScriptDetailProps> = ({
  script,
  stats: s,
  onRun,
  onDuplicate,
  onDelete,
  onToggle,
}) => {
  const triggerInfo = TRIGGER_TYPES.find(
    (t) => t.value === script.trigger.type,
  );

  return (
    <div className="p-6">
      {/* Title bar */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-[var(--color-text)]">{script.name}</h3>
          {script.description && (
            <p className="mt-1 text-sm text-text-muted">
              {script.description}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onRun}
            className="rounded-lg bg-success px-4 py-1.5 text-sm text-[var(--color-text)] hover:bg-success/90"
          >
            ▶ Run
          </button>
          <button
            onClick={onToggle}
            className="rounded-lg border border-theme-border px-3 py-1.5 text-sm text-text-secondary hover:bg-surfaceHover"
          >
            {script.enabled ? "Disable" : "Enable"}
          </button>
          <button
            onClick={onDuplicate}
            className="rounded-lg border border-theme-border px-3 py-1.5 text-sm text-text-secondary hover:bg-surfaceHover"
          >
            Duplicate
          </button>
          <button
            onClick={onDelete}
            className="rounded-lg border border-error px-3 py-1.5 text-sm text-error hover:bg-error/40"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Metadata grid */}
      <div className="mt-6 grid grid-cols-3 gap-4">
        <InfoCard
          label="Trigger"
          value={triggerInfo?.label ?? script.trigger.type}
          sub={triggerInfo?.description}
        />
        <InfoCard
          label="Language"
          value={script.language}
          sub={script.executionMode}
        />
        <InfoCard
          label="Status"
          value={script.enabled ? "Enabled ✅" : "Disabled ⛔"}
          sub={`Priority: ${script.priority}`}
        />
        {s && (
          <>
            <InfoCard
              label="Total Runs"
              value={String(s.totalRuns)}
              sub={`${s.successes} ok · ${s.failures} failed`}
            />
            <InfoCard
              label="Avg Duration"
              value={`${Math.round(s.averageDurationMs)}ms`}
              sub={s.lastRunAt ? `Last: ${new Date(s.lastRunAt).toLocaleString()}` : undefined}
            />
            <InfoCard
              label="Timeouts"
              value={String(s.timeouts)}
              sub={`Timeout: ${script.timeoutMs}ms`}
            />
          </>
        )}
      </div>

      {/* Trigger details */}
      <Section title="Trigger Configuration">
        <pre className="rounded-lg bg-surface p-3 text-xs text-text-secondary">
          {JSON.stringify(script.trigger, null, 2)}
        </pre>
      </Section>

      {/* Conditions */}
      {script.conditions.length > 0 && (
        <Section title={`Conditions (${script.conditions.length})`}>
          {script.conditions.map((c, i) => (
            <pre
              key={i}
              className="mb-2 rounded-lg bg-surface p-3 text-xs text-text-secondary"
            >
              {JSON.stringify(c, null, 2)}
            </pre>
          ))}
        </Section>
      )}

      {/* Variables */}
      {script.variables.length > 0 && (
        <Section title={`Variables (${script.variables.length})`}>
          <div className="space-y-2">
            {script.variables.map((v, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-lg bg-surface px-3 py-2"
              >
                <code className="text-sm font-medium text-primary">
                  {v.name}
                </code>
                <span className="rounded bg-surfaceHover px-1.5 py-0.5 text-[10px] text-text-muted">
                  {v.source.type}
                </span>
                {v.sensitive && (
                  <span className="text-[10px] text-warning">
                    🔒 sensitive
                  </span>
                )}
                <span className="ml-auto text-xs text-text-secondary">
                  default: {v.defaultValue || "—"}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Script content */}
      <Section title="Script Content">
        <pre className="max-h-[40vh] overflow-auto rounded-lg bg-background p-4 text-xs text-success">
          {script.content}
        </pre>
      </Section>

      {/* Tags & scope */}
      <div className="mt-4 flex flex-wrap gap-2">
        {script.tags.map((t) => (
          <span
            key={t}
            className="rounded-full bg-primary/40 px-2.5 py-0.5 text-xs text-primary"
          >
            #{t}
          </span>
        ))}
        {script.category && (
          <span className="rounded-full bg-primary/40 px-2.5 py-0.5 text-xs text-primary">
            📁 {script.category}
          </span>
        )}
      </div>
      <div className="mt-2 text-xs text-text-muted">
        Created {new Date(script.createdAt).toLocaleString()} · Updated{" "}
        {new Date(script.updatedAt).toLocaleString()} · v{script.version}
        {script.author && ` · by ${script.author}`}
      </div>
    </div>
  );
};
