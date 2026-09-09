import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Download,
  LayoutGrid,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useIconExplorer } from "../../hooks/icons/useIconExplorer";
import type {
  IconImportPreview,
  IconLibraryEntry,
} from "../../hooks/icons/useIconLibrary";
import { CONNECTION_ICON_CATEGORY_LABELS } from "../connection/editor/connectionIconPickerModel";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "../ui/overlays/Modal";
import { ConfirmDialog } from "../ui/dialogs/ConfirmDialog";

const PAGE_SIZE = 96;
const categoryLabel = (category: string) =>
  (CONNECTION_ICON_CATEGORY_LABELS as Record<string, string>)[category] ??
  (category === "custom" ? "Custom icons" : category);

function Pagination({
  page,
  count,
  onPage,
}: {
  page: number;
  count: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  return (
    <nav
      aria-label="Icon pages"
      className="flex items-center justify-between gap-3 text-xs"
    >
      <button
        className="sor-btn-secondary-sm"
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
      >
        Previous page
      </button>
      <span>
        Page {page + 1} of {pages} · {count} icons
      </span>
      <button
        className="sor-btn-secondary-sm"
        disabled={page + 1 >= pages}
        onClick={() => onPage(page + 1)}
      >
        Next page
      </button>
    </nav>
  );
}

function IconDetails({
  entry,
  disabled,
  onSave,
  onExport,
  onDelete,
}: {
  entry: IconLibraryEntry;
  disabled: boolean;
  onSave: (key: string, label: string, notes: string) => Promise<void>;
  onExport: (keys: string[], format: "svg" | "json") => Promise<void>;
  onDelete: (keys: string[]) => void;
}) {
  const [label, setLabel] = useState(entry.label);
  const [notes, setNotes] = useState(entry.notes);
  const [base, setBase] = useState({ label: entry.label, notes: entry.notes });
  const stale = entry.label !== base.label || entry.notes !== base.notes;
  useEffect(() => {
    // A successful save is observed from the authoritative entry, never assumed.
    if (
      entry.label === label &&
      entry.notes === notes &&
      (entry.label !== base.label || entry.notes !== base.notes)
    )
      setBase({ label: entry.label, notes: entry.notes });
  }, [entry.label, entry.notes, label, notes, base.label, base.notes]);
  const Icon = entry.icon;
  return (
    <aside
      aria-label="Icon details"
      className="min-w-0 space-y-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 xl:sticky xl:top-0 xl:max-h-[calc(100dvh-10rem)] xl:overflow-y-auto"
    >
      <div className="flex items-center gap-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-background)]">
          <Icon size={48} aria-hidden />
        </div>
        <div className="min-w-0">
          <h2 className="break-words text-base font-semibold">{entry.label}</h2>
          <p className="text-xs text-[var(--color-textSecondary)]">
            {entry.kind === "builtin" ? "Built-in artwork" : "Custom SVG"} ·{" "}
            {categoryLabel(entry.category)}
          </p>
        </div>
      </div>
      <dl className="space-y-1 text-xs">
        <dt className="text-[var(--color-textSecondary)]">Stable icon key</dt>
        <dd className="break-all font-mono select-text">{entry.key}</dd>
        <dt className="text-[var(--color-textSecondary)]">Original name</dt>
        <dd className="break-words">{entry.originalLabel}</dd>
      </dl>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!stale) void onSave(entry.key, label, notes);
        }}
      >
        {stale && (
          <div className="space-y-2 rounded border border-warning/30 p-3 text-xs">
            <p role="alert">
              This icon's saved name or notes changed. Your draft is preserved;
              reload the current metadata before saving.
            </p>
            <button
              type="button"
              className="sor-btn-secondary-sm"
              onClick={() => {
                setLabel(entry.label);
                setNotes(entry.notes);
                setBase({ label: entry.label, notes: entry.notes });
              }}
            >
              Reload saved metadata
            </button>
          </div>
        )}
        <label className="block space-y-1 text-xs">
          <span>Personal name</span>
          <input
            className="sor-form-input w-full"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            disabled={disabled || stale}
            maxLength={120}
          />
        </label>
        <label className="block space-y-1 text-xs">
          <span>Notes</span>
          <textarea
            className="sor-form-textarea w-full"
            rows={5}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            disabled={disabled || stale}
            maxLength={2000}
          />
        </label>
        <p className="text-xs text-[var(--color-textSecondary)]">
          Renaming and notes are personal metadata. They never change the stable
          key or built-in artwork.
        </p>
        <button
          className="sor-btn-primary-sm"
          disabled={
            disabled || stale || (entry.kind === "custom" && !label.trim())
          }
          type="submit"
        >
          Save name and notes
        </button>
      </form>
      <div className="flex flex-wrap gap-2">
        <button
          className="sor-btn-secondary-sm"
          disabled={disabled}
          onClick={() => void onExport([entry.key], "svg")}
        >
          <Download size={14} />
          Export SVG
        </button>
        <button
          className="sor-btn-secondary-sm"
          disabled={disabled}
          onClick={() => void onExport([entry.key], "json")}
        >
          Export JSON
        </button>
        {entry.kind === "custom" && (
          <button
            className="sor-btn-secondary-sm text-error"
            disabled={disabled}
            onClick={() => onDelete([entry.key])}
          >
            <Trash2 size={14} />
            Delete custom icon
          </button>
        )}
      </div>
      {entry.kind === "builtin" && (
        <p className="text-xs text-[var(--color-textSecondary)]">
          Built-in icons cannot be deleted or replaced.
        </p>
      )}
    </aside>
  );
}

function ImportReview({
  preview,
  busy,
  error,
  onCancel,
  onApply,
}: {
  preview: IconImportPreview;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onApply: (resolutions: Record<string, "replace" | "skip">) => Promise<void>;
}) {
  const [page, setPage] = useState(0);
  const [resolutions, setResolutions] = useState<
    Record<string, "replace" | "skip">
  >({});
  const conflicts = new Map(
    preview.conflicts.map((conflict) => [conflict.key, conflict]),
  );
  const choices = Object.fromEntries(
    preview.conflicts.map(({ key }) => [key, resolutions[key] ?? "skip"]),
  );
  return (
    <Modal
      isOpen
      ariaLabel="Review icon import"
      onClose={busy ? undefined : onCancel}
      closeOnBackdrop={!busy}
      closeOnEscape={!busy}
      panelClassName="max-w-3xl max-h-[calc(100dvh-2rem)] overflow-hidden"
      contentClassName="flex min-h-0 flex-col overflow-hidden p-0"
    >
      <ModalHeader
        title="Review icon import"
        onClose={busy ? undefined : onCancel}
        className="shrink-0"
      />
      <ModalBody className="min-h-0 space-y-4 overflow-y-auto p-5">
        <p className="text-sm">
          {preview.entries.length} incoming icons · {preview.conflicts.length}{" "}
          existing-key conflicts. Nothing is saved until you apply this review.
          Conflicts are skipped unless explicitly replaced; built-in replacement
          changes personal metadata only.
        </p>
        {preview.warnings.map((warning, index) => (
          <p className="text-xs text-warning" key={index}>
            {warning}
          </p>
        ))}
        {error && (
          <p role="alert" className="break-words text-sm text-error">
            {error}
          </p>
        )}
        {preview.conflicts.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button
              disabled={busy}
              className="sor-btn-secondary-sm"
              onClick={() =>
                setResolutions(
                  Object.fromEntries(
                    preview.conflicts.map(({ key }) => [key, "skip"]),
                  ),
                )
              }
            >
              Skip all conflicts
            </button>
            <button
              disabled={busy}
              className="sor-btn-secondary-sm"
              onClick={() =>
                setResolutions(
                  Object.fromEntries(
                    preview.conflicts.map(({ key }) => [key, "replace"]),
                  ),
                )
              }
            >
              Replace all reviewed conflicts
            </button>
          </div>
        )}
        <ul className="divide-y divide-[var(--color-border)]">
          {preview.entries
            .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
            .map((entry) => {
              const Icon = entry.icon;
              const conflict = conflicts.get(entry.key);
              return (
                <li
                  className="grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-3 py-3 sm:grid-cols-[1.5rem_minmax(0,1fr)_14rem]"
                  key={entry.key}
                >
                  <Icon size={24} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm">{entry.label}</p>
                    <p className="break-all text-xs text-[var(--color-textSecondary)]">
                      {entry.key}
                    </p>
                    {conflict && (
                      <p className="text-xs">
                        Existing: {conflict.existingLabel}
                      </p>
                    )}
                  </div>
                  {conflict ? (
                    <label className="col-span-2 min-w-0 text-xs sm:col-span-1">
                      Conflict for {entry.label}
                      <select
                        className="sor-form-select mt-1 w-full"
                        value={choices[entry.key]}
                        disabled={busy}
                        onChange={(event) =>
                          setResolutions((previous) => ({
                            ...previous,
                            [entry.key]: event.target.value as
                              "replace" | "skip",
                          }))
                        }
                      >
                        <option value="skip">Skip</option>
                        <option value="replace">Replace</option>
                      </select>
                    </label>
                  ) : (
                    <span className="text-xs">New</span>
                  )}
                </li>
              );
            })}
        </ul>
        <Pagination
          page={page}
          count={preview.entries.length}
          onPage={setPage}
        />
      </ModalBody>
      <ModalFooter className="shrink-0 flex-wrap gap-2">
        <button
          disabled={busy}
          className="sor-btn-secondary-sm"
          onClick={onCancel}
        >
          Cancel import
        </button>
        <button
          disabled={busy}
          className="sor-btn-primary-sm"
          onClick={() => void onApply(choices)}
        >
          {busy ? "Saving…" : "Apply reviewed import"}
        </button>
      </ModalFooter>
    </Modal>
  );
}

export default function IconExplorerTab() {
  const explorer = useIconExplorer();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [kind, setKind] = useState("all");
  const [page, setPage] = useState(0);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteReview, setDeleteReview] = useState<{
    keys: string[];
    revision: number;
  } | null>(null);
  const deleting = deleteReview?.keys ?? null;
  const setDeleting = (keys: string[] | null) =>
    setDeleteReview(
      keys ? { keys: [...keys], revision: explorer.accessEpoch } : null,
    );
  useEffect(() => {
    setDeleteReview((review) =>
      review &&
      (!explorer.ready ||
        explorer.locked ||
        review.revision !== explorer.accessEpoch)
        ? null
        : review,
    );
  }, [explorer.ready, explorer.locked, explorer.accessEpoch]);
  const index = useMemo(
    () =>
      new Map<string, IconLibraryEntry>(
        explorer.entries.map((entry) => [entry.key, entry]),
      ),
    [explorer.entries],
  );
  const filtered = useMemo(() => {
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return explorer.entries.filter(
      (entry) =>
        (kind === "all" || kind === entry.kind) &&
        (category === "all" || category === entry.category) &&
        terms.every((term) =>
          `${entry.label} ${entry.originalLabel} ${entry.key} ${entry.notes} ${entry.keywords.join(" ")}`
            .toLocaleLowerCase()
            .includes(term),
        ),
    );
  }, [explorer.entries, query, kind, category]);
  const categories = useMemo(
    () => [...new Set(explorer.entries.map((entry) => entry.category))],
    [explorer.entries],
  );
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const entry of explorer.entries)
      result.set(entry.category, (result.get(entry.category) ?? 0) + 1);
    return result;
  }, [explorer.entries]);
  const chooseCategory = (value: string) => {
    setCategory(value);
    setKind("all");
    setPage(0);
  };
  const effectivePage = Math.min(
    page,
    Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1),
  );
  const visible = filtered.slice(
    effectivePage * PAGE_SIZE,
    (effectivePage + 1) * PAGE_SIZE,
  );
  const selectedKeys = [...selected].filter((key) => index.has(key));
  const selectedCustom = selectedKeys.filter(
    (key) => index.get(key)?.kind === "custom",
  );
  const detail = detailKey ? index.get(detailKey) : undefined;
  const disabled =
    explorer.busy ||
    !explorer.ready ||
    explorer.locked ||
    Boolean(explorer.error && !explorer.entries.length);
  if (explorer.locked)
    return (
      <section aria-label="Icon Explorer" className="p-6">
        <h1 className="text-lg font-semibold">Icon Explorer</h1>
        <p className="mt-3">
          Unlock the application to access your icon library.
        </p>
      </section>
    );
  return (
    <section
      aria-label="Icon Explorer"
      className="h-full min-h-0 overflow-y-auto bg-[var(--color-background)] p-4 text-[var(--color-text)] sm:p-6"
    >
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <LayoutGrid size={22} />
            Icon Explorer
          </h1>
          <p className="mt-1 max-w-2xl text-xs text-[var(--color-textSecondary)]">
            Browse built-in artwork and your custom SVG icons. Personal names
            and notes are saved with global settings on desktop; browser
            previews are temporary. Stable icon keys remain unchanged.
          </p>
        </div>
        <button
          className="sor-btn-primary-sm"
          disabled={disabled}
          onClick={() => void explorer.importFile()}
        >
          <Upload size={14} />
          Import SVG / JSON
        </button>
      </header>
      {explorer.error && (
        <p
          role="alert"
          className="mb-3 break-words rounded border border-error/30 p-3 text-sm text-error"
        >
          {explorer.error}
        </p>
      )}
      {explorer.message && (
        <p role="status" className="mb-3 text-sm">
          {explorer.message}
        </p>
      )}
      {!explorer.ready ? (
        <p role="status">
          {explorer.error
            ? "Icon library unavailable. Reload global settings after resolving the reported storage or validation error; your saved library has not been reset."
            : "Loading icon library…"}
        </p>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[12rem_minmax(0,1fr)]">
          <nav
            aria-label="Icon sections"
            className="sticky top-0 hidden max-h-[calc(100dvh-12rem)] overflow-y-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2 lg:block"
          >
            <h2 className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-textSecondary)]">
              Sections
            </h2>
            {[
              {
                key: "all",
                label: "All icons",
                count: explorer.entries.length,
              },
              {
                key: "custom",
                label: "Custom icons",
                count: counts.get("custom") ?? 0,
              },
              ...categories
                .filter((value) => value !== "custom")
                .map((value) => ({
                  key: value,
                  label: categoryLabel(value),
                  count: counts.get(value) ?? 0,
                })),
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                aria-label={item.label + " (" + item.count + ")"}
                aria-current={category === item.key ? "page" : undefined}
                onClick={() => chooseCategory(item.key)}
                className={
                  "flex w-full items-center justify-between gap-2 rounded px-2 py-2 text-left text-xs " +
                  (category === item.key
                    ? "bg-primary/15 font-semibold text-primary"
                    : "hover:bg-[var(--color-border)]")
                }
              >
                <span className="min-w-0 break-words">{item.label}</span>
                <span className="shrink-0 tabular-nums text-[var(--color-textSecondary)]">
                  {item.count}
                </span>
              </button>
            ))}
          </nav>
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <label className="block w-full min-w-0 space-y-1 sm:w-72 sm:max-w-72">
                <span className="text-xs text-[var(--color-textSecondary)]">
                  Search icons
                </span>
                <span className="relative block">
                  <Search
                    size={16}
                    aria-hidden
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-textSecondary)]"
                  />
                  <input
                    aria-label="Search icons"
                    placeholder="Search names, keys, notes…"
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setPage(0);
                    }}
                    className="sor-search-input w-full"
                  />
                </span>
              </label>
              <label className="block max-w-full space-y-1 lg:hidden">
                <span className="text-xs text-[var(--color-textSecondary)]">
                  Section
                </span>
                <select
                  aria-label="Icon category"
                  className="sor-form-select max-w-full sm:w-48"
                  value={category}
                  onChange={(event) => {
                    setCategory(event.target.value);
                    setPage(0);
                  }}
                >
                  <option value="all">All categories</option>
                  {categories.map((value) => (
                    <option value={value} key={value}>
                      {categoryLabel(value)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-[var(--color-textSecondary)]">
                  Source
                </span>
                <select
                  aria-label="Icon source"
                  className="sor-form-select w-auto"
                  value={kind}
                  onChange={(event) => {
                    setKind(event.target.value);
                    setPage(0);
                  }}
                >
                  <option value="all">Built-in & custom</option>
                  <option value="builtin">Built-in</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              {(query || category !== "all" || kind !== "all") && (
                <button
                  type="button"
                  className="sor-btn-secondary-sm"
                  onClick={() => {
                    setQuery("");
                    chooseCategory("all");
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>
            <p className="mb-3 text-xs text-[var(--color-textSecondary)]">
              {category === "all" ? "All sections" : categoryLabel(category)}
              {kind !== "all"
                ? " · " + (kind === "builtin" ? "Built-in" : "Custom")
                : ""}
              {query ? " · “" + query + "”" : ""}
            </p>
            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
              <span>
                {filtered.length} matching · {selectedKeys.length} selected
              </span>
              <button
                className="sor-btn-secondary-sm"
                disabled={!visible.length}
                onClick={() =>
                  setSelected(
                    (previous) =>
                      new Set([...previous, ...visible.map(({ key }) => key)]),
                  )
                }
              >
                Select page
              </button>
              <button
                className="sor-btn-secondary-sm"
                disabled={!filtered.length}
                onClick={() =>
                  setSelected(new Set(filtered.map(({ key }) => key)))
                }
              >
                Select filtered
              </button>
              <button
                className="sor-btn-secondary-sm"
                disabled={!selectedKeys.length}
                onClick={() => setSelected(new Set())}
              >
                Clear selection
              </button>
              <button
                className="sor-btn-secondary-sm"
                disabled={disabled || !selectedKeys.length}
                onClick={() => void explorer.exportIcons(selectedKeys, "json")}
              >
                <Download size={14} />
                Export selected JSON
              </button>
              <button
                className="sor-btn-secondary-sm text-error"
                disabled={disabled || !selectedCustom.length}
                onClick={() => setDeleting(selectedCustom)}
              >
                <Trash2 size={14} />
                Delete custom ({selectedCustom.length})
              </button>
            </div>
            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
              <div className="order-last min-w-0 space-y-4 xl:order-first">
                <Pagination
                  page={effectivePage}
                  count={filtered.length}
                  onPage={setPage}
                />
                {!filtered.length ? (
                  <p className="py-10 text-center text-sm text-[var(--color-textSecondary)]">
                    No icons match these filters.
                  </p>
                ) : (
                  <ul
                    aria-label="Icon catalog"
                    className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-6 2xl:grid-cols-8"
                  >
                    {visible.map((entry) => {
                      const Icon = entry.icon;
                      return (
                        <li
                          key={entry.key}
                          className={`relative min-w-0 rounded-lg border ${detailKey === entry.key ? "border-primary bg-primary/10" : "border-[var(--color-border)] bg-[var(--color-surface)]"}`}
                        >
                          <button
                            aria-label={`Inspect ${entry.label}`}
                            aria-pressed={detailKey === entry.key}
                            className="flex min-h-28 w-full flex-col items-center justify-center gap-3 rounded-lg p-3 pt-7 hover:bg-[var(--color-border)] focus-visible:ring-2 focus-visible:ring-primary"
                            onClick={() => setDetailKey(entry.key)}
                          >
                            <Icon size={28} aria-hidden />
                            <span className="line-clamp-2 w-full break-words text-center text-xs">
                              {entry.label}
                            </span>
                          </button>
                          <label className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center">
                            <input
                              type="checkbox"
                              aria-label={`Select ${entry.label}`}
                              checked={selected.has(entry.key)}
                              onChange={() =>
                                setSelected((previous) => {
                                  const next = new Set(previous);
                                  if (next.has(entry.key))
                                    next.delete(entry.key);
                                  else next.add(entry.key);
                                  return next;
                                })
                              }
                              className="h-4 w-4 accent-primary"
                            />
                          </label>
                          {entry.kind === "custom" && (
                            <span className="absolute left-2 top-2 text-[9px] text-[var(--color-textSecondary)]">
                              Custom
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                <Pagination
                  page={effectivePage}
                  count={filtered.length}
                  onPage={setPage}
                />
              </div>
              {detail ? (
                <IconDetails
                  key={detail.key}
                  entry={detail}
                  disabled={disabled}
                  onSave={explorer.updateMetadata}
                  onExport={explorer.exportIcons}
                  onDelete={setDeleting}
                />
              ) : (
                <aside className="rounded-lg border border-dashed border-[var(--color-border)] p-6 text-sm text-[var(--color-textSecondary)]">
                  <Check size={20} className="mb-3" />
                  Choose an icon to inspect its key, rename its personal label,
                  add notes, or export its SVG.
                </aside>
              )}
            </div>
          </div>
        </div>
      )}
      {explorer.preview && (
        <ImportReview
          key={explorer.preview.id}
          preview={explorer.preview}
          busy={explorer.busy}
          error={explorer.error}
          onCancel={explorer.dismissImport}
          onApply={explorer.applyImport}
        />
      )}
      <ConfirmDialog
        isOpen={
          deleteReview !== null &&
          deleteReview.revision === explorer.accessEpoch &&
          explorer.ready &&
          !explorer.locked
        }
        title={`Delete ${deleting?.length ?? 0} custom icons?`}
        confirmText="Delete custom icons"
        variant="danger"
        confirmOnEnter={false}
        message={`Delete these custom icons: ${(deleting ?? [])
          .slice(0, 20)
          .map((key) => index.get(key)?.label ?? key)
          .join(
            ", ",
          )}${(deleting?.length ?? 0) > 20 ? `, and ${deleting!.length - 20} more` : ""}. Built-in icons are never deleted. Saved connections keep their icon key and may show a fallback until that custom icon is restored.`}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const review = deleteReview;
          setDeleting(null);
          if (review) void explorer.deleteCustom(review.keys, review.revision);
        }}
      />
    </section>
  );
}
