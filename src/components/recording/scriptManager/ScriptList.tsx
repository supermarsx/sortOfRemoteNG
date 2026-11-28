import ScriptListItem from "./ScriptListItem";
import EmptyState from "../../ui/display/EmptyState";
import { useTranslation } from "react-i18next";
import type { ScriptManagerMgr } from "../../../hooks/recording/useScriptManager";
import { FileCode, Folder, FolderPlus } from "lucide-react";
import { useState } from "react";

function ScriptList({ mgr }: { mgr: ScriptManagerMgr }) {
  const { t } = useTranslation();
  const [newFolder, setNewFolder] = useState<string | null>(null);
  return (
    <div className="w-80 border-r border-[var(--color-border)] flex flex-col bg-[var(--color-surface)]">
      <div className="border-b border-[var(--color-border)] p-2 space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span>Folders</span>
          <button
            type="button"
            className="sor-icon-btn"
            aria-label="Create script folder"
            disabled={!mgr.ready || mgr.busy || mgr.isEditing}
            onClick={() => setNewFolder("")}
          >
            <FolderPlus size={14} />
          </button>
        </div>
        {newFolder !== null && (
          <div className="flex gap-1">
            <input
              className="sor-form-input min-w-0 flex-1"
              aria-label="New script folder name"
              maxLength={128}
              value={newFolder}
              onChange={(event) => setNewFolder(event.target.value)}
            />
            <button
              type="button"
              className="sor-btn-secondary-sm"
              disabled={!newFolder.trim() || mgr.busy}
              onClick={() =>
                void mgr.createFolder(newFolder).then((saved) => {
                  if (saved) setNewFolder(null);
                })
              }
            >
              Create
            </button>
            <button
              type="button"
              className="sor-btn-secondary-sm"
              disabled={mgr.busy}
              onClick={() => setNewFolder(null)}
            >
              Cancel
            </button>
          </div>
        )}
        <div className="max-h-40 overflow-y-auto">
          <button
            type="button"
            className="sor-menu-item text-xs"
            onClick={() => mgr.setCategoryFilter("")}
          >
            All scripts
          </button>
          {mgr.folders.map((folder) => (
            <button
              key={folder}
              type="button"
              className={`sor-menu-item text-xs ${mgr.categoryFilter === folder ? "bg-primary/10" : ""}`}
              aria-pressed={mgr.categoryFilter === folder}
              onDragOver={(event) => {
                if (
                  !mgr.busy &&
                  !mgr.isEditing &&
                  event.dataTransfer.types.includes(
                    "application/x-sorng-library-script",
                  )
                ) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (mgr.busy || mgr.isEditing) return;
                try {
                  const source = JSON.parse(
                    event.dataTransfer.getData(
                      "application/x-sorng-library-script",
                    ),
                  );
                  const script = mgr.scripts.find(
                    (script) => script.id === source.id,
                  );
                  if (
                    source.access === mgr.accessKey &&
                    script &&
                    script.category !== folder
                  )
                    void mgr.moveToFolder(script, folder);
                } catch {
                  /* Ignore foreign or expired drags. */
                }
              }}
              onClick={() => mgr.setCategoryFilter(folder)}
            >
              <Folder size={13} />
              <span className="truncate">{folder}</span>
              <span className="ml-auto text-[var(--color-textMuted)]">
                {
                  mgr.scripts.filter((script) => script.category === folder)
                    .length
                }
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {mgr.filteredScripts.length === 0 ? (
          <EmptyState
            icon={FileCode}
            message={
              !mgr.scripts.length
                ? t(
                    "scriptManager.emptyExplicitLibrary",
                    "No scripts in this library. Import templates from Browse scripts or create one.",
                  )
                : t("scriptManager.noScripts", "No scripts found")
            }
            className="p-8"
          />
        ) : (
          <div className="p-2 space-y-1">
            {mgr.filteredScripts.map((script) => (
              <ScriptListItem key={script.id} script={script} mgr={mgr} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ScriptList;
