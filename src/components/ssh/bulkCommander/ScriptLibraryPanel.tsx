import { Mgr, TFunc } from "./types";
import EmptyState from "../../ui/display/EmptyState";
import { FileCode, Save, Search, Trash2 } from "lucide-react";
import { Select } from "../../ui/forms";

function ScriptLibraryPanel({ mgr, t }: { mgr: Mgr; t: TFunc }) {
  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] max-h-72 overflow-hidden flex flex-col">
      <div className="px-4 py-2 border-b border-[var(--color-border)] flex items-center gap-3 bg-[var(--color-surfaceHover)]/30">
        <input
          type="text"
          value={mgr.scriptFilter}
          onChange={(e) => mgr.setScriptFilter(e.target.value)}
          placeholder={t("bulkSsh.searchScripts", "Search scripts...")}
          className="sor-form-input-sm flex-1 placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-green-500"
        />
        {mgr.command.trim() && (
          <button
            onClick={() =>
              mgr.setEditingScript({
                id: "",
                name: "",
                description: "",
                script: mgr.command,
                category: "Custom",
                createdAt: "",
                updatedAt: "",
              })
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-[var(--color-text)] rounded-md transition-colors"
          >
            <Save size={14} />
            {t("bulkSsh.saveAsScript", "Save Current")}
          </button>
        )}
      </div>

      {mgr.editingScript && (
        <div className="px-4 py-3 border-b border-[var(--color-border)] bg-green-500/5 space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={mgr.newScriptName}
              onChange={(e) => mgr.setNewScriptName(e.target.value)}
              placeholder={t("bulkSsh.scriptName", "Script name")}
              className="sor-form-input-sm flex-1 placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-green-500"
            />
            <Select value={mgr.newScriptCategory} onChange={(v: string) => mgr.setNewScriptCategory(v)} options={[...mgr.categories.map((cat) => ({ value: cat, label: cat })), { value: 'Custom', label: 'Custom' }]} className="px-3 py-1.5 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-green-500" />
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={mgr.newScriptDescription}
              onChange={(e) => mgr.setNewScriptDescription(e.target.value)}
              placeholder={t(
                "bulkSsh.scriptDescription",
                "Description (optional)",
              )}
              className="sor-form-input-sm flex-1 placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-green-500"
            />
            <button
              onClick={mgr.saveCurrentAsScript}
              disabled={!mgr.newScriptName.trim()}
              className="px-4 py-1.5 text-sm bg-green-600 hover:bg-green-700 disabled:bg-[var(--color-surfaceHover)] disabled:opacity-50 text-[var(--color-text)] rounded-md transition-colors"
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
        {mgr.categories.map((category) => {
          const categoryScripts = mgr.filteredScripts.filter(
            (s) => s.category === category,
          );
          if (categoryScripts.length === 0) return null;
          return (
            <div key={category}>
              <div className="px-4 py-1.5 text-xs font-medium text-[var(--color-textSecondary)] bg-[var(--color-surfaceHover)]/50 uppercase tracking-wide">
                {category}
              </div>
              {categoryScripts.map((script) => (
                <div
                  key={script.id}
                  className="px-4 py-2 hover:bg-[var(--color-surfaceHover)] flex items-center gap-3 border-b border-[var(--color-border)]/30 cursor-pointer group"
                  onClick={() => mgr.loadScript(script)}
                >
                  <FileCode
                    size={14}
                    className="text-green-600 dark:text-green-500 flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[var(--color-text)] truncate">
                      {script.name}
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
                  {!script.id.startsWith("default-") && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        mgr.deleteScript(script.id);
                      }}
                      className="p-1 text-[var(--color-textSecondary)] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      title={t("common.delete", "Delete")}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          );
        })}
        {mgr.filteredScripts.length === 0 && (
          <EmptyState
            icon={FileCode}
            iconSize={24}
            message={t("bulkSsh.noScriptsFound", "No scripts found")}
            className="px-4 py-8"
          />
        )}
      </div>
    </div>
  );
}

export default ScriptLibraryPanel;
