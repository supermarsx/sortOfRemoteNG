import { ScriptLanguage, languageLabels } from "./shared";
import PlatformTagPicker from "./PlatformTagPicker";
import { scriptLanguageIcon } from "./scriptMetadataIcons";
import ScriptCodeEditor from "../../ui/editor/ScriptCodeEditor";
import { useTranslation } from "react-i18next";
import { detectLanguage } from "../../../utils/recording/scriptSyntax";
import type { ScriptManagerMgr } from "../../../hooks/recording/useScriptManager";
import { Select } from "../../ui/forms";
import { useId } from "react";

function ScriptEditForm({ mgr }: { mgr: ScriptManagerMgr }) {
  const { t } = useTranslation();
  const categoryId = useId();
  const categorySuggestions = mgr.categories
    .filter(
      (category) =>
        category !== mgr.editCategory &&
        category.toLowerCase().includes(mgr.editCategory.trim().toLowerCase()),
    )
    .slice(0, 6);
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
              label={t("scriptManager.language", "Language")}
              value={mgr.editLanguage}
              onChange={(v: string) => mgr.setEditLanguage(v as ScriptLanguage)}
              options={[
                ...Object.entries(languageLabels).map(([value, label]) => ({
                  value,
                  label,
                  icon: scriptLanguageIcon(value),
                })),
              ]}
              className="w-full px-3 py-2  bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label
              htmlFor={categoryId}
              className="block text-sm font-medium text-[var(--color-text)] mb-1.5"
            >
              {t("scriptManager.category", "Category")}
            </label>
            <input
              id={categoryId}
              type="text"
              value={mgr.editCategory}
              onChange={(e) => mgr.setEditCategory(e.target.value)}
              placeholder="Custom"
              aria-describedby={`${categoryId}-help`}
              className="w-full px-3 py-2 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p
              id={`${categoryId}-help`}
              className="mt-1 text-xs text-[var(--color-textMuted)]"
            >
              Enter any category, or choose a suggestion.
            </p>
            {categorySuggestions.length > 0 && (
              <div
                className="mt-2 flex flex-wrap gap-1.5"
                role="group"
                aria-label="Category suggestions"
              >
                {categorySuggestions.map((category) => (
                  <button
                    key={category}
                    type="button"
                    className="sor-btn-secondary-sm"
                    onClick={() => mgr.setEditCategory(category)}
                  >
                    {category}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* OS Tags */}
        <div>
          <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">
            {t("scriptManager.osTags", "Platform Tags")}
          </label>
          <PlatformTagPicker
            value={mgr.editOsTags}
            onToggle={mgr.toggleOsTag}
          />
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
