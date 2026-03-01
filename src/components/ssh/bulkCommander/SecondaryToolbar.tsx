import { Mgr, TFunc } from "./types";

function SecondaryToolbar({ mgr, t }: { mgr: Mgr; t: TFunc }) {
  return (
    <div className="border-b border-[var(--color-border)] px-5 py-2 flex items-center justify-between bg-[var(--color-surfaceHover)]/30">
      <div className="flex items-center gap-2">
        <div className="flex items-center bg-[var(--color-surfaceHover)] rounded-lg p-0.5">
          <button
            onClick={() => mgr.setViewMode("tabs")}
            className={`p-1.5 rounded transition-colors ${
              mgr.viewMode === "tabs"
                ? "bg-green-600 text-[var(--color-text)]"
                : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]"
            }`}
            title={t("bulkSsh.tabView", "Tab View")}
          >
            <Rows size={14} />
          </button>
          <button
            onClick={() => mgr.setViewMode("mosaic")}
            className={`p-1.5 rounded transition-colors ${
              mgr.viewMode === "mosaic"
                ? "bg-green-600 text-[var(--color-text)]"
                : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]"
            }`}
            title={t("bulkSsh.mosaicView", "Mosaic View")}
          >
            <Grid3x3 size={14} />
          </button>
        </div>
        <div className="w-px h-5 bg-[var(--color-border)] mx-1" />
        <button
          onClick={mgr.toggleScriptLibrary}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-md transition-colors ${
            mgr.showScriptLibrary
              ? "bg-green-500/20 text-green-700 dark:text-green-400"
              : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]"
          }`}
        >
          <FileCode size={14} />
          {t("bulkSsh.scripts", "Scripts")}
        </button>
        <button
          onClick={mgr.toggleHistory}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-md transition-colors ${
            mgr.showHistory
              ? "bg-green-500/20 text-green-700 dark:text-green-400"
              : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]"
          }`}
        >
          <History size={14} />
          {t("bulkSsh.history", "History")}
        </button>
        <div className="w-px h-5 bg-[var(--color-border)] mx-1" />
        <button
          onClick={mgr.clearOutputs}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)] rounded-md transition-colors"
        >
          <Trash2 size={14} />
          {t("bulkSsh.clearOutputs", "Clear")}
        </button>
      </div>
      <div className="text-xs text-[var(--color-textSecondary)]">
        {t("bulkSsh.hint", "Ctrl+Enter to execute")}
      </div>
    </div>
  );
}

export default SecondaryToolbar;
