import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  FileCode,
  Folder,
  HardDrive,
  Library,
  Monitor,
  Network,
  Package,
  RotateCcw,
  Router,
  Save,
  Server,
  Shield,
  Smartphone,
  Terminal,
  Trash2,
  Workflow,
} from "lucide-react";
import EmptyState from "../../ui/display/EmptyState";
import { Select } from "../../ui/forms";
import {
  MAX_BULK_SCRIPT_DESCRIPTION_LENGTH,
  MAX_BULK_SCRIPT_NAME_LENGTH,
  type BulkScriptDeleteConfirmation,
  type BulkScriptRunConfirmation,
  type BulkScriptType,
} from "../../../hooks/ssh/bulkScriptLibrary";
import { Mgr, TFunc } from "./types";

const SCRIPT_TYPE_ICONS: Record<BulkScriptType, LucideIcon> = {
  shell: Terminal,
  system: Monitor,
  network: Network,
  package: Package,
  service: Server,
  filesystem: Folder,
  security: Shield,
  "cisco-ios": Router,
  hpe: HardDrive,
  arista: Workflow,
  android: Smartphone,
};

function ScriptLibraryPanel({ mgr, t }: { mgr: Mgr; t: TFunc }) {
  const showingTrash = mgr.scriptLibrarySection === "trash";
  const visibleScripts = showingTrash
    ? mgr.filteredTrashedScripts
    : mgr.filteredScripts;
  const visibleCategories = Array.from(
    new Set(visibleScripts.map((script) => script.category)),
  ).sort();
  const categoryOptions = Array.from(
    new Set([...mgr.categories, "Custom"]),
  ).map((category) => ({ value: category, label: category }));

  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] max-h-96 overflow-hidden flex flex-col">
      <div className="px-4 py-2 border-b border-[var(--color-border)] flex items-center gap-3 bg-[var(--color-surfaceHover)]/30">
        <input
          type="text"
          value={mgr.scriptFilter}
          onChange={(event) => mgr.setScriptFilter(event.target.value)}
          placeholder={t("bulkSsh.searchScripts", "Search scripts...")}
          className="sor-form-input-sm flex-1 placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {!showingTrash && mgr.command.trim() && (
          <button
            onClick={() => {
              mgr.setNewScriptCategory("Custom");
              mgr.setNewScriptType("shell");
              mgr.setNewScriptRisk("standard");
              mgr.setEditingScript({
                id: "",
                name: "",
                description: "",
                script: mgr.command,
                category: "Custom",
                type: "shell",
                risk: "standard",
                createdAt: "",
                updatedAt: "",
              });
            }}
            disabled={!mgr.scriptLibraryLoaded}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary hover:bg-primary/90 disabled:bg-[var(--color-surfaceHover)] disabled:opacity-50 text-[var(--color-text)] rounded-md transition-colors"
          >
            <Save size={14} />
            {t("bulkSsh.saveAsScript", "Save Current")}
          </button>
        )}
      </div>

      <div className="px-4 py-2 border-b border-[var(--color-border)] flex flex-wrap items-center gap-2 text-xs">
        <div className="inline-flex rounded-md border border-[var(--color-border)] overflow-hidden">
          <button
            type="button"
            onClick={() => mgr.setScriptLibrarySection("active")}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 ${
              !showingTrash
                ? "bg-primary/15 text-primary"
                : "text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)]"
            }`}
          >
            <Library size={13} />
            {t("bulkSsh.scriptLibrary", "Library")} ({mgr.savedScripts.length})
          </button>
          <button
            type="button"
            onClick={() => mgr.setScriptLibrarySection("trash")}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 border-l border-[var(--color-border)] ${
              showingTrash
                ? "bg-primary/15 text-primary"
                : "text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)]"
            }`}
          >
            <Trash2 size={13} />
            {t("bulkSsh.scriptTrash", "Trash")} ({mgr.trashedScripts.length})
          </button>
        </div>

        <span className="ml-auto text-[var(--color-textMuted)]">
          {t("bulkSsh.confirmRun", "Confirm run")}
        </span>
        <Select
          value={mgr.scriptLibraryConfig.runConfirmation}
          disabled={!mgr.scriptLibraryLoaded}
          onChange={(value) =>
            void mgr.setScriptRunConfirmation(
              value as BulkScriptRunConfirmation,
            )
          }
          options={[
            { value: "destructive-only", label: "Destructive" },
            { value: "always", label: "Always" },
            { value: "never", label: "Never" },
          ]}
          className="min-w-28"
        />
        <span className="text-[var(--color-textMuted)]">
          {t("bulkSsh.confirmDelete", "Confirm delete")}
        </span>
        <Select
          value={mgr.scriptLibraryConfig.deleteConfirmation}
          disabled={!mgr.scriptLibraryLoaded}
          onChange={(value) =>
            void mgr.setScriptDeleteConfirmation(
              value as BulkScriptDeleteConfirmation,
            )
          }
          options={[
            { value: "permanent-only", label: "Permanent" },
            { value: "always", label: "Always" },
            { value: "never", label: "Never" },
          ]}
          className="min-w-28"
        />
        {showingTrash && mgr.trashedScripts.length > 0 && (
          <button
            type="button"
            onClick={() => void mgr.emptyScriptTrash()}
            disabled={!mgr.scriptLibraryLoaded}
            className="inline-flex items-center gap-1 px-2 py-1 text-error hover:bg-error/10 rounded"
          >
            <Trash2 size={12} />
            {t("bulkSsh.emptyTrash", "Empty trash")}
          </button>
        )}
      </div>

      {mgr.editingScript && !showingTrash && (
        <div className="px-4 py-3 border-b border-[var(--color-border)] bg-primary/5 space-y-2">
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={mgr.newScriptName}
              onChange={(event) => mgr.setNewScriptName(event.target.value)}
              maxLength={MAX_BULK_SCRIPT_NAME_LENGTH}
              placeholder={t("bulkSsh.scriptName", "Script name")}
              className="sor-form-input-sm flex-1 min-w-40 placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <Select
              value={mgr.newScriptCategory}
              onChange={mgr.setNewScriptCategory}
              options={categoryOptions}
              className="min-w-28"
            />
            <Select
              value={mgr.newScriptType}
              onChange={(value) =>
                mgr.setNewScriptType(value as BulkScriptType)
              }
              options={[...mgr.scriptTypeOptions]}
              className="min-w-28"
            />
            <label className="inline-flex items-center gap-1.5 px-2 text-xs text-[var(--color-textSecondary)]">
              <input
                type="checkbox"
                checked={mgr.newScriptRisk === "destructive"}
                onChange={(event) =>
                  mgr.setNewScriptRisk(
                    event.target.checked ? "destructive" : "standard",
                  )
                }
              />
              {t("bulkSsh.destructiveScript", "Destructive")}
            </label>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={mgr.newScriptDescription}
              onChange={(event) =>
                mgr.setNewScriptDescription(event.target.value)
              }
              maxLength={MAX_BULK_SCRIPT_DESCRIPTION_LENGTH}
              placeholder={t(
                "bulkSsh.scriptDescription",
                "Description (optional)",
              )}
              className="sor-form-input-sm flex-1 placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={() => void mgr.saveCurrentAsScript()}
              disabled={!mgr.scriptLibraryLoaded || !mgr.newScriptName.trim()}
              className="px-4 py-1.5 text-sm bg-primary hover:bg-primary/90 disabled:bg-[var(--color-surfaceHover)] disabled:opacity-50 text-[var(--color-text)] rounded-md transition-colors"
            >
              {t("common.save", "Save")}
            </button>
            <button
              onClick={() => mgr.setEditingScript(null)}
              className="px-4 py-1.5 text-sm bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded-md transition-colors"
            >
              {t("common.cancel", "Cancel")}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {visibleCategories.map((category) => {
          const categoryScripts = visibleScripts.filter(
            (script) => script.category === category,
          );
          return (
            <div key={category}>
              <div className="px-4 py-1.5 text-xs font-medium text-[var(--color-textSecondary)] bg-[var(--color-surfaceHover)]/50 uppercase tracking-wide">
                {category}
              </div>
              {categoryScripts.map((script) => {
                const TypeIcon = SCRIPT_TYPE_ICONS[script.type] ?? FileCode;
                const summary = (
                  <>
                    <TypeIcon
                      size={14}
                      className="text-primary flex-shrink-0"
                      aria-hidden="true"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[var(--color-text)] truncate">
                          {script.name}
                        </span>
                        <span className="text-[10px] uppercase tracking-wide text-[var(--color-textMuted)]">
                          {script.type}
                        </span>
                        {script.risk === "destructive" && (
                          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-warning">
                            <AlertTriangle size={10} />
                            {t("bulkSsh.destructive", "Destructive")}
                          </span>
                        )}
                      </div>
                      {script.description && (
                        <div className="text-xs text-[var(--color-textSecondary)] truncate">
                          {script.description}
                        </div>
                      )}
                    </div>
                    <code className="text-xs text-[var(--color-textMuted)] font-mono truncate max-w-[200px] hidden sm:block">
                      {script.script.substring(0, 40)}
                      {script.script.length > 40 ? "..." : ""}
                    </code>
                  </>
                );
                return (
                  <div
                    key={script.id}
                    className="px-4 py-2 hover:bg-[var(--color-surfaceHover)] flex items-center gap-3 border-b border-[var(--color-border)]/30 group"
                  >
                    {showingTrash ? (
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        {summary}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => mgr.loadScript(script)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
                        aria-label={t(
                          "bulkSsh.loadScript",
                          `Load ${script.name}`,
                        )}
                      >
                        {summary}
                      </button>
                    )}
                    {showingTrash ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            void mgr.restoreScript(script.id);
                          }}
                          disabled={!mgr.scriptLibraryLoaded}
                          className="p-1 text-[var(--color-textSecondary)] hover:text-primary"
                          title={t("common.restore", "Restore")}
                        >
                          <RotateCcw size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void mgr.permanentlyDeleteScript(script.id);
                          }}
                          disabled={!mgr.scriptLibraryLoaded}
                          className="p-1 text-[var(--color-textSecondary)] hover:text-error"
                          title={t(
                            "bulkSsh.deletePermanently",
                            "Delete permanently",
                          )}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ) : (
                      !script.id.startsWith("default-") && (
                        <button
                          type="button"
                          onClick={() => {
                            void mgr.deleteScript(script.id);
                          }}
                          disabled={!mgr.scriptLibraryLoaded}
                          className="p-1 text-[var(--color-textSecondary)] hover:text-error opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                          title={t("bulkSsh.moveToTrash", "Move to trash")}
                        >
                          <Trash2 size={12} />
                        </button>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        {visibleScripts.length === 0 && (
          <EmptyState
            icon={showingTrash ? Trash2 : FileCode}
            iconSize={24}
            message={
              showingTrash
                ? t("bulkSsh.trashEmpty", "Script trash is empty")
                : t("bulkSsh.noScriptsFound", "No scripts found")
            }
            className="px-4 py-8"
          />
        )}
      </div>
    </div>
  );
}

export default ScriptLibraryPanel;
