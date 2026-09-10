import { ScriptLanguage, OSTag, OS_TAG_LABELS, languageLabels } from "./shared";
import { platformIcon, scriptLanguageIcon } from "./scriptMetadataIcons";
import { useTranslation } from "react-i18next";
import type { ScriptManagerMgr } from "../../../hooks/recording/useScriptManager";
import { Plus, Search } from "lucide-react";
import { Select } from "../../ui/forms";

function FilterToolbar({ mgr }: { mgr: ScriptManagerMgr }) {
  const { t } = useTranslation();
  return (
    <div className="border-b border-[var(--color-border)] px-5 py-3 flex flex-wrap items-center gap-2 bg-[var(--color-surfaceHover)]/30">
      {/* Search */}
      <div className="flex-1 min-w-48 relative">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-textSecondary)]"
        />
        <input
          type="text"
          value={mgr.searchFilter}
          onChange={(e) => mgr.setSearchFilter(e.target.value)}
          placeholder={t(
            "scriptManager.searchPlaceholder",
            "Search scripts...",
          )}
          className="w-full pl-9 pr-3 py-2 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Category filter */}
      <div className="relative">
        <Select
          label="Script category"
          value={mgr.categoryFilter}
          onChange={(v: string) => mgr.setCategoryFilter(v)}
          options={[
            {
              value: "",
              label: t("scriptManager.allCategories", "All Categories"),
            },
            ...mgr.categories.map((cat) => ({ value: cat, label: cat })),
          ]}
          className="appearance-none pl-3 pr-8 py-2 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
        />
      </div>

      {/* Language filter */}
      <div className="relative">
        <Select
          label="Script language"
          value={mgr.languageFilter}
          onChange={(v: string) =>
            mgr.setLanguageFilter(v as ScriptLanguage | "")
          }
          options={[
            {
              value: "",
              label: t("scriptManager.allLanguages", "All Languages"),
            },
            ...Object.entries(languageLabels).map(([value, label]) => ({
              value,
              label,
              icon: scriptLanguageIcon(value),
            })),
          ]}
          className="appearance-none pl-3 pr-8 py-2  bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
        />
      </div>

      {/* OS Tag filter */}
      <div className="relative">
        <Select
          label="Script platform"
          searchable
          searchPlaceholder="Search platforms…"
          value={mgr.osTagFilter}
          onChange={(v: string) => mgr.setOsTagFilter(v as OSTag | "")}
          options={[
            {
              value: "",
              label: t("scriptManager.allPlatforms", "All Platforms"),
            },
            ...Object.entries(OS_TAG_LABELS).map(([value, label]) => ({
              value,
              label,
              icon: platformIcon(value as OSTag),
            })),
          ]}
          className="appearance-none pl-3 pr-8 py-2  bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
        />
      </div>

      {/* New script button */}
      <button
        disabled={!mgr.ready || mgr.busy}
        onClick={mgr.handleNewScript}
        className="sor-btn sor-btn-primary"
      >
        <Plus size={14} />
        {t("scriptManager.newScript", "New Script")}
      </button>
    </div>
  );
}

export default FilterToolbar;
