import React, { useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Folder, MoreHorizontal, Star } from "lucide-react";
import type {
  ConnectionSession,
  HttpBookmarkItem,
} from "../../../types/connection/connection";
import { resolveHttpBookmarkUrl } from "../../../utils/protocol/httpBookmarkUrl";
import {
  bookmarkAt,
  bookmarkChildren,
  bookmarkContains,
  bookmarkPathKey,
  cloneOriginBookmarks,
  useOriginBookmarks,
  type BookmarkChange,
  type BookmarkPath,
  type OriginBookmarkReview,
} from "../../../hooks/protocol/useOriginBookmarks";
import { MenuSurface } from "../../ui/overlays/MenuSurface";
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "../../ui/overlays/Modal";
import { TextInput } from "../../ui/forms/TextInput";
import { Select } from "../../ui/forms/Select";
import type { useOriginWebsiteAutomation } from "../../../hooks/protocol/useOriginWebsiteAutomation";
import { WebAutomationFavoriteChips } from "./WebAutomationControls";

type Review = {
  review: OriginBookmarkReview;
  mode: "menu" | "folder" | "edit" | "delete" | "external";
  position: { x: number; y: number };
  path?: BookmarkPath;
  parent: BookmarkPath;
  name: string;
  url: string;
  folder: boolean;
};

export default function OriginBookmarkBar({
  session,
  bookmarks,
  initialUrl,
  currentUrl,
  currentTitle,
  eligible,
  canNavigate,
  assertOwner,
  hideNative,
  onOverlayChange,
  onNavigate,
  automationSlot,
  automation,
}: {
  session: ConnectionSession;
  bookmarks?: HttpBookmarkItem[];
  initialUrl: string;
  currentUrl?: string;
  currentTitle?: string;
  eligible: boolean;
  canNavigate: boolean;
  assertOwner: () => void;
  hideNative: () => void;
  onOverlayChange: (open: boolean) => void;
  onNavigate: (url: string, assertCurrent: () => void) => void;
  /** Insertion point for the independently owned scripts/macros controls. */
  automationSlot?: React.ReactNode;
  automation?: ReturnType<typeof useOriginWebsiteAutomation>;
}) {
  const capture = useOriginBookmarks(session, eligible, assertOwner, bookmarks);
  const [ui, setUi] = useState<Review | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [message, setMessage] = useState("");
  const busy = useRef(false);
  const alive = useRef(false);
  const opening = useRef(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const drag = useRef<{
    review: OriginBookmarkReview;
    path: BookmarkPath;
  } | null>(null);
  let tree: HttpBookmarkItem[] = [];
  let validTree = true;
  try {
    tree = cloneOriginBookmarks(bookmarks);
  } catch {
    validTree = false;
  }
  const current = currentUrl
    ? resolveHttpBookmarkUrl(currentUrl, initialUrl)
    : "";
  const editable = eligible && validTree && !pending;
  const canManageAutomation =
    !!automation?.libraryReady &&
    !automation.busy &&
    !automation.recording &&
    !automation.recordingPending;
  useLayoutEffect(() => {
    alive.current = true;
    const epoch = opening;
    return () => {
      alive.current = false;
      epoch.current++;
      onOverlayChange(false);
    };
  }, [onOverlayChange]);
  useLayoutEffect(() => {
    if (!eligible) {
      opening.current++;
      drag.current = null;
      setUi(null);
      setError(false);
      onOverlayChange(false);
    }
  }, [eligible, onOverlayChange]);
  const close = () => {
    if (busy.current) return;
    opening.current++;
    setUi(null);
    setError(false);
    setMessage("");
    onOverlayChange(false);
  };
  const present = (next: Review) => {
    try {
      next.review.assertCurrent();
    } catch {
      setError(true);
      return;
    }
    hideNative();
    onOverlayChange(true);
    setError(false);
    setMessage("");
    setUi(next);
  };
  const openLibrary = (kind?: "script" | "macro") => {
    if (!ui || !canManageAutomation || !editable) return;
    try {
      ui.review.assertCurrent();
      close();
      automation?.openLibrary(kind);
    } catch {
      setError(true);
    }
  };
  const open = (
    mode: Review["mode"],
    position: Review["position"],
    path?: BookmarkPath,
  ) => {
    if (!editable) return;
    try {
      const review = capture();
      opening.current++;
      present({
        review,
        mode,
        position,
        path,
        parent: [],
        name: "",
        url: "",
        folder: false,
      });
    } catch {
      setError(true);
    }
  };
  const edit = (
    folder: boolean,
    path?: BookmarkPath,
    parent: BookmarkPath = [],
    useCurrent = false,
  ) => {
    if (!ui || busy.current) return;
    try {
      ui.review.assertCurrent();
      const item = path ? bookmarkAt(ui.review.tree, path) : undefined;
      present({
        ...ui,
        mode: "edit",
        path,
        parent: path ? path.slice(0, -1) : parent,
        folder,
        name: item?.name ?? (useCurrent ? currentTitle || "Current page" : ""),
        url: item && !item.isFolder ? item.path : useCurrent ? current : "",
      });
    } catch {
      setError(true);
    }
  };
  const save = async (review: OriginBookmarkReview, change: BookmarkChange) => {
    if (busy.current || !eligible) return;
    const epoch = opening.current;
    busy.current = true;
    setPending(true);
    setError(false);
    try {
      await review.commit(change);
      if (alive.current && opening.current === epoch) {
        setUi(null);
        onOverlayChange(false);
      }
    } catch {
      if (alive.current && opening.current === epoch) setError(true);
    } finally {
      busy.current = false;
      if (alive.current) setPending(false);
    }
  };
  const navigate = (review: OriginBookmarkReview, item: HttpBookmarkItem) => {
    if (item.isFolder || !canNavigate || busy.current) return;
    try {
      review.assertCurrent();
      const url = resolveHttpBookmarkUrl(item.path, initialUrl, currentUrl);
      if (!url) return;
      close();
      onNavigate(url, review.assertCurrent);
    } catch {
      setError(true);
    }
  };
  const linkAction = async (url: string, external: boolean) => {
    if (!ui || !url || busy.current || !eligible) return;
    const epoch = opening.current;
    busy.current = true;
    setPending(true);
    setError(false);
    setMessage("");
    try {
      ui.review.assertCurrent();
      if (external) await invoke("open_url_external", { url });
      else await navigator.clipboard.writeText(url);
      if (!alive.current || opening.current !== epoch) return;
      ui.review.assertCurrent();
      if (external) {
        setUi(null);
        onOverlayChange(false);
      } else
        setMessage(
          "URL copied. It may contain sensitive query or fragment values.",
        );
    } catch {
      if (alive.current && opening.current === epoch)
        setMessage(
          external
            ? "Could not open the bookmark externally. No fallback was attempted."
            : "Could not copy the bookmark URL.",
        );
    } finally {
      busy.current = false;
      if (alive.current) setPending(false);
    }
  };
  const drop = (
    event: React.DragEvent,
    parent: BookmarkPath,
    before?: number,
  ) => {
    if (!drag.current || !editable) return;
    event.preventDefault();
    event.stopPropagation();
    const source = drag.current;
    drag.current = null;
    void save(source.review, {
      kind: "move",
      path: source.path,
      parent,
      before,
    });
  };
  const action = (
    label: string,
    run: () => void,
    disabled = false,
    danger = false,
  ) => (
    <button
      type="button"
      role="menuitem"
      className={`sor-menu-item${danger ? " sor-menu-item-danger" : ""}`}
      disabled={!editable || disabled}
      onClick={run}
    >
      {label}
    </button>
  );
  const folders: Array<{ value: string; label: string }> = [
    { value: "", label: "Bookmarks bar" },
  ];
  const collectFolders = (
    rows: HttpBookmarkItem[],
    parent: BookmarkPath,
    prefix: string,
  ) => {
    rows.forEach((row, index) => {
      const path = [...parent, index];
      if (!row.isFolder || (ui?.path && bookmarkContains(ui.path, path)))
        return;
      const label = prefix + row.name;
      folders.push({ value: bookmarkPathKey(path), label });
      collectFolders(row.children, path, `${label} / `);
    });
  };
  if (ui) collectFolders(ui.review.tree, [], "");
  const selected = ui?.path ? bookmarkAt(ui.review.tree, ui.path) : undefined;
  const selectedUrl =
    selected && !selected.isFolder
      ? resolveHttpBookmarkUrl(selected.path, initialUrl, currentUrl)
      : "";
  const folderPath = ui?.mode === "folder" ? (ui.path ?? []) : [];
  const folderRows = ui ? bookmarkChildren(ui.review.tree, folderPath) : [];
  const contextMenu = (
    event: React.MouseEvent | React.KeyboardEvent,
    path?: BookmarkPath,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    open(
      "menu",
      "clientX" in event
        ? { x: event.clientX, y: event.clientY }
        : { x: rect.left, y: rect.bottom },
      path,
    );
  };
  const isBarBackground = (target: EventTarget, bar: HTMLElement) => {
    if (!(target instanceof Element) || !bar.contains(target)) return false;
    const control = target.closest(
      'button, a, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="menu"], [role="menuitem"], [role="dialog"], [tabindex]',
    );
    return !control || control === bar;
  };
  return (
    <div
      role="group"
      aria-label="Saved website bookmarks"
      tabIndex={0}
      aria-haspopup="menu"
      className="flex shrink-0 min-w-0 flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 min-h-7"
      onContextMenu={(event) => {
        if (
          !event.defaultPrevented &&
          isBarBackground(event.target, event.currentTarget)
        )
          contextMenu(event);
      }}
      onKeyDown={(event) => {
        if (
          event.target === event.currentTarget &&
          (event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10"))
        )
          contextMenu(event);
      }}
      onDragOver={(event) => {
        if (
          drag.current &&
          editable &&
          isBarBackground(event.target, event.currentTarget)
        )
          event.preventDefault();
      }}
      onDrop={(event) => {
        if (isBarBackground(event.target, event.currentTarget)) drop(event, []);
      }}
    >
      {automationSlot}
      <div className="flex min-w-0 flex-[1_1_12rem] items-center gap-1 overflow-x-auto">
        {tree.map((item, index) => (
          <button
            key={index}
            type="button"
            className="sor-option-chip shrink-0 h-7 text-xs max-w-56"
            aria-label={item.name || "Unnamed bookmark"}
            data-tooltip={item.name || "Unnamed bookmark"}
            aria-haspopup={item.isFolder ? "menu" : undefined}
            disabled={
              !eligible ||
              pending ||
              (!item.isFolder &&
                (!canNavigate ||
                  !resolveHttpBookmarkUrl(item.path, initialUrl, currentUrl)))
            }
            draggable={editable}
            onDragStart={(event) => {
              try {
                drag.current = { review: capture(), path: [index] };
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(
                  "application/x-sorng-native-bookmark",
                  "move",
                );
              } catch {
                event.preventDefault();
              }
            }}
            onDragEnd={() => {
              drag.current = null;
            }}
            onDragOver={(event) => {
              if (drag.current && editable) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}
            onDrop={(event) =>
              drop(
                event,
                item.isFolder ? [index] : [],
                item.isFolder ? undefined : index,
              )
            }
            onContextMenu={(event) => contextMenu(event, [index])}
            onKeyDown={(event) => {
              if (
                event.key === "ContextMenu" ||
                (event.shiftKey && event.key === "F10")
              )
                contextMenu(event, [index]);
            }}
            onClick={(event) => {
              if (item.isFolder) {
                const rect = event.currentTarget.getBoundingClientRect();
                open("folder", { x: rect.left, y: rect.bottom }, [index]);
              } else {
                try {
                  navigate(capture(), item);
                } catch {
                  setError(true);
                }
              }
            }}
          >
            {item.isFolder ? (
              <Folder size={14} aria-hidden="true" />
            ) : (
              <Star size={14} aria-hidden="true" />
            )}
            <span className="truncate">{item.name || "Unnamed bookmark"}</span>
          </button>
        ))}
        {!tree.length && (
          <span className="shrink-0 text-xs text-[var(--color-textSecondary)]">
            No saved bookmarks
          </span>
        )}
        {automation && (
          <WebAutomationFavoriteChips
            automation={automation}
            onContextMenuOpen={close}
            otherMenuOpen={!!ui}
          />
        )}
      </div>
      <button
        ref={trigger}
        type="button"
        className="sor-btn sor-icon-btn-sm shrink-0"
        aria-label="Manage bookmarks"
        data-tooltip="Manage bookmarks"
        aria-haspopup="menu"
        aria-expanded={!!ui}
        disabled={!editable}
        onClick={(event) => {
          if (ui) {
            close();
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          open("menu", { x: rect.left, y: rect.bottom });
        }}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {(!validTree || (error && !ui)) && (
        <span role="alert" className="text-xs text-error">
          Bookmarks cannot be changed. Check database access and saved
          bookmarks.
        </span>
      )}
      {ui && (ui.mode === "menu" || ui.mode === "folder") && (
        <MenuSurface
          isOpen
          position={ui.position}
          onClose={close}
          ariaLabel={
            ui.mode === "folder"
              ? selected?.name || "Bookmark folder"
              : "Bookmark actions"
          }
          ignoreRefs={[trigger]}
          className="w-72 max-h-[70dvh] overflow-y-auto"
        >
          {ui.mode === "folder" ? (
            <>
              {folderPath.length > 1 &&
                action("Parent folder", () =>
                  setUi({ ...ui, path: folderPath.slice(0, -1) }),
                )}
              {folderRows.map((item, index) => (
                <div key={index} className="flex items-center">
                  <button
                    type="button"
                    role="menuitem"
                    className="sor-menu-item min-w-0 flex-1"
                    disabled={
                      !eligible ||
                      pending ||
                      (!item.isFolder &&
                        (!canNavigate ||
                          !resolveHttpBookmarkUrl(
                            item.path,
                            initialUrl,
                            currentUrl,
                          )))
                    }
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setUi({
                        ...ui,
                        mode: "menu",
                        path: [...folderPath, index],
                      });
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.key === "ContextMenu" ||
                        (event.shiftKey && event.key === "F10")
                      ) {
                        event.preventDefault();
                        event.stopPropagation();
                        setUi({
                          ...ui,
                          mode: "menu",
                          path: [...folderPath, index],
                        });
                      }
                    }}
                    onClick={() =>
                      item.isFolder
                        ? setUi({ ...ui, path: [...folderPath, index] })
                        : navigate(ui.review, item)
                    }
                  >
                    {item.isFolder ? (
                      <Folder size={14} aria-hidden="true" />
                    ) : (
                      <Star size={14} aria-hidden="true" />
                    )}
                    <span className="truncate">
                      {item.name || "Unnamed bookmark"}
                    </span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="sor-btn sor-icon-btn-sm shrink-0"
                    aria-label={`Actions for ${item.name || "Unnamed bookmark"}`}
                    data-tooltip="Bookmark actions"
                    disabled={!editable}
                    onClick={() =>
                      setUi({
                        ...ui,
                        mode: "menu",
                        path: [...folderPath, index],
                      })
                    }
                  >
                    <MoreHorizontal size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
              {!folderRows.length && (
                <p className="px-3 py-2 text-xs text-[var(--color-textSecondary)]">
                  This folder is empty.
                </p>
              )}
              <div className="sor-menu-divider" />
              {action("Add bookmark here", () =>
                edit(false, undefined, folderPath),
              )}
              {action("New folder here", () =>
                edit(true, undefined, folderPath),
              )}
              {ui.path && action("Edit folder", () => edit(true, ui.path))}
            </>
          ) : selected ? (
            <>
              {action(selected.isFolder ? "Edit folder" : "Edit bookmark", () =>
                edit(!!selected.isFolder, ui.path),
              )}
              {!selected.isFolder && (
                <>
                  {action(
                    "Copy URL",
                    () => void linkAction(selectedUrl, false),
                    !selectedUrl,
                  )}
                  {action(
                    "Open externally…",
                    () =>
                      present({ ...ui, mode: "external", url: selectedUrl }),
                    !selectedUrl,
                  )}
                  <p className="px-3 py-2 text-xs text-[var(--color-textSecondary)]">
                    Copied URLs include any query or fragment values.
                  </p>
                </>
              )}
              {action(
                "Move left",
                () =>
                  void save(ui.review, {
                    kind: "move",
                    path: ui.path!,
                    parent: ui.path!.slice(0, -1),
                    before: ui.path![ui.path!.length - 1] - 1,
                  }),
                ui.path![ui.path!.length - 1] === 0,
              )}
              {action(
                "Move right",
                () =>
                  void save(ui.review, {
                    kind: "move",
                    path: ui.path!,
                    parent: ui.path!.slice(0, -1),
                    before: ui.path![ui.path!.length - 1] + 2,
                  }),
                ui.path![ui.path!.length - 1] ===
                  bookmarkChildren(ui.review.tree, ui.path!.slice(0, -1))
                    .length -
                    1,
              )}
              {action(
                "Delete",
                () => present({ ...ui, mode: "delete" }),
                false,
                true,
              )}
            </>
          ) : (
            <>
              {action(
                "Bookmark this page",
                () => edit(false, undefined, [], true),
                !current || !canNavigate,
              )}
              {action("Add bookmark", () => edit(false))}
              {action("New folder", () => edit(true))}
              {action(
                "Organize bookmarks",
                () => setUi({ ...ui, mode: "folder", path: undefined }),
                !ui.review.tree.length,
              )}
              {automation && (
                <>
                  <div className="sor-menu-divider" />
                  {action(
                    "Assign script",
                    () => openLibrary("script"),
                    !canManageAutomation,
                  )}
                  {action(
                    "Assign macro",
                    () => openLibrary("macro"),
                    !canManageAutomation,
                  )}
                  {action(
                    "Manage scripts & macros",
                    () => openLibrary(),
                    !canManageAutomation,
                  )}
                </>
              )}
              <div className="sor-menu-divider" />
              {action(
                "Delete all bookmarks",
                () => present({ ...ui, mode: "delete" }),
                !ui.review.tree.length,
                true,
              )}
            </>
          )}
          {pending && (
            <p role="status" className="px-3 py-2 text-xs">
              Working…
            </p>
          )}
          {message && (
            <p
              role="status"
              className="px-3 py-2 text-xs text-[var(--color-textSecondary)]"
            >
              {message}
            </p>
          )}
          {error && (
            <p role="alert" className="sor-alert-error m-2 text-sm">
              Could not save. Close and reopen after checking database access
              and current bookmarks.
            </p>
          )}
        </MenuSurface>
      )}
      {ui &&
        (ui.mode === "edit" ||
          ui.mode === "delete" ||
          ui.mode === "external") && (
          <Modal
            isOpen
            onClose={pending ? undefined : close}
            ariaLabel={
              ui.mode === "external"
                ? "Open bookmark externally"
                : ui.mode === "delete"
                  ? "Delete bookmarks"
                  : ui.folder
                    ? "Edit bookmark folder"
                    : "Edit website bookmark"
            }
            panelClassName="w-full max-w-lg mx-3 max-h-[90dvh]"
            contentClassName="flex min-h-0 flex-col overflow-hidden"
          >
            <ModalHeader
              title={
                ui.mode === "external"
                  ? "Open bookmark externally"
                  : ui.mode === "delete"
                    ? "Delete bookmarks"
                    : ui.folder
                      ? "Bookmark folder"
                      : "Website bookmark"
              }
              onClose={pending ? undefined : close}
            />
            <ModalBody className="space-y-3 overflow-y-auto p-4">
              {ui.mode === "external" ? (
                <>
                  <p className="text-sm">
                    Open this saved bookmark in your system browser? It runs
                    outside the app proxy, native browser route, and
                    per-connection policy. The URL may include sensitive query
                    or fragment values.
                  </p>
                  <TextInput
                    aria-label="External bookmark URL"
                    value={ui.url}
                    readOnly
                  />
                </>
              ) : ui.mode === "delete" ? (
                <p className="text-sm">
                  {selected
                    ? `Delete “${selected.name}”${selected.isFolder ? " and all its bookmarks" : ""}?`
                    : "Delete all bookmarks for this connection?"}{" "}
                  This cannot be undone.
                </p>
              ) : (
                <>
                  <label className="block space-y-1 text-sm">
                    <span>Name</span>
                    <TextInput
                      aria-label="Bookmark name"
                      value={ui.name}
                      maxLength={512}
                      disabled={pending}
                      onChange={(name) => setUi({ ...ui, name })}
                    />
                  </label>
                  {!ui.folder && (
                    <label className="block space-y-1 text-sm">
                      <span>URL or path</span>
                      <TextInput
                        aria-label="Bookmark URL or path"
                        value={ui.url}
                        disabled={pending}
                        maxLength={16384}
                        autoComplete="off"
                        spellCheck={false}
                        onChange={(url) => setUi({ ...ui, url })}
                      />
                    </label>
                  )}
                  <div className="space-y-1 text-sm">
                    <span>Folder</span>
                    <Select
                      label="Bookmark folder"
                      variant="form"
                      value={bookmarkPathKey(ui.parent)}
                      options={folders}
                      disabled={pending}
                      onChange={(value) =>
                        setUi({
                          ...ui,
                          parent: value ? value.split(".").map(Number) : [],
                        })
                      }
                    />
                  </div>
                  {!ui.folder && (
                    <p className="text-xs text-[var(--color-textSecondary)]">
                      Only HTTP(S) addresses without URL credentials are
                      supported. Relative paths use the connection origin.
                      Saving includes any query or fragment values; remove
                      sensitive tokens before saving.
                    </p>
                  )}
                </>
              )}
              {pending && (
                <p
                  role="status"
                  className="text-sm text-[var(--color-textSecondary)]"
                >
                  Working…
                </p>
              )}
              {message && (
                <p
                  role="status"
                  className="text-sm text-[var(--color-textSecondary)]"
                >
                  {message}
                </p>
              )}
              {error && (
                <p role="alert" className="sor-alert-error text-sm">
                  Could not save. Close and reopen after checking database
                  access and current bookmarks.
                </p>
              )}
            </ModalBody>
            <ModalFooter className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="sor-btn sor-btn-secondary"
                disabled={pending}
                onClick={close}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`sor-btn ${ui.mode === "delete" ? "sor-btn-danger" : "sor-btn-primary"}`}
                disabled={
                  !editable ||
                  (ui.mode === "edit" &&
                    (!ui.name.trim() ||
                      (!ui.folder &&
                        !resolveHttpBookmarkUrl(ui.url, initialUrl))))
                }
                onClick={() =>
                  ui.mode === "external"
                    ? void linkAction(ui.url, true)
                    : void save(
                        ui.review,
                        ui.mode === "delete"
                          ? ui.path
                            ? { kind: "remove", path: ui.path }
                            : { kind: "clear" }
                          : {
                              kind: "save",
                              path: ui.path,
                              parent: ui.parent,
                              item: ui.folder
                                ? {
                                    name: ui.name.trim(),
                                    isFolder: true,
                                    children: [],
                                  }
                                : { name: ui.name.trim(), path: ui.url.trim() },
                            },
                      )
                }
              >
                {ui.mode === "external"
                  ? "Open in system browser"
                  : ui.mode === "delete"
                    ? "Delete"
                    : "Save bookmark"}
              </button>
            </ModalFooter>
          </Modal>
        )}
    </div>
  );
}
