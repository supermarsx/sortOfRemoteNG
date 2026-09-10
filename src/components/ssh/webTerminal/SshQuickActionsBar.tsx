import { lazy, Suspense, useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  FileCode,
  ListVideo,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  StopCircle,
  X,
} from "lucide-react";
import Modal, {
  ModalBody,
  ModalFooter,
  ModalHeader,
} from "../../ui/overlays/Modal";
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
  const [manager, setManager] = useState<"script" | "macro" | null>(null);
  useEffect(() => {
    if (actions.unavailable || !actions.enabled) {
      setOpen(false);
      setManager(null);
    }
  }, [actions.unavailable, actions.enabled]);
  if (!actions.enabled) return null;
  const close = () => {
    setOpen(false);
    setManager(null);
    void actions.refresh();
  };
  const message = actions.unavailable ?? actions.error;
  return (
    <>
      <div
        className="flex min-w-0 flex-col gap-1 border-t border-[var(--color-border)] px-3 py-1"
        data-testid="ssh-quick-actions"
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
              <button
                key={quickActionReferenceKey(favorite)}
                type="button"
                className="app-bar-button flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs"
                title={`${favorite.name} · ${quickActionScopeLabel(favorite)} · ${favorite.kind}${favorite.missing ? " · unavailable" : ""}`}
                aria-label={`Run ${favorite.kind} ${favorite.name}`}
                disabled={!actions.canRun || favorite.missing || replaying}
                onClick={() => {
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
            disabled={!!actions.unavailable || actions.busy}
            onClick={() => {
              setOpen(true);
              void actions.refresh();
            }}
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
      <Modal
        isOpen={open && !actions.unavailable && actions.enabled}
        onClose={close}
        ariaLabel={
          manager
            ? `Manage ${manager === "script" ? "scripts" : "macros"}`
            : "SSH favorites"
        }
        panelClassName={manager ? "max-w-5xl w-full" : "max-w-2xl w-full"}
        contentClassName="flex max-h-[85vh] flex-col overflow-hidden"
      >
        <ModalHeader
          onClose={close}
          title={
            manager
              ? `Manage ${manager === "script" ? "scripts" : "macros"}`
              : "SSH favorites"
          }
        />
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
            {message && (
              <p role="alert" className="text-xs text-warning">
                {message}
              </p>
            )}
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
                    disabled={actions.busy || index === 0}
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
                      actions.busy || index === actions.favorites.length - 1
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
                    disabled={actions.busy}
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
              ) : (
                actions.available.map((item) => (
                  <button
                    key={quickActionReferenceKey(item)}
                    type="button"
                    disabled={actions.busy || !!actions.unavailable}
                    className="app-bar-button flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm"
                    aria-label={`Add ${item.kind} ${item.name}`}
                    onClick={() => {
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
              <button
                type="button"
                className="sor-btn sor-btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-xs"
                disabled={!!actions.unavailable}
                onClick={() => setManager("script")}
              >
                <Settings2 size={14} />
                Manage scripts
              </button>
              <button
                type="button"
                className="sor-btn sor-btn-secondary inline-flex items-center gap-1 px-3 py-1.5 text-xs"
                disabled={!!actions.unavailable}
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
