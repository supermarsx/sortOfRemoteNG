import React, { useState } from "react";
import { ChevronDown, ChevronUp, Pencil, Trash2 } from "lucide-react";
import type {
  Connection,
  HttpBookmarkItem,
} from "../../types/connection/connection";
import { SessionQuickActionsSection } from "./SessionQuickActionsSection";

interface Props {
  formData: Partial<Connection>;
  setFormData: React.Dispatch<React.SetStateAction<Partial<Connection>>>;
}

/** Modify only the addressed sibling list, retaining folder and item metadata. */
function updateBranch(
  items: HttpBookmarkItem[],
  parents: number[],
  update: (siblings: HttpBookmarkItem[]) => HttpBookmarkItem[],
): HttpBookmarkItem[] {
  if (!parents.length) return update(items);
  const [index, ...rest] = parents;
  return items.map((item, i) =>
    i === index && item.isFolder
      ? { ...item, children: updateBranch(item.children, rest, update) }
      : item,
  );
}

export function ConnectionFavoritesSection({ formData, setFormData }: Props) {
  const [edit, setEdit] = useState<{
    source: Props["formData"]["httpBookmarks"];
    connectionId: string | undefined;
    protocol: Connection["protocol"] | undefined;
    parents: number[];
    index: number | null;
    item: HttpBookmarkItem;
    name: string;
    path: string;
  } | null>(null);
  const supported =
    !formData.isGroup &&
    ["ssh", "http", "https"].includes(formData.protocol ?? "");
  if (!supported) return null;
  const web = formData.protocol !== "ssh";
  const source = formData.httpBookmarks;
  const bookmarks = source ?? [];
  const currentEdit =
    edit &&
    edit.source === source &&
    edit.connectionId === formData.id &&
    edit.protocol === formData.protocol
      ? edit
      : null;
  const change = (
    parents: number[],
    update: (items: HttpBookmarkItem[]) => HttpBookmarkItem[],
  ) => {
    setFormData((previous) =>
      previous.httpBookmarks !== source ||
      previous.id !== formData.id ||
      previous.protocol !== formData.protocol
        ? previous
        : {
            ...previous,
            httpBookmarks: updateBranch(
              previous.httpBookmarks ?? [],
              parents,
              update,
            ),
          },
    );
    setEdit(null);
  };
  const startEdit = (
    parents: number[],
    index: number | null,
    item: HttpBookmarkItem,
  ) =>
    setEdit({
      source,
      connectionId: formData.id,
      protocol: formData.protocol,
      parents,
      index,
      item,
      name: item.name,
      path: item.isFolder ? "" : item.path,
    });
  const renderItems = (
    items: HttpBookmarkItem[],
    parents: number[] = [],
  ): React.ReactNode => (
    <ol className="space-y-2">
      {items.map((item, index) => {
        const address = [...parents, index];
        const label = `${item.isFolder ? "folder" : "bookmark"} ${item.name}`;
        return (
          <li
            key={index}
            className="min-w-0 rounded border border-[var(--color-border)] p-2"
          >
            <div className="flex min-w-0 items-center gap-1">
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm" title={item.name}>
                  {item.name || "Unnamed bookmark"}
                </span>
                <span
                  className="block truncate text-xs text-[var(--color-textMuted)]"
                  title={item.isFolder ? undefined : item.path}
                >
                  {item.isFolder
                    ? `Folder · ${item.children.length} items`
                    : item.path}
                </span>
              </div>
              <button
                type="button"
                className="sor-icon-btn"
                aria-label={`Move ${label} up`}
                data-tooltip="Move up"
                disabled={index === 0}
                onClick={() =>
                  change(parents, (siblings) => {
                    const next = [...siblings];
                    [next[index - 1], next[index]] = [
                      next[index],
                      next[index - 1],
                    ];
                    return next;
                  })
                }
              >
                <ChevronUp size={16} />
              </button>
              <button
                type="button"
                className="sor-icon-btn"
                aria-label={`Move ${label} down`}
                data-tooltip="Move down"
                disabled={index === items.length - 1}
                onClick={() =>
                  change(parents, (siblings) => {
                    const next = [...siblings];
                    [next[index + 1], next[index]] = [
                      next[index],
                      next[index + 1],
                    ];
                    return next;
                  })
                }
              >
                <ChevronDown size={16} />
              </button>
              <button
                type="button"
                className="sor-icon-btn"
                aria-label={`Edit ${label}`}
                data-tooltip="Edit bookmark"
                onClick={() => startEdit(parents, index, item)}
              >
                <Pencil size={16} />
              </button>
              <button
                type="button"
                className="sor-icon-btn"
                aria-label={`Remove ${label}`}
                data-tooltip={
                  item.isFolder
                    ? "Remove folder and its bookmarks from this draft"
                    : "Remove bookmark from this draft"
                }
                onClick={() =>
                  change(parents, (siblings) =>
                    siblings.filter((_, i) => i !== index),
                  )
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
            {item.isFolder && (
              <details className="mt-2 min-w-0">
                <summary className="cursor-pointer text-xs">
                  Folder contents ({item.children.length})
                </summary>
                <div className="mt-2 border-l border-[var(--color-border)] pl-2">
                  {parents.length < 16 ? (
                    item.children.length ? (
                      renderItems(item.children, address)
                    ) : (
                      <p className="text-xs">Empty folder</p>
                    )
                  ) : (
                    <p className="text-xs">
                      Further nested contents are preserved. Edit this folder in
                      the session bookmark menu.
                    </p>
                  )}
                </div>
              </details>
            )}
          </li>
        );
      })}
    </ol>
  );
  return (
    <div className="min-w-0 space-y-4" aria-label="Connection favorites">
      <p className="text-xs text-[var(--color-textSecondary)]">
        Changes apply only when you save this connection. Removing a favorite
        does not delete its library entry. Favorites can be reviewed even when
        their runtime capabilities are disabled.
      </p>
      {web && (
        <section
          className="min-w-0 space-y-3 rounded-lg border border-[var(--color-border)] p-4"
          aria-label="HTTP bookmarks"
        >
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-medium">
              Bookmarks ({bookmarks.length})
            </h4>
            <button
              type="button"
              className="sor-btn sor-btn-secondary px-2 py-1 text-xs"
              onClick={() => startEdit([], null, { name: "", path: "/" })}
            >
              Add bookmark
            </button>
          </div>
          {currentEdit && (
            <div
              className="space-y-2 rounded border border-[var(--color-border)] p-3"
              aria-label="Edit bookmark draft"
              onKeyDown={(event) => {
                // This inline editor is nested in the connection form: applying
                // a bookmark must not implicitly submit the whole connection.
                if (event.key === "Enter") event.preventDefault();
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setEdit(null);
                }
              }}
            >
              <label className="block text-sm">
                Bookmark name
                <input
                  className="sor-form-input mt-1 w-full"
                  maxLength={1024}
                  value={currentEdit.name}
                  onChange={(event) =>
                    setEdit({ ...currentEdit, name: event.target.value })
                  }
                />
              </label>
              {!currentEdit.item.isFolder && (
                <label className="block text-sm">
                  Bookmark path
                  <input
                    className="sor-form-input mt-1 w-full"
                    maxLength={8192}
                    value={currentEdit.path}
                    onChange={(event) =>
                      setEdit({ ...currentEdit, path: event.target.value })
                    }
                  />
                </label>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  className="sor-btn sor-btn-secondary px-2 py-1 text-xs"
                  onClick={() => setEdit(null)}
                >
                  Cancel bookmark edit
                </button>
                <button
                  type="button"
                  className="sor-btn sor-btn-primary px-2 py-1 text-xs"
                  disabled={
                    !currentEdit.name.trim() ||
                    (!currentEdit.item.isFolder && !currentEdit.path.trim())
                  }
                  onClick={() => {
                    let path = currentEdit.path.trim();
                    if (!path.startsWith("/")) path = `/${path}`;
                    const replacement: HttpBookmarkItem = currentEdit.item
                      .isFolder
                      ? { ...currentEdit.item, name: currentEdit.name.trim() }
                      : {
                          ...currentEdit.item,
                          name: currentEdit.name.trim(),
                          path,
                        };
                    change(currentEdit.parents, (items) =>
                      currentEdit.index === null
                        ? [...items, replacement]
                        : items.map((item, index) =>
                            index === currentEdit.index ? replacement : item,
                          ),
                    );
                  }}
                >
                  Save bookmark draft
                </button>
              </div>
            </div>
          )}
          <div className="max-h-80 min-w-0 overflow-auto">
            {bookmarks.length ? (
              renderItems(bookmarks)
            ) : (
              <p className="text-sm text-[var(--color-textMuted)]">
                No bookmarks configured.
              </p>
            )}
          </div>
        </section>
      )}
      <SessionQuickActionsSection
        protocol={web ? "http" : "ssh"}
        view="favorites"
        formData={formData}
        setFormData={setFormData}
      />
    </div>
  );
}
