import { languageIcons, languageLabels, OS_TAG_ICONS, OS_TAG_LABELS } from "./shared";
import HighlightedCode from "../../ui/display/HighlightedCode";
import { useTranslation } from "react-i18next";
import type { ScriptManagerMgr } from "../../../hooks/recording/useScriptManager";
import { Check, Clipboard, Copy, CopyPlus, Edit, Edit2, Trash2 } from "lucide-react";

function ScriptDetailView({ mgr }: { mgr: ScriptManagerMgr }) {
  const { t } = useTranslation();
  const script = mgr.selectedScript!;
  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="max-w-3xl">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">{languageIcons[script.language]}</span>
              <h3 className="text-xl font-semibold text-[var(--color-text)]">
                {script.name}
              </h3>
            </div>
            {script.description && (
              <p className="text-sm text-[var(--color-textSecondary)] mt-1">
                {script.description}
              </p>
            )}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="text-xs px-2 py-1 bg-[var(--color-surfaceHover)] text-[var(--color-textMuted)] rounded">
                {script.category}
              </span>
              <span className="text-xs px-2 py-1 bg-purple-500/20 text-purple-600 dark:text-purple-400 rounded">
                {languageLabels[script.language]}
              </span>
              {script.id.startsWith('default-') && (
                <span className="text-xs px-2 py-1 bg-[var(--color-secondary)]/20 text-[var(--color-textSecondary)] rounded">
                  Default
                </span>
              )}
            </div>
            {script.osTags && script.osTags.length > 0 && (
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {script.osTags.map(tag => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-full"
                  >
                    <span>{OS_TAG_ICONS[tag]}</span>
                    <span>{OS_TAG_LABELS[tag]}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => mgr.handleCopyScript(script)}
              className="sor-icon-btn"
              title={t('scriptManager.copyToClipboard', 'Copy to Clipboard')}
            >
              {mgr.copiedId === script.id ? (
                <Check size={16} className="text-green-500" />
              ) : (
                <Copy size={16} />
              )}
            </button>
            <button
              onClick={() => mgr.handleDuplicateScript(script)}
              className="sor-icon-btn"
              title={t('scriptManager.duplicate', 'Duplicate Script')}
            >
              <CopyPlus size={16} />
            </button>
            <button
              onClick={() => mgr.handleEditScript(script)}
              className="sor-icon-btn"
              title={t('common.edit', 'Edit')}
            >
              <Edit2 size={16} />
            </button>
            <button
              onClick={() => mgr.handleDeleteScript(script.id)}
              className="sor-icon-btn-danger"
              title={t('common.delete', 'Delete')}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>

        <div className="p-4 bg-[var(--color-background)] border border-[var(--color-border)] rounded-lg overflow-x-auto">
          <HighlightedCode code={script.script} language={script.language} />
        </div>

        <div className="mt-4 text-xs text-[var(--color-textMuted)]">
          {t('scriptManager.lastUpdated', 'Last updated')}: {new Date(script.updatedAt).toLocaleString()}
        </div>
      </div>
    </div>
  );
}

export default ScriptDetailView;
