import { ListTree, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { MongoFormErrors } from "../../../hooks/protocol/useMongoDBClient";
import type { MongoIndexInfo } from "../../../types/mongodb";
import { formatMongoCell } from "./MongoResultsGrid";

interface MongoIndexesTabProps {
  indexes: MongoIndexInfo[];
  errors: MongoFormErrors;
  disabled: boolean;
  editMode: boolean;
  hasTarget: boolean;
  onRefresh: () => void;
  onCreate: (keysText: string, optionsText: string) => void;
  onDrop: (name: string) => void;
}

const indexFlags = (index: MongoIndexInfo): string => {
  const ttl = index.options?.expireAfterSeconds;
  return (
    [
      index.unique ? "unique" : null,
      index.sparse ? "sparse" : null,
      typeof ttl === "number" ? `ttl ${ttl}s` : null,
    ]
      .filter(Boolean)
      .join(" · ") || "—"
  );
};

/** Sidebar panel listing the selected collection's indexes. */
export function MongoIndexesTab({
  indexes,
  errors,
  disabled,
  editMode,
  hasTarget,
  onRefresh,
  onCreate,
  onDrop,
}: MongoIndexesTabProps) {
  const { t } = useTranslation();
  const [keysText, setKeysText] = useState('{"field": 1}');
  const [optionsText, setOptionsText] = useState("");

  return (
    <div className="border-t border-[var(--color-border)]">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)]">
          <ListTree size={14} />
          {t("mongoClient.indexes.title", "Indexes")}
        </span>
        <button
          type="button"
          className="sor-icon-btn-sm"
          data-testid="mongodb-indexes-refresh"
          aria-label={t("mongoClient.indexes.refresh", "Refresh indexes")}
          disabled={disabled}
          onClick={onRefresh}
        >
          <RefreshCw size={12} />
        </button>
      </div>
      <ul
        className="space-y-1 px-2 pb-2"
        data-testid="mongodb-indexes"
        aria-label={t("mongoClient.indexes.title", "Indexes")}
      >
        {indexes.length === 0 && (
          <li className="px-2 py-1 text-[10px] text-[var(--color-textMuted)]">
            {hasTarget
              ? t("mongoClient.indexes.empty", "No indexes loaded.")
              : t("mongoClient.noTarget", "Select a collection")}
          </li>
        )}
        {indexes.map((index) => (
          <li
            key={index.name}
            data-testid="mongodb-index-row"
            className="rounded border border-[var(--color-border)] px-2 py-1 text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-[var(--color-text)]">
                {index.name}
              </span>
              {editMode && index.name !== "_id_" && (
                <button
                  type="button"
                  className="sor-icon-btn-sm text-error"
                  data-testid="mongodb-index-drop"
                  aria-label={t(
                    "mongoClient.indexes.drop",
                    "Drop index {{name}}",
                    { name: index.name },
                  )}
                  disabled={disabled}
                  onClick={() => onDrop(index.name)}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
            <div className="truncate font-mono text-[10px] text-[var(--color-textSecondary)]">
              {formatMongoCell(index.keys)} · {indexFlags(index)}
            </div>
          </li>
        ))}
      </ul>
      {editMode && hasTarget && (
        <div className="space-y-1 px-2 pb-2">
          <textarea
            data-testid="mongodb-index-keys"
            rows={1}
            aria-label={t("mongoClient.indexes.keys", "Keys")}
            className={`w-full rounded border bg-[var(--color-input)] px-2 py-1 font-mono text-xs text-[var(--color-text)] ${errors.indexKeys ? "border-error" : "border-[var(--color-border)]"}`}
            value={keysText}
            spellCheck={false}
            onChange={(event) => setKeysText(event.target.value)}
          />
          {errors.indexKeys && (
            <p role="alert" className="text-[11px] text-error">
              {errors.indexKeys}
            </p>
          )}
          <textarea
            data-testid="mongodb-index-options"
            rows={1}
            aria-label={t("mongoClient.indexes.options", "Options")}
            className={`w-full rounded border bg-[var(--color-input)] px-2 py-1 font-mono text-xs text-[var(--color-text)] ${errors.indexOptions ? "border-error" : "border-[var(--color-border)]"}`}
            value={optionsText}
            spellCheck={false}
            placeholder='{"unique": true}'
            onChange={(event) => setOptionsText(event.target.value)}
          />
          {errors.indexOptions && (
            <p role="alert" className="text-[11px] text-error">
              {errors.indexOptions}
            </p>
          )}
          <button
            type="button"
            data-testid="mongodb-index-create"
            className="flex items-center gap-1.5 rounded bg-primary px-3 py-1 text-xs text-white disabled:opacity-50"
            disabled={disabled}
            onClick={() => onCreate(keysText, optionsText)}
          >
            <Plus size={12} />
            {t("mongoClient.indexes.create", "Create index")}
          </button>
        </div>
      )}
    </div>
  );
}
