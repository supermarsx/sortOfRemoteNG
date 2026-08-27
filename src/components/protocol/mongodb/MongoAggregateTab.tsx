import { LoaderCircle, Play } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

interface MongoAggregateTabProps {
  sessionId: string;
  pipelineText: string;
  error?: string;
  disabled: boolean;
  isExecuting: boolean;
  onChange: (value: string) => void;
  onRun: () => void;
}

/** Aggregation pipeline editor. Output renders in the shared results area. */
export function MongoAggregateTab({
  sessionId,
  pipelineText,
  error,
  disabled,
  isExecuting,
  onChange,
  onRun,
}: MongoAggregateTabProps) {
  const { t } = useTranslation();
  const editorId = `mongodb-aggregate-${sessionId}`;

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      if (!disabled) onRun();
    }
  };

  return (
    <div
      className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)] p-3"
      data-testid="mongodb-aggregate-form"
    >
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <label
          htmlFor={editorId}
          className="text-xs font-medium text-[var(--color-text)]"
        >
          {t("mongoClient.aggregate.title", "Aggregation pipeline")}
        </label>
        <button
          type="button"
          data-testid="mongodb-aggregate-run"
          className="flex items-center gap-1.5 rounded border border-primary px-3 py-1 text-xs text-primary disabled:opacity-50"
          disabled={disabled}
          onClick={onRun}
        >
          {isExecuting ? (
            <LoaderCircle size={14} className="animate-spin" />
          ) : (
            <Play size={14} />
          )}
          {t("mongoClient.aggregate.run", "Run pipeline")}
        </button>
      </div>
      <textarea
        id={editorId}
        data-testid="mongodb-aggregate-editor"
        rows={3}
        className={`w-full resize-y rounded border bg-[var(--color-input)] px-2 py-1.5 font-mono text-xs text-[var(--color-text)] outline-none focus:border-primary ${error ? "border-error" : "border-[var(--color-border)]"}`}
        value={pipelineText}
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {error && (
        <p
          role="alert"
          data-testid="mongodb-aggregate-error"
          className="mt-1 text-[11px] text-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}
