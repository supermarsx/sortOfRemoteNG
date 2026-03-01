import { ManagedScript, languageIcons, languageLabels, OS_TAG_LABELS, OS_TAG_ICONS } from "./shared";
import ScriptList from "./ScriptList";
import type { ScriptManagerMgr } from "../../../hooks/recording/useScriptManager";

function ScriptListItem({ script, mgr }: { script: ManagedScript; mgr: ScriptManagerMgr }) {
  return (
    <div
      onClick={() => mgr.handleSelectScript(script)}
      className={`p-3 rounded-lg cursor-pointer transition-colors group ${
        mgr.selectedScript?.id === script.id
          ? 'bg-purple-500/20 border border-purple-500/40'
          : 'hover:bg-[var(--color-surfaceHover)] border border-transparent'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="text-lg flex-shrink-0">{languageIcons[script.language]}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium text-[var(--color-text)] truncate">
              {script.name}
            </span>
            {script.id.startsWith('default-') && (
              <span className="text-[10px] px-1.5 py-0.5 bg-[var(--color-secondary)]/20 text-[var(--color-textSecondary)] rounded uppercase tracking-wide flex-shrink-0">
                Default
              </span>
            )}
          </div>
          {script.description && (
            <p className="text-xs text-[var(--color-textSecondary)] truncate mt-0.5">
              {script.description}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-[10px] px-1.5 py-0.5 bg-[var(--color-surfaceHover)] text-[var(--color-textMuted)] rounded">
              {script.category}
            </span>
            <span className="text-[10px] text-[var(--color-textMuted)]">
              {languageLabels[script.language]}
            </span>
            {script.osTags && script.osTags.length > 0 && (
              <div className="flex items-center gap-0.5">
                {script.osTags.slice(0, 3).map(tag => (
                  <span key={tag} className="text-[10px]" title={OS_TAG_LABELS[tag]}>
                    {OS_TAG_ICONS[tag]}
                  </span>
                ))}
                {script.osTags.length > 3 && (
                  <span className="text-[10px] text-[var(--color-textMuted)]">+{script.osTags.length - 3}</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ScriptListItem;
