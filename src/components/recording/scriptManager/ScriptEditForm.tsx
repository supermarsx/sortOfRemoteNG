import {
  ScriptLanguage,
  OS_TAG_LABELS,
  OSTag,
  OS_TAG_ICONS,
  languageLabels,
} from "./shared";
import ScriptCodeEditor from "../../ui/editor/ScriptCodeEditor";
import { useTranslation } from "react-i18next";
import { detectLanguage } from "../../../utils/recording/scriptSyntax";
import type { ScriptManagerMgr } from "../../../hooks/recording/useScriptManager";
import { Select } from "../../ui/forms";

function ScriptEditForm({ mgr }: { mgr: ScriptManagerMgr }) {
  const { t } = useTranslation();
  const detected =
    mgr.editLanguage === "auto"
      ? detectLanguage(mgr.editScript)
      : mgr.editLanguage;
  const editorLanguage = detected === "auto" ? "bash" : detected;
  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="space-y-4 max-w-3xl">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
            {t("scriptManager.name", "Script Name")} *
          </label>
          <input
            type="text"
            value={mgr.editName}
            onChange={(e) => mgr.setEditName(e.target.value)}
            placeholder={t(
              "scriptManager.namePlaceholder",
              "Enter script name",
            )}
            className="w-full px-3 py-2 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Language + Category */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
              {t("scriptManager.language", "Language")}
            </label>
            <Select
              value={mgr.editLanguage}
              onChange={(v: string) => mgr.setEditLanguage(v as ScriptLanguage)}
              options={[
                { value: "auto", label: "🔍 Auto Detect" },
                { value: "bash", label: "🐚 Bash" },
                { value: "sh", label: "📜 Shell (sh)" },
                { value: "powershell", label: "⚡ PowerShell" },
                { value: "batch", label: "🪟 Batch (cmd)" },
              ]}
              className="w-full px-3 py-2  bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
              {t("scriptManager.category", "Category")}
            </label>
            <input
              type="text"
              value={mgr.editCategory}
              onChange={(e) => mgr.setEditCategory(e.target.value)}
              placeholder="Custom"
              list="script-categories"
              className="w-full px-3 py-2 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <datalist id="script-categories">
              {mgr.categories.map((cat) => (
                <option key={cat} value={cat} />
              ))}
            </datalist>
          </div>
        </div>

        {/* OS Tags */}
        <div>
          <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
            {t("scriptManager.osTags", "Platform Tags")}
          </label>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(OS_TAG_LABELS) as OSTag[]).map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => mgr.toggleOsTag(tag)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-full border transition-colors ${
                  mgr.editOsTags.includes(tag)
                    ? "bg-primary/20 border-accent/50 text-primary dark:text-primary"
                    : "bg-[var(--color-surfaceHover)] border-[var(--color-border)] text-[var(--color-textSecondary)] hover:bg-[var(--color-surface)]"
                }`}
              >
                <span>{OS_TAG_ICONS[tag]}</span>
                <span>{OS_TAG_LABELS[tag]}</span>
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-[var(--color-textMuted)]">
            {t(
              "scriptManager.osTagsHint",
              "Select the platforms this script is compatible with",
            )}
          </p>
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
            {t("scriptManager.description", "Description")}
          </label>
          <input
            type="text"
            value={mgr.editDescription}
            onChange={(e) => mgr.setEditDescription(e.target.value)}
            placeholder={t(
              "scriptManager.descriptionPlaceholder",
              "Brief description of what this script does",
            )}
            className="w-full px-3 py-2 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Lazily loaded editable code surface; no script execution here. */}
        <div>
          <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
            {t("scriptManager.script", "Script")} *
          </label>
          <ScriptCodeEditor
            code={mgr.editScript}
            language={editorLanguage}
            onChange={mgr.setEditScript}
            documentKey={mgr.selectedScript?.id ?? "new-terminal-script"}
            ariaLabel="Script code"
            minHeight={320}
          />
          {mgr.editScript && mgr.editLanguage === "auto" && (
            <p className="mt-1.5 text-xs text-[var(--color-textSecondary)]">
              {t("scriptManager.detectedLanguage", "Detected language")}:{" "}
              {languageLabels[detectLanguage(mgr.editScript)]}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default ScriptEditForm;
