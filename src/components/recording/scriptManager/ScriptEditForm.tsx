import { ScriptLanguage, OS_TAG_LABELS, OSTag, OS_TAG_ICONS, languageLabels } from "./shared";

function ScriptEditForm({ mgr }: { mgr: ScriptManagerMgr }) {
  const { t } = useTranslation();
  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="space-y-4 max-w-3xl">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
            {t('scriptManager.name', 'Script Name')} *
          </label>
          <input
            type="text"
            value={mgr.editName}
            onChange={(e) => mgr.setEditName(e.target.value)}
            placeholder={t('scriptManager.namePlaceholder', 'Enter script name')}
            className="w-full px-3 py-2 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
        </div>

        {/* Language + Category */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
              {t('scriptManager.language', 'Language')}
            </label>
            <Select value={mgr.editLanguage} onChange={(v: string) => mgr.setEditLanguage(v as ScriptLanguage)} options={[{ value: "auto", label: "🔍 Auto Detect" }, { value: "bash", label: "🐚 Bash" }, { value: "sh", label: "📜 Shell (sh)" }, { value: "powershell", label: "⚡ PowerShell" }, { value: "batch", label: "🪟 Batch (cmd)" }]} className="w-full px-3 py-2  bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-purple-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
              {t('scriptManager.category', 'Category')}
            </label>
            <input
              type="text"
              value={mgr.editCategory}
              onChange={(e) => mgr.setEditCategory(e.target.value)}
              placeholder="Custom"
              list="script-categories"
              className="w-full px-3 py-2 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
            <datalist id="script-categories">
              {mgr.categories.map(cat => (
                <option key={cat} value={cat} />
              ))}
            </datalist>
          </div>
        </div>

        {/* OS Tags */}
        <div>
          <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
            {t('scriptManager.osTags', 'Platform Tags')}
          </label>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(OS_TAG_LABELS) as OSTag[]).map(tag => (
              <button
                key={tag}
                type="button"
                onClick={() => mgr.toggleOsTag(tag)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-full border transition-colors ${
                  mgr.editOsTags.includes(tag)
                    ? 'bg-purple-500/20 border-purple-500/50 text-purple-600 dark:text-purple-400'
                    : 'bg-[var(--color-surfaceHover)] border-[var(--color-border)] text-[var(--color-textSecondary)] hover:bg-[var(--color-surface)]'
                }`}
              >
                <span>{OS_TAG_ICONS[tag]}</span>
                <span>{OS_TAG_LABELS[tag]}</span>
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-[var(--color-textMuted)]">
            {t('scriptManager.osTagsHint', 'Select the platforms this script is compatible with')}
          </p>
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
            {t('scriptManager.description', 'Description')}
          </label>
          <input
            type="text"
            value={mgr.editDescription}
            onChange={(e) => mgr.setEditDescription(e.target.value)}
            placeholder={t('scriptManager.descriptionPlaceholder', 'Brief description of what this script does')}
            className="w-full px-3 py-2 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
        </div>

        {/* Script textarea */}
        <div>
          <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
            {t('scriptManager.script', 'Script')} *
          </label>
          <div className="relative">
            <textarea
              value={mgr.editScript}
              onChange={(e) => mgr.setEditScript(e.target.value)}
              placeholder={t('scriptManager.scriptPlaceholder', 'Enter your script here...')}
              className="w-full h-64 px-4 py-3 text-sm bg-[var(--color-background)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-purple-500 font-mono resize-y"
              spellCheck={false}
            />
          </div>
          {mgr.editScript && mgr.editLanguage === 'auto' && (
            <p className="mt-1.5 text-xs text-[var(--color-textSecondary)]">
              {t('scriptManager.detectedLanguage', 'Detected language')}: {languageLabels[detectLanguage(mgr.editScript)]}
            </p>
          )}
        </div>

        {/* Syntax Preview */}
        {mgr.editScript && (
          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
              {t('scriptManager.preview', 'Syntax Preview')}
            </label>
            <div className="p-4 bg-[var(--color-background)] border border-[var(--color-border)] rounded-lg overflow-x-auto max-h-48 overflow-y-auto">
              <HighlightedCode code={mgr.editScript} language={mgr.editLanguage} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ScriptEditForm;
