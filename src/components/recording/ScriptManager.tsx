/* eslint-disable react-refresh/only-export-components, react/only-export-components */
import React, { lazy, Suspense, useState } from "react";
import { useScriptManager } from "../../hooks/recording/useScriptManager";
import FilterToolbar from "./scriptManager/FilterToolbar";
import ScriptList from "./scriptManager/ScriptList";
import DetailPane from "./scriptManager/DetailPane";
import WebsiteUserScriptsPanel from "./scriptManager/WebsiteUserScriptsPanel";
import { ConfirmDialog } from "../ui/dialogs/ConfirmDialog";
const DefaultScriptCatalog = lazy(() =>
  import("./scriptManager/DefaultScriptCatalog").then((module) => ({
    default: module.DefaultScriptCatalog,
  })),
);

// Re-export shared types and constants for backward compatibility
export type {
  ManagedScript,
  ScriptLanguage,
  OSTag,
} from "./scriptManager/shared";
export {
  SCRIPTS_STORAGE_KEY,
  getDefaultScripts,
  OS_TAG_LABELS,
  OS_TAG_ICONS,
  languageLabels,
  languageIcons,
} from "./scriptManager/shared";

interface ScriptManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ScriptManager: React.FC<ScriptManagerProps> = ({
  isOpen,
  onClose,
}) => {
  const mgr = useScriptManager(onClose);
  const [view, setView] = useState<"terminal" | "website" | "browse">(
    "terminal",
  );
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [websiteDirty, setWebsiteDirty] = useState(false);
  const [websiteBusy, setWebsiteBusy] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const requestLeave = (action: () => void) => {
    if (
      (view === "terminal" && mgr.isEditing) ||
      (view === "website" && websiteDirty)
    )
      setPendingLeave(() => action);
    else action();
  };
  const switchView = (next: typeof view) => {
    if (next === view || websiteBusy || catalogBusy) return;
    requestLeave(() => {
      mgr.handleCancelEdit();
      setView(next);
    });
  };

  if (!isOpen) return null;

  return (
    <div className="h-full flex flex-col bg-[var(--color-surface)] overflow-hidden">
      <div
        className="flex shrink-0 flex-wrap gap-2 border-b border-[var(--color-border)] p-3"
        role="tablist"
        aria-label="Script library kind"
      >
        <button
          type="button"
          role="tab"
          aria-selected={view === "terminal"}
          disabled={websiteBusy || catalogBusy}
          className={`sor-tab-trigger ${view === "terminal" ? "sor-tab-trigger-active" : ""}`}
          onClick={() => switchView("terminal")}
        >
          Terminal scripts
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "website"}
          disabled={websiteBusy || catalogBusy}
          className={`sor-tab-trigger ${view === "website" ? "sor-tab-trigger-active" : ""}`}
          onClick={() => switchView("website")}
        >
          Website userscripts
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "browse"}
          disabled={websiteBusy || catalogBusy}
          className={`sor-tab-trigger ${view === "browse" ? "sor-tab-trigger-active" : ""}`}
          onClick={() => switchView("browse")}
        >
          Browse scripts
        </button>
      </div>
      {view === "website" ? (
        <WebsiteUserScriptsPanel
          onDirtyChange={setWebsiteDirty}
          onBusyChange={setWebsiteBusy}
        />
      ) : view === "browse" ? (
        <Suspense
          fallback={
            <p role="status" className="p-4">
              Loading bundled scripts…
            </p>
          }
        >
          <DefaultScriptCatalog
            onApplied={mgr.handleCatalogApplied}
            onBusyChange={setCatalogBusy}
          />
        </Suspense>
      ) : (
        <>
          <FilterToolbar mgr={mgr} />
          <div className="flex-1 flex overflow-hidden">
            <ScriptList mgr={mgr} />
            <DetailPane mgr={mgr} />
          </div>
        </>
      )}
      <ConfirmDialog
        isOpen={pendingLeave !== null}
        title="Discard script draft?"
        message="This unsaved draft will be discarded. Your saved library will not change."
        confirmText="Discard draft"
        cancelText="Keep editing"
        variant="warning"
        confirmOnEnter={false}
        onCancel={() => setPendingLeave(null)}
        onConfirm={() => {
          const action = pendingLeave;
          setPendingLeave(null);
          action?.();
        }}
      />
    </div>
  );
};
