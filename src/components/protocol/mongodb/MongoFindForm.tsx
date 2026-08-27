import { LoaderCircle, Search } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type {
  MongoFindForm as MongoFindFormState,
  MongoFormErrors,
} from "../../../hooks/protocol/useMongoDBClient";
import { MONGO_FIND_LIMIT_MAX } from "../../../types/mongodb";

interface MongoFindFormProps {
  sessionId: string;
  form: MongoFindFormState;
  errors: MongoFormErrors;
  disabled: boolean;
  isExecuting: boolean;
  onChange: <K extends keyof MongoFindFormState>(
    key: K,
    value: MongoFindFormState[K],
  ) => void;
  onRun: () => void;
  onCount: () => void;
}

const JsonField = ({
  id,
  label,
  value,
  error,
  placeholder,
  testId,
  rows,
  onChange,
  onKeyDown,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  placeholder: string;
  testId: string;
  rows: number;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}) => (
  <div className="min-w-0">
    <label
      htmlFor={id}
      className="mb-1 block text-xs font-medium text-[var(--color-text)]"
    >
      {label}
    </label>
    <textarea
      id={id}
      data-testid={testId}
      rows={rows}
      className={`w-full resize-y rounded border bg-[var(--color-input)] px-2 py-1.5 font-mono text-xs text-[var(--color-text)] outline-none focus:border-primary ${error ? "border-error" : "border-[var(--color-border)]"}`}
      value={value}
      spellCheck={false}
      placeholder={placeholder}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
    />
    {error && (
      <p
        id={`${id}-error`}
        role="alert"
        data-testid={`${testId}-error`}
        className="mt-1 text-[11px] text-error"
      >
        {error}
      </p>
    )}
  </div>
);

export function MongoFindForm({
  sessionId,
  form,
  errors,
  disabled,
  isExecuting,
  onChange,
  onRun,
  onCount,
}: MongoFindFormProps) {
  const { t } = useTranslation();
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      if (!disabled) onRun();
    }
  };

  return (
    <div
      className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-surface)] p-3"
      data-testid="mongodb-find-form"
    >
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <JsonField
          id={`mongodb-filter-${sessionId}`}
          label={t("mongoClient.find.filter", "Filter")}
          value={form.filter}
          error={errors.filter}
          placeholder='{"city": "London"}'
          testId="mongodb-filter"
          rows={3}
          onChange={(value) => onChange("filter", value)}
          onKeyDown={onKeyDown}
        />
        <JsonField
          id={`mongodb-projection-${sessionId}`}
          label={t("mongoClient.find.projection", "Projection")}
          value={form.projection}
          error={errors.projection}
          placeholder='{"name": 1, "_id": 0}'
          testId="mongodb-projection"
          rows={3}
          onChange={(value) => onChange("projection", value)}
          onKeyDown={onKeyDown}
        />
        <JsonField
          id={`mongodb-sort-${sessionId}`}
          label={t("mongoClient.find.sort", "Sort")}
          value={form.sort}
          error={errors.sort}
          placeholder='{"name": 1}'
          testId="mongodb-sort"
          rows={3}
          onChange={(value) => onChange("sort", value)}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <label className="text-xs text-[var(--color-textSecondary)]">
          {t("mongoClient.find.limit", "Limit")}
          <input
            type="number"
            data-testid="mongodb-limit"
            min={1}
            max={MONGO_FIND_LIMIT_MAX}
            className="ml-2 w-24 rounded border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1 text-xs text-[var(--color-text)]"
            value={form.limit}
            onChange={(event) =>
              onChange("limit", Number.parseInt(event.target.value, 10) || 0)
            }
          />
        </label>
        <label className="text-xs text-[var(--color-textSecondary)]">
          {t("mongoClient.find.skip", "Skip")}
          <input
            type="number"
            data-testid="mongodb-skip"
            min={0}
            className="ml-2 w-24 rounded border border-[var(--color-border)] bg-[var(--color-input)] px-2 py-1 text-xs text-[var(--color-text)]"
            value={form.skip}
            onChange={(event) =>
              onChange("skip", Number.parseInt(event.target.value, 10) || 0)
            }
          />
        </label>
        <span className="hidden text-[10px] text-[var(--color-textMuted)] sm:inline">
          {t("mongoClient.find.shortcut", "Ctrl/⌘ + Enter runs the query")}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            data-testid="mongodb-count"
            className="rounded border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text)] disabled:opacity-50"
            disabled={disabled}
            onClick={onCount}
          >
            {t("mongoClient.find.count", "Count")}
          </button>
          <button
            type="button"
            data-testid="mongodb-find"
            className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-xs text-white disabled:opacity-50"
            disabled={disabled}
            onClick={onRun}
          >
            {isExecuting ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : (
              <Search size={14} />
            )}
            {t("mongoClient.find.run", "Find")}
          </button>
        </div>
      </div>
    </div>
  );
}
