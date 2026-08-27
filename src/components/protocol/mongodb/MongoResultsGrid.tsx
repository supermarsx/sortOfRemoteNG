import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { MongoDocument, MongoJsonValue } from "../../../types/mongodb";

interface MongoResultsGridProps {
  documents: MongoDocument[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}

/** Union of top-level keys across heterogeneous documents, `_id` first. */
export const collectDocumentColumns = (
  documents: MongoDocument[],
): string[] => {
  const keys = new Set<string>();
  for (const document of documents) {
    for (const key of Object.keys(document)) keys.add(key);
  }
  const ordered = [...keys].filter((key) => key !== "_id");
  return keys.has("_id") ? ["_id", ...ordered] : ordered;
};

/** Compact single-line rendering used in the grid cell. */
export const formatMongoCell = (value: MongoJsonValue | undefined): string => {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    if (!Array.isArray(value)) {
      const keys = Object.keys(value);
      if (keys.length === 1 && keys[0].startsWith("$")) {
        // Extended JSON scalar such as {"$oid": "..."} or {"$date": "..."}.
        const inner = value[keys[0]];
        if (typeof inner === "string" || typeof inner === "number") {
          return String(inner);
        }
      }
    }
    try {
      return JSON.stringify(value);
    } catch {
      return "[unserializable value]";
    }
  }
  return String(value);
};

const isNested = (value: MongoJsonValue | undefined): boolean =>
  value !== null && typeof value === "object";

/**
 * Table view over heterogeneous documents. The parent owns the
 * `mongodb-results` container; rows and cells carry the stable test ids.
 */
export function MongoResultsGrid({
  documents,
  selectedIndex,
  onSelect,
}: MongoResultsGridProps) {
  const { t } = useTranslation();
  const columns = useMemo(() => collectDocumentColumns(documents), [documents]);

  if (documents.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-[var(--color-textSecondary)]">
        {t("mongoClient.results.empty", "No documents matched.")}
      </div>
    );
  }

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-auto">
      <table
        className="sor-data-table w-max min-w-full"
        aria-label={t("mongoClient.results.ariaLabel", "MongoDB documents")}
      >
        <thead className="sticky top-0 z-10 bg-[var(--color-surface)]">
          <tr>
            <th className="sor-th w-10 whitespace-nowrap border-r border-[var(--color-border)] text-right">
              #
            </th>
            {columns.map((column) => (
              <th
                key={column}
                className="sor-th whitespace-nowrap border-r border-[var(--color-border)] last:border-r-0"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {documents.map((document, index) => {
            const selected = selectedIndex === index;
            return (
              <tr
                key={index}
                data-testid="mongodb-result-row"
                aria-selected={selected}
                className={`cursor-pointer border-t border-[var(--color-border)] ${selected ? "bg-primary/10" : "hover:bg-[var(--color-surfaceHover)]"}`}
                onClick={() => onSelect(index)}
              >
                <td className="border-r border-[var(--color-border)] px-2 py-1.5 text-right font-mono text-[10px] text-[var(--color-textMuted)]">
                  {index + 1}
                </td>
                {columns.map((column) => {
                  const value = document[column];
                  const text = formatMongoCell(value);
                  const nested = isNested(value);
                  return (
                    <td
                      key={column}
                      data-testid="mongodb-result-cell"
                      className={`max-w-96 truncate border-r border-[var(--color-border)] px-3 py-1.5 align-top font-mono text-xs last:border-r-0 ${nested ? "text-[var(--color-textSecondary)]" : "text-[var(--color-text)]"}`}
                      title={
                        nested
                          ? JSON.stringify(value, null, 2)
                          : text || undefined
                      }
                    >
                      {value === undefined ? (
                        <span className="italic text-[var(--color-textMuted)]">
                          —
                        </span>
                      ) : value === null ? (
                        <span className="italic text-[var(--color-textMuted)]">
                          null
                        </span>
                      ) : (
                        text
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
