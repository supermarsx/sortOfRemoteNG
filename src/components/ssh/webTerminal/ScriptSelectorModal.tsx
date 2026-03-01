import { OS_TAG_ICONS, OS_TAG_LABELS } from "../../recording/scriptManager/shared";
import type { OSTag } from "../../recording/scriptManager/shared";
import { WebTerminalMgr } from "./types";
import Modal from "../../ui/overlays/Modal";
import DialogHeader from "../../ui/overlays/DialogHeader";
import { FileCode, Filter, Play, Search } from "lucide-react";
import { Select } from "../../ui/forms";

function ScriptSelectorModal({ mgr }: { mgr: WebTerminalMgr }) {
  if (!mgr.showScriptSelector) return null;
  return (
    <Modal
      isOpen={mgr.showScriptSelector}
      onClose={mgr.closeScriptSelector}
      backdropClassName="bg-black/50"
      panelClassName="max-w-[500px] mx-4"
      dataTestId="web-terminal-script-selector-modal"
    >
      <div className="bg-[var(--color-surface)] rounded-xl shadow-2xl w-full max-h-[70vh] flex flex-col border border-[var(--color-border)]">
        <DialogHeader
          icon={FileCode}
          iconColor="text-green-500"
          variant="compact"
          title="Run Script"
          onClose={mgr.closeScriptSelector}
        />

        {/* Search */}
        <div className="px-4 py-2 border-b border-[var(--color-border)]">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-textMuted)]"
            />
            <input
              type="text"
              value={mgr.scriptSearchQuery}
              onChange={(e) => mgr.setScriptSearchQuery(e.target.value)}
              placeholder="Search scripts..."
              className="sor-search-input"
              autoFocus
            />
          </div>
        </div>

        {/* Compact Filters Bar */}
        <div className="px-4 py-2 border-b border-[var(--color-border)] flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-[var(--color-textMuted)]">
            <Filter size={12} />
            <span className="text-xs font-medium">Filters:</span>
          </div>
          <Select value={mgr.scriptCategoryFilter} onChange={(v: string) => mgr.setScriptCategoryFilter(v)} options={[{ value: 'all', label: 'All Categories' }, ...mgr.uniqueCategories.map((cat) => ({ value: cat, label: cat }))]} className="text-xs px-2 py-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-green-500/50 cursor-pointer" />
          <Select value={mgr.scriptLanguageFilter} onChange={(v: string) => mgr.setScriptLanguageFilter(v)} options={[{ value: 'all', label: 'All Languages' }, ...mgr.uniqueLanguages.map((lang) => ({ value: lang, label: lang }))]} className="text-xs px-2 py-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-green-500/50 cursor-pointer" />
          <Select value={mgr.scriptOsTagFilter} onChange={(v: string) => mgr.setScriptOsTagFilter(v)} options={[{ value: 'all', label: 'All Platforms' }, ...mgr.uniqueOsTags.map((tag) => ({ value: tag, label: `${OS_TAG_ICONS[tag as OSTag]} ${OS_TAG_LABELS[tag as OSTag]}` }))]} className="text-xs px-2 py-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-green-500/50 cursor-pointer" />
          {(mgr.scriptCategoryFilter !== "all" ||
            mgr.scriptLanguageFilter !== "all" ||
            mgr.scriptOsTagFilter !== "all") && (
            <button
              onClick={() => {
                mgr.setScriptCategoryFilter("all");
                mgr.setScriptLanguageFilter("all");
                mgr.setScriptOsTagFilter("all");
              }}
              className="text-xs text-[var(--color-textMuted)] hover:text-[var(--color-text)] transition-colors ml-auto"
            >
              Clear
            </button>
          )}
        </div>

        {/* Script List */}
        <div className="flex-1 overflow-auto p-2">
          {Object.keys(mgr.scriptsByCategory).length === 0 ? (
            <div className="text-center py-8 text-[var(--color-textMuted)]">
              <FileCode size={32} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">No scripts found</p>
              <p className="text-xs mt-1">Add scripts in the Script Manager</p>
            </div>
          ) : (
            Object.entries(mgr.scriptsByCategory).map(([category, categoryScripts]) => (
              <div key={category} className="mb-3">
                <div className="text-xs font-semibold text-[var(--color-textMuted)] uppercase tracking-wider px-2 py-1">
                  {category}
                </div>
                <div className="space-y-1">
                  {categoryScripts.map((script) => (
                    <button
                      key={script.id}
                      onClick={() => mgr.runScript(script)}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--color-surfaceHover)] transition-colors group"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-[var(--color-text)] truncate">
                              {script.name}
                            </span>
                            {script.osTags && script.osTags.length > 0 && (
                              <div className="flex items-center gap-0.5 flex-shrink-0">
                                {script.osTags.slice(0, 2).map((tag) => (
                                  <span
                                    key={tag}
                                    className="text-[10px]"
                                    title={OS_TAG_LABELS[tag]}
                                  >
                                    {OS_TAG_ICONS[tag]}
                                  </span>
                                ))}
                                {script.osTags.length > 2 && (
                                  <span className="text-[10px] text-[var(--color-textMuted)]">
                                    +{script.osTags.length - 2}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          {script.description && (
                            <div className="text-xs text-[var(--color-textMuted)] truncate">
                              {script.description}
                            </div>
                          )}
                        </div>
                        <Play
                          size={14}
                          className="text-green-500 opacity-0 group-hover:opacity-100 transition-opacity ml-2 flex-shrink-0"
                        />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}

export default ScriptSelectorModal;
