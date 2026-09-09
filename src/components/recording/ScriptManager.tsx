/* eslint-disable react-refresh/only-export-components, react/only-export-components */
import React, { useState } from "react";
import { useScriptManager } from "../../hooks/recording/useScriptManager";
import FilterToolbar from "./scriptManager/FilterToolbar";
import ScriptList from "./scriptManager/ScriptList";
import DetailPane from "./scriptManager/DetailPane";
import { DefaultScriptCatalog } from "./scriptManager/DefaultScriptCatalog";
import WebsiteUserScriptsPanel from "./scriptManager/WebsiteUserScriptsPanel";
import { ConfirmDialog } from "../ui/dialogs/ConfirmDialog";

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
  const [view, setView] = useState<"terminal" | "website">("terminal");
  const [catalog, setCatalog] = useState(false);
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
    if (next === view) return;
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
          disabled={websiteBusy}
          className="sor-btn sor-btn-secondary"
          onClick={() => switchView("terminal")}
        >
          Terminal scripts
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "website"}
          disabled={websiteBusy}
          className="sor-btn sor-btn-secondary"
          onClick={() => switchView("website")}
        >
          Website userscripts
        </button>
        {view === "terminal" && (
          <button
            type="button"
            className="sor-btn sor-btn-secondary ml-auto"
            onClick={() =>
              requestLeave(() => {
                mgr.handleCancelEdit();
                setCatalog(true);
              })
            }
          >
            Browse default scripts
          </button>
        )}
      </div>
      {view === "website" ? (
        <WebsiteUserScriptsPanel
          onDirtyChange={setWebsiteDirty}
          onBusyChange={setWebsiteBusy}
        />
      ) : (
        <>
          <FilterToolbar mgr={mgr} />
          <div className="flex-1 flex overflow-hidden">
            <ScriptList mgr={mgr} />
            <DetailPane mgr={mgr} />
          </div>
        </>
      )}
      {catalog && (
        <DefaultScriptCatalog
          onClose={() => setCatalog(false)}
          onApplied={mgr.handleCatalogApplied}
        />
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
