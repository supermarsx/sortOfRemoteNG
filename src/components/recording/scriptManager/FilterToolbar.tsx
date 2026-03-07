import { ScriptLanguage, OSTag } from "./shared";
import { useTranslation } from "react-i18next";
import type { ScriptManagerMgr } from "../../../hooks/recording/useScriptManager";
import { ChevronDown, Plus, Search } from "lucide-react";
import { Select } from "../../ui/forms";

function FilterToolbar({ mgr }: { mgr: ScriptManagerMgr }) {
  const { t } = useTranslation();
  return (
    <div className="border-b border-[var(--color-border)] px-5 py-3 flex items-center gap-4 bg-[var(--color-surfaceHover)]/30">
      {/* Search */}
      <div className="flex-1 relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-textSecondary)]" />
        <input
          type="text"
          value={mgr.searchFilter}
          onChange={(e) => mgr.setSearchFilter(e.target.value)}
          placeholder={t('scriptManager.searchPlaceholder', 'Search scripts...')}
          className="w-full pl-9 pr-3 py-2 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {/* Category filter */}
      <div className="relative">
        <Select value={mgr.categoryFilter} onChange={(v: string) => mgr.setCategoryFilter(v)} options={[{ value: '', label: t('scriptManager.allCategories', 'All Categories') }, ...mgr.categories.map((cat) => ({ value: cat, label: cat }))]} className="appearance-none pl-3 pr-8 py-2 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer" />
        <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-textSecondary)] pointer-events-none" />
      </div>

      {/* Language filter */}
      <div className="relative">
        <Select value={mgr.languageFilter} onChange={(v: string) => mgr.setLanguageFilter(v as ScriptLanguage | '')} options={[{ value: "", label: t('scriptManager.allLanguages', 'All Languages') }, { value: "bash", label: "Bash" }, { value: "sh", label: "Shell (sh)" }, { value: "powershell", label: "PowerShell" }, { value: "batch", label: "Batch (cmd)" }]} className="appearance-none pl-3 pr-8 py-2  bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer" />
        <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-textSecondary)] pointer-events-none" />
      </div>

      {/* OS Tag filter */}
      <div className="relative">
        <Select value={mgr.osTagFilter} onChange={(v: string) => mgr.setOsTagFilter(v as OSTag | '')} options={[{ value: "", label: t('scriptManager.allPlatforms', 'All Platforms') }, { value: "windows", label: "🪟 Windows" }, { value: "linux", label: "🐧 Linux" }, { value: "macos", label: "🍎 macOS" }, { value: "agnostic", label: "🌐 Agnostic" }, { value: "multiplatform", label: "🔀 Multi-Platform" }, { value: "cisco-ios", label: "🔌 Cisco IOS" }]} className="appearance-none pl-3 pr-8 py-2  bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer" />
        <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-textSecondary)] pointer-events-none" />
      </div>

      {/* New script button */}
      <button
        onClick={mgr.handleNewScript}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-accent hover:bg-accent/90 text-[var(--color-text)] rounded-lg transition-colors"
      >
        <Plus size={14} />
        {t('scriptManager.newScript', 'New Script')}
      </button>
    </div>
  );
}

export default FilterToolbar;
