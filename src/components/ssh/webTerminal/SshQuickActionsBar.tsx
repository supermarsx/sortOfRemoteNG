import { lazy, Suspense, useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  FileCode,
  ListVideo,
  Plus,
  Play,
  RefreshCw,
  Search,
  Settings2,
  StopCircle,
  Trash2,
  X,
} from "lucide-react";
import Modal, {
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "../../ui/overlays/Modal";
import MenuSurface from "../../ui/overlays/MenuSurface";
import type { useSshQuickActions } from "../../../hooks/ssh/useSshQuickActions";
import {
  quickActionReferenceKey,
  quickActionScopeLabel,
} from "../../../utils/connection/sessionQuickActions";

const ScriptManager = lazy(() =>
  import("../../recording/ScriptManager").then((module) => ({
    default: module.ScriptManager,
  })),
);
const MacroManager = lazy(() =>
  import("../../recording/MacroManager").then((module) => ({
    default: module.MacroManager,
  })),
);
type Actions = ReturnType<typeof useSshQuickActions>;
type ActionKind = "script" | "macro";
interface ContextMenu {
  x: number;
  y: number;
  favoriteKey?: string;
  favorites: Actions["favorites"];
  remove: Actions["remove"];
  run: Actions["run"];
}

export default function SshQuickActionsBar({
  actions,
  replaying,
  onStopReplay,
}: {
  actions: Actions;
  replaying: boolean;
  onStopReplay: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [manager, setManager] = useState<ActionKind | null>(null);
  const [assignmentKind, setAssignmentKind] = useState<ActionKind | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [dialogOwner, setDialogOwner] = useState<Pick<
    ContextMenu,
    "remove" | "run"
  > | null>(null);
  const dialogCurrent =
    dialogOwner?.remove === actions.remove && dialogOwner?.run === actions.run;
  const managementReady =
    actions.enabled &&
    !actions.unavailable &&
    !actions.busy &&
    !actions.loading &&
    !replaying;
  // References and owner-bound callbacks are captured, never script bodies.
  // A refreshed library or owner change requires a fresh context-menu review.
  const contextCurrent =
    !!contextMenu &&
    contextMenu.favorites === actions.favorites &&
    contextMenu.remove === actions.remove &&
    contextMenu.run === actions.run;
  const contextFavorite =
    contextCurrent && contextMenu.favoriteKey
      ? actions.favorites.find(
          (favorite) =>
            quickActionReferenceKey(favorite) === contextMenu.favoriteKey,
        )
      : undefined;
  const contextIndex = contextFavorite
    ? actions.favorites.indexOf(contextFavorite)
    : -1;
  useEffect(() => {
    if (actions.unavailable || !actions.enabled) {
      setOpen(false);
      setManager(null);
      setAssignmentKind(null);
      setContextMenu(null);
      setDialogOwner(null);
    }
  }, [actions.unavailable, actions.enabled]);
  useEffect(() => {
    if (contextMenu && (!contextCurrent || !managementReady))
      setContextMenu(null);
  }, [contextMenu, contextCurrent, managementReady]);
  useEffect(() => {
    if (open && !dialogCurrent) {
      setOpen(false);
      setManager(null);
      setAssignmentKind(null);
      setDialogOwner(null);
    }
  }, [open, dialogCurrent]);
  if (!actions.enabled) return null;
  const close = () => {
    setOpen(false);
    setManager(null);
    setAssignmentKind(null);
    setDialogOwner(null);
    void actions.refresh();
  };
  const openLibrary = (
    kind: ActionKind | null = null,
    manage: ActionKind | null = null,
  ) => {
    if (!managementReady) return;
    setContextMenu(null);
    setAssignmentKind(kind);
    setManager(manage);
    setDialogOwner({ remove: actions.remove, run: actions.run });
    setOpen(true);
    actions.setQuery("");
    void actions.refresh();
  };
  const openContext = (x: number, y: number, favoriteKey?: string) => {
    if (!managementReady) return;
    setContextMenu({
      x,
      y,
      favoriteKey,
      favorites: actions.favorites,
      remove: actions.remove,
      run: actions.run,
    });
  };
  const reviewedContextAction = (action: () => void) => {
    if (!contextCurrent || !managementReady) return;
    setContextMenu(null);
    action();
  };
  const dialogTitle = manager
    ? `Manage ${manager === "script" ? "scripts" : "macros"}`
    : assignmentKind
      ? `Assign SSH ${assignmentKind}`
      : "SSH favorites";
  const available = actions.available.filter(
    (item) => !assignmentKind || item.kind === assignmentKind,
  );
  const message = actions.unavailable ?? actions.error;
  return (
    <>
      <div
        className="flex min-w-0 flex-col gap-1 border-t border-[var(--color-border)] px-3 py-1"
        data-testid="ssh-quick-actions"
        role="group"
        aria-label="SSH favorites bar"
        tabIndex={0}
        aria-haspopup="menu"
        onContextMenu={(event) => {
          const target = event.target;
          if (
            event.defaultPrevented ||
            !(target instanceof Element) ||
            !event.currentTarget.contains(target)
          )
            return;
          const control = target.closest(
            'button, a, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="menu"], [role="menuitem"], [role="dialog"], [tabindex]',
          );
          if (control && control !== event.currentTarget) return;
          event.preventDefault();
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          openContext(event.clientX || rect.left, event.clientY || rect.bottom);
        }}
        onKeyDown={(event) => {
          if (
            event.target !== event.currentTarget ||
            !(
              event.key === "ContextMenu" ||
              (event.shiftKey && event.key === "F10")
            )
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          openContext(rect.left, rect.bottom);
        }}
      >
        <div className="flex min-w-0 items-center gap-1">
          <label className="flex w-36 shrink-0 items-center gap-1 rounded border border-[var(--color-border)] px-1.5">
            <Search size={12} aria-hidden="true" />
            <input
              className="sor-search-inline min-w-0 py-1 text-xs"
              aria-label="Search SSH favorites"
              placeholder="Find favorite…"
              value={actions.query}
              onChange={(event) => actions.setQuery(event.target.value)}
            />
          </label>
          <div
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
            aria-label="SSH favorites"
          >
            {!actions.favorites.length && (
              <span className="whitespace-nowrap px-1 text-xs text-[var(--color-textMuted)]">
                Add scripts or macros for this connection
              </span>
            )}
            {actions.visibleFavorites.map((favorite) => (
              <span
                key={quickActionReferenceKey(favorite)}
                className="shrink-0"
                role="group"
                aria-label={`${favorite.kind} ${favorite.name} favorite`}
                tabIndex={
                  !actions.canRun || favorite.missing || replaying ? 0 : -1
                }
                aria-haspopup="menu"
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  openContext(
                    event.clientX || rect.left,
                    event.clientY || rect.bottom,
                    quickActionReferenceKey(favorite),
                  );
                }}
                onKeyDown={(event) => {
                  if (!(
                    event.key === "ContextMenu" ||
                    (event.shiftKey && event.key === "F10")
                  ))
                    return;
                  event.preventDefault();
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  openContext(
                    rect.left,
                    rect.bottom,
                    quickActionReferenceKey(favorite),
                  );
                }}
              >
                <button
                  type="button"
                  className="app-bar-button flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs"
                  title={`${favorite.name} · ${quickActionScopeLabel(favorite)} · ${favorite.kind}${favorite.missing ? " · unavailable" : ""}`}
                  aria-label={`Run ${favorite.kind} ${favorite.name}`}
                  disabled={!actions.canRun || favorite.missing || replaying}
                  onClick={() => {
                    if (actions.canRun && !favorite.missing && !replaying)
                      void actions.run(favorite);
                  }}
                >
                  {favorite.kind === "script" ? (
                    <FileCode size={12} />
                  ) : (
                    <ListVideo size={12} />
                  )}
                  <span className="max-w-40 truncate">{favorite.name}</span>
                </button>
              </span>
            ))}
          </div>
          {replaying && (
            <button
              type="button"
              className="app-bar-button p-1 text-warning"
              onClick={onStopReplay}
              aria-label="Stop macro replay"
            >
              <StopCircle size={14} />
            </button>
          )}
          <button
            type="button"
            className="app-bar-button p-1"
            aria-label="Add or manage SSH favorites"
            disabled={!managementReady}
            onClick={() => openLibrary()}
          >
            <Plus size={14} />
          </button>
        </div>
        {message && (
          <div
            className="flex items-start gap-2 text-xs text-warning"
            role="status"
          >
            <span className="min-w-0 flex-1 break-words">{message}</span>
            <button
              type="button"
              className="app-bar-button shrink-0 p-1"
              aria-label="Reload SSH action libraries"
              disabled={actions.loading}
              onClick={() => {
                void actions.refresh();
              }}
            >
              <RefreshCw size={12} />
            </button>
          </div>
        )}
      </div>
      <MenuSurface
        isOpen={contextCurrent && managementReady}
        onClose={() => setContextMenu(null)}
        position={contextMenu}
        className="w-64 max-w-[calc(100vw-8px)] rounded-lg py-1"
        ariaLabel={
          contextFavorite ? "SSH favorite actions" : "SSH favorites actions"
        }
      >
        {contextFavorite && (
          <>
            <button
              type="button"
              role="menuitem"
              className="sor-menu-item text-xs py-1.5"
              disabled={!actions.canRun || contextFavorite.missing || replaying}
              onClick={() =>
                reviewedContextAction(() => {
                  if (actions.canRun && !contextFavorite.missing && !replaying)
                    void actions.run(contextFavorite);
                })
              }
            >
              <Play size={12} />
              <span className="truncate">
                Run {contextFavorite.kind} {contextFavorite.name}
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="sor-menu-item text-xs py-1.5"
              disabled={contextIndex <= 0}
              onClick={() =>
                reviewedContextAction(() => {
                  if (contextIndex > 0) void actions.move(contextFavorite, -1);
                })
              }
            >
              <ArrowLeft size={12} /> Move earlier
            </button>
            <button
              type="button"
              role="menuitem"
              className="sor-menu-item text-xs py-1.5"
              disabled={
                contextIndex < 0 || contextIndex >= actions.favorites.length - 1
              }
              onClick={() =>
                reviewedContextAction(() => {
                  if (
                    contextIndex >= 0 &&
                    contextIndex < actions.favorites.length - 1
                  )
                    void actions.move(contextFavorite, 1);
                })
              }
            >
              <ArrowRight size={12} /> Move later
            </button>
            <button
              type="button"
              role="menuitem"
              className="sor-menu-item sor-menu-item-danger text-xs py-1.5"
              onClick={() =>
                reviewedContextAction(() => {
                  void actions.remove(contextFavorite);
                })
              }
            >
              <Trash2 size={12} /> Remove favorite
            </button>
            <div className="sor-menu-divider" />
          </>
        )}
        <button
          type="button"
          role="menuitem"
          className="sor-menu-item text-xs py-1.5"
          onClick={() => reviewedContextAction(() => openLibrary("script"))}
        >
          <FileCode size={12} /> Assign script
        </button>
        <button
          type="button"
          role="menuitem"
          className="sor-menu-item text-xs py-1.5"
          onClick={() => reviewedContextAction(() => openLibrary("macro"))}
        >
          <ListVideo size={12} /> Assign macro
        </button>
        <button
          type="button"
          role="menuitem"
          className="sor-menu-item text-xs py-1.5"
          onClick={() => reviewedContextAction(() => openLibrary())}
        >
          <Settings2 size={12} /> Manage favorites
        </button>
        <button
          type="button"
          role="menuitem"
          className="sor-menu-item text-xs py-1.5"
          onClick={() =>
            reviewedContextAction(() => openLibrary(null, "script"))
          }
        >
          <FileCode size={12} /> Manage scripts
        </button>
        <button
          type="button"
          role="menuitem"
          className="sor-menu-item text-xs py-1.5"
          onClick={() =>
            reviewedContextAction(() => openLibrary(null, "macro"))
          }
        >
          <ListVideo size={12} /> Manage macros
        </button>
      </MenuSurface>
      <Modal
        isOpen={
          open && dialogCurrent && !actions.unavailable && actions.enabled
        }
        onClose={close}
        ariaLabel={dialogTitle}
        panelClassName={manager ? "max-w-5xl w-full" : "max-w-2xl w-full"}
        contentClassName="flex max-h-[85vh] flex-col overflow-hidden"
      >
        <ModalHeader onClose={close} title={dialogTitle} />
        {manager ? (
          <div className="h-[65vh] min-h-0 overflow-hidden">
            <Suspense
              fallback={<p className="p-4 text-sm">Loading library…</p>}
            >
              {manager === "script" ? (
                <ScriptManager isOpen onClose={close} />
              ) : (
                <MacroManager isOpen onClose={close} />
              )}
            </Suspense>
          </div>
        ) : (
          <ModalBody className="space-y-4 p-4">
            <p className="text-xs text-[var(--color-textSecondary)]">
              Only library references are saved on this connection. Adding or
              moving a favorite never runs it. Removed library entries stay
              listed until you remove their reference.
            </p>
            <p className="text-xs text-[var(--color-textMuted)]">
              Compatible older libraries migrate automatically when their
              protected storage is available. Locked, conflicting or invalid
              data is retained for recovery, never replaced with an empty
              library.
            </p>
            {message && (
              <p role="alert" className="text-xs text-warning">
                {message}
              </p>
            )}
            {!assignmentKind && (
              <div className="space-y-1" aria-label="Manage favorite order">
                {actions.favorites.map((favorite, index) => (
                  <div
                    key={quickActionReferenceKey(favorite)}
                    className="flex items-center gap-2 rounded border border-[var(--color-border)] p-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {favorite.name}{" "}
                      <span className="text-xs text-[var(--color-textMuted)]">
                        ({quickActionScopeLabel(favorite)} · {favorite.kind})
                      </span>
                    </span>
                    <button
                      type="button"
                      className="app-bar-button p-1"
                      disabled={!managementReady || index === 0}
                      aria-label={`Move ${favorite.name} earlier`}
                      onClick={() => {
                        void actions.move(favorite, -1);
                      }}
                    >
                      <ArrowLeft size={14} />
                    </button>
                    <button
                      type="button"
                      className="app-bar-button p-1"
                      disabled={
                        !managementReady ||
                        index === actions.favorites.length - 1
                      }
                      aria-label={`Move ${favorite.name} later`}
                      onClick={() => {
                        void actions.move(favorite, 1);
                      }}
                    >
                      <ArrowRight size={14} />
                    </button>
                    <button
                      type="button"
                      className="app-bar-button p-1"
                      disabled={!managementReady}
                      aria-label={`Remove favorite ${favorite.name}`}
                      onClick={() => {
                        void actions.remove(favorite);
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <input
              className="sor-form-input w-full"
              aria-label="Search script and macro libraries"
              placeholder="Search scripts and macros…"
              value={actions.query}
              onChange={(event) => actions.setQuery(event.target.value)}
            />
            <div
              className="max-h-60 space-y-1 overflow-auto"
              aria-label="Available SSH actions"
            >
              {actions.loading ? (
                <p className="text-sm">Loading protected libraries…</p>
              ) : available.length ? (
                available.map((item) => (
                  <button
                    key={quickActionReferenceKey(item)}
                    type="button"
                    disabled={!managementReady}
                    className="app-bar-button flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm"
                    aria-label={`Add ${item.kind} ${item.name}`}
                    onClick={() => {
                      if (
                        managementReady &&
                        (!assignmentKind || item.kind === assignmentKind)
                      )
                        void actions.add(item);
                    }}
                  >
                    <Plus size={12} />
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    <span className="text-xs text-[var(--color-textMuted)]">
                      {quickActionScopeLabel(item)} · {item.kind}
                    </span>
                  </button>
                ))
              ) : (
                <p className="text-sm text-[var(--color-textMuted)]">
                  No matching{" "}
                  {assignmentKind ? `${assignmentKind}s` : "actions"} available
                  to add.
                </p>
              )}
            </div>
          </ModalBody>
        )}
        <ModalFooter className="flex flex-wrap items-center gap-2">
          {manager ? (
            <button
              type="button"
              className="sor-btn sor-btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-xs"
              onClick={() => {
                setManager(null);
                void actions.refresh();
              }}
            >
              Back to favorites
            </button>
          ) : (
            <>
              {assignmentKind && (
                <button
                  type="button"
                  className="sor-btn sor-btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-xs"
                  disabled={!managementReady}
                  onClick={() => setAssignmentKind(null)}
                >
                  Show all favorites
                </button>
              )}
              <button
                type="button"
                className="sor-btn sor-btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-xs"
                disabled={!managementReady}
                onClick={() => setManager("script")}
              >
                <Settings2 size={14} />
                Manage scripts
              </button>
              <button
                type="button"
                className="sor-btn sor-btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-xs"
                disabled={!managementReady}
                onClick={() => setManager("macro")}
              >
                <Settings2 size={14} />
                Manage macros
              </button>
            </>
          )}
        </ModalFooter>
      </Modal>
    </>
  );
}
