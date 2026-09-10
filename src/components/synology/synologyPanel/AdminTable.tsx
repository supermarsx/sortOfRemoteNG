import { useId, useMemo, useState, type ReactNode } from "react";
export type AdminColumn = readonly [
  string,
  string,
  ((value: unknown) => ReactNode)?,
];
const displayAdminValue = (value: unknown): string => {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (Array.isArray(value))
    return (
      value
        .filter((item) => typeof item === "string" || typeof item === "number")
        .join(", ") || "—"
    );
  if (typeof value === "object" && "common_name" in value)
    return displayAdminValue(value.common_name);
  return "—";
};
const get = (row: unknown, key: string): unknown =>
  key
    .split(".")
    .reduce<unknown>(
      (value, part) =>
        value && typeof value === "object"
          ? (value as Record<string, unknown>)[part]
          : undefined,
      row,
    );
export default function AdminTable({
  title,
  rows,
  columns,
  actions,
}: {
  title: string;
  rows: readonly unknown[];
  columns: readonly AdminColumn[];
  actions?: (row: Record<string, unknown>) => ReactNode;
}) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const filtered = useMemo(
    () =>
      rows.filter((row) =>
        columns.some(([key]) =>
          displayAdminValue(get(row, key))
            .toLowerCase()
            .includes(search.toLowerCase()),
        ),
      ),
    [rows, columns, search],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 25));
  const current = Math.min(page, pages - 1);
  return (
    <section className="space-y-2 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium text-sm mr-auto">
          {title} <span className="text-text-muted">({filtered.length})</span>
        </h3>
        <label htmlFor={id} className="sr-only">
          Search {title}
        </label>
        <input
          id={id}
          className="sor-form-input"
          style={{ width: "min(100%, 16rem)" }}
          placeholder={`Search ${title.toLowerCase()}`}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
        />
      </div>
      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-xs">
          <thead className="bg-surfaceHover">
            <tr>
              {columns.map(([key, label]) => (
                <th key={key} className="p-2 text-left whitespace-nowrap">
                  {label}
                </th>
              ))}
              {actions && <th className="p-2 text-left">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filtered
              .slice(current * 25, current * 25 + 25)
              .map((row, index) => (
                <tr
                  key={current * 25 + index}
                  className="border-t border-border hover:bg-surfaceHover"
                >
                  {columns.map(([key, , format]) => (
                    <td key={key} className="p-2 max-w-xs break-words">
                      {format ? (
                        <span
                          data-tooltip={`Raw: ${displayAdminValue(get(row, key))}`}
                        >
                          {format(get(row, key))}
                        </span>
                      ) : (
                        displayAdminValue(get(row, key))
                      )}
                    </td>
                  ))}
                  {actions && (
                    <td className="p-2">
                      {row && typeof row === "object"
                        ? actions(row as Record<string, unknown>)
                        : null}
                    </td>
                  )}
                </tr>
              ))}
          </tbody>
        </table>
        {!filtered.length && (
          <p className="p-5 text-xs text-text-muted">
            No matching rows. The package may be unavailable or this account may
            have no entries.
          </p>
        )}
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs">
          <button
            className="sor-btn-secondary-sm"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            Previous {title}
          </button>
          <span>
            Page {current + 1} of {pages}
          </span>
          <button
            className="sor-btn-secondary-sm"
            disabled={current === pages - 1}
            onClick={() => setPage(current + 1)}
          >
            Next {title}
          </button>
        </div>
      )}
    </section>
  );
}
