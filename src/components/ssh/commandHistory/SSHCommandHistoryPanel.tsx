import React from "react";
import {
  History,
  Download,
  Upload,
  Trash2,
  BarChart3,
  Settings,
  X,
  List,
} from "lucide-react";
import type { HistoryPanelProps } from "./types";
import type { HistoryExportFormat } from "../../../types/ssh/sshCommandHistory";
import HistorySearchBar from "./HistorySearchBar";
import HistoryEntry from "./HistoryEntry";
import HistoryStats from "./HistoryStats";

type PanelTab = "list" | "stats" | "settings";

function SSHCommandHistoryPanel({
  mgr,
  t,
  onSelectCommand,
  onReExecute,
  compact,
}: HistoryPanelProps) {
  const [activeTab, setActiveTab] = React.useState<PanelTab>("list");
  const [showExport, setShowExport] = React.useState(false);
  const [exportFormat, setExportFormat] =
    React.useState<HistoryExportFormat>("json");
  const [exportIncludeOutput, setExportIncludeOutput] = React.useState(false);
  const [exportIncludeMetadata, setExportIncludeMetadata] =
    React.useState(true);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [importResult, setImportResult] = React.useState<string | null>(null);

  const handleCopy = React.useCallback(
    (command: string) => {
      navigator.clipboard.writeText(command).catch(() => {});
    },
    [],
  );

  const handleExport = React.useCallback(() => {
    const content = mgr.exportHistory({
      format: exportFormat,
      includeOutput: exportIncludeOutput,
      includeMetadata: exportIncludeMetadata,
      starredOnly: false,
    });

    const ext = exportFormat === "shell" ? "sh" : exportFormat;
    const mime =
      exportFormat === "json"
        ? "application/json"
        : exportFormat === "csv"
          ? "text/csv"
          : "text/plain";
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ssh-command-history.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExport(false);
  }, [mgr, exportFormat, exportIncludeOutput, exportIncludeMetadata]);

  const handleImport = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const result = mgr.importHistory(reader.result as string);
        setImportResult(
          `Imported ${result.imported}, skipped ${result.duplicatesSkipped} duplicates${
            result.errors.length > 0
              ? `, ${result.errors.length} errors`
              : ""
          }`,
        );
        setTimeout(() => setImportResult(null), 5000);
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [mgr],
  );

  return (
    <div
      className={`flex flex-col bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg overflow-hidden ${
        compact ? "max-h-80" : "h-full"
      }`}
      data-testid="ssh-command-history-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30">
        <div className="flex items-center gap-2">
          <History size={14} className="text-success" />
          <span className="text-sm font-medium text-[var(--color-text)]">
            {t("sshHistory.title", "Command History")}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)]">
            {mgr.entries.length}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Tab buttons */}
          <button
            onClick={() => setActiveTab("list")}
            className={`p-1 rounded transition-colors ${
              activeTab === "list"
                ? "text-success bg-success/10"
                : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            }`}
            title={t("sshHistory.listView", "List view")}
          >
            <List size={13} />
          </button>
          <button
            onClick={() => setActiveTab("stats")}
            className={`p-1 rounded transition-colors ${
              activeTab === "stats"
                ? "text-success bg-success/10"
                : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            }`}
            title={t("sshHistory.statistics", "Statistics")}
          >
            <BarChart3 size={13} />
          </button>
          {!compact && (
            <button
              onClick={() => setActiveTab("settings")}
              className={`p-1 rounded transition-colors ${
                activeTab === "settings"
                  ? "text-success bg-success/10"
                  : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              }`}
              title={t("sshHistory.settings", "Settings")}
            >
              <Settings size={13} />
            </button>
          )}
          <div className="w-px h-4 bg-[var(--color-border)] mx-0.5" />

          {/* Export */}
          <button
            onClick={() => setShowExport((prev) => !prev)}
            className="p-1 rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
            title={t("sshHistory.export", "Export")}
          >
            <Download size={13} />
          </button>

          {/* Import */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-1 rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
            title={t("sshHistory.import", "Import")}
          >
            <Upload size={13} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleImport}
            className="hidden"
          />

          {/* Clear */}
          <button
            onClick={() => mgr.clearHistory(true)}
            className="p-1 rounded text-[var(--color-textSecondary)] hover:text-error transition-colors"
            title={t(
              "sshHistory.clearHistory",
              "Clear history (keep starred)",
            )}
          >
            <Trash2 size={13} />
          </button>

          {/* Close */}
          <button
            onClick={mgr.closePanel}
            className="p-1 rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Import result notification */}
      {importResult && (
        <div className="px-3 py-1.5 text-xs bg-success/10 text-success dark:text-success border-b border-success/20">
          {importResult}
        </div>
      )}

      {/* Export popover */}
      {showExport && (
        <div className="px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={exportFormat}
              onChange={(e) =>
                setExportFormat(e.target.value as HistoryExportFormat)
              }
              className="text-xs px-2 py-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
            >
              <option value="json">JSON</option>
              <option value="shell">Shell Script</option>
              <option value="csv">CSV</option>
            </select>
            <label className="flex items-center gap-1 text-xs text-[var(--color-textSecondary)]">
              <input
                type="checkbox"
                checked={exportIncludeMetadata}
                onChange={(e) => setExportIncludeMetadata(e.target.checked)}
                className="rounded"
              />
              {t("sshHistory.includeMetadata", "Metadata")}
            </label>
            <label className="flex items-center gap-1 text-xs text-[var(--color-textSecondary)]">
              <input
                type="checkbox"
                checked={exportIncludeOutput}
                onChange={(e) => setExportIncludeOutput(e.target.checked)}
                className="rounded"
              />
              {t("sshHistory.includeOutput", "Output")}
            </label>
            <button
              onClick={handleExport}
              className="text-xs px-3 py-1 bg-success hover:bg-success/90 text-white rounded transition-colors"
            >
              {t("sshHistory.downloadExport", "Download")}
            </button>
          </div>
        </div>
      )}

      {/* Tab content */}
      {activeTab === "list" && (
        <>
          <HistorySearchBar mgr={mgr} t={t} />
          <div className="flex-1 overflow-y-auto">
            {mgr.entries.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
                <History
                  size={32}
                  className="text-[var(--color-textMuted)] mb-2"
                />
                <div className="text-sm text-[var(--color-textSecondary)]">
                  {mgr.filter.searchQuery
                    ? t(
                        "sshHistory.noResults",
                        "No commands matching your search",
                      )
                    : t(
                        "sshHistory.empty",
                        "No command history yet. Execute commands to build your history.",
                      )}
                </div>
              </div>
            ) : (
              mgr.entries.map((entry) => (
                <HistoryEntry
                  key={entry.id}
                  entry={entry}
                  isSelected={mgr.selectedEntryId === entry.id}
                  t={t}
                  onSelect={() => {
                    mgr.setSelectedEntryId(entry.id);
                    onSelectCommand?.(entry.command);
                  }}
                  onToggleStar={() => mgr.toggleStar(entry.id)}
                  onDelete={() => mgr.deleteEntry(entry.id)}
                  onCopy={() => handleCopy(entry.command)}
                  onReExecute={
                    onReExecute
                      ? () => onReExecute(entry.command)
                      : undefined
                  }
                  onUpdateNote={(note) => mgr.updateNote(entry.id, note)}
                  onUpdateTags={(tags) => mgr.updateTags(entry.id, tags)}
                  compact={compact}
                />
              ))
            )}
          </div>
        </>
      )}

      {activeTab === "stats" && <HistoryStats stats={mgr.stats} t={t} />}

      {activeTab === "settings" && !compact && (
        <div className="p-3 space-y-3 overflow-y-auto">
          <div className="text-xs font-medium text-[var(--color-textSecondary)] uppercase tracking-wider mb-2">
            {t("sshHistory.historySettings", "History Settings")}
          </div>

          {/* Max entries */}
          <label className="flex items-center justify-between">
            <span className="text-sm text-[var(--color-text)]">
              {t("sshHistory.maxEntries", "Max entries")}
            </span>
            <input
              type="number"
              value={mgr.config.maxEntries}
              onChange={(e) =>
                mgr.updateConfig({
                  maxEntries: Math.max(10, parseInt(e.target.value) || 100),
                })
              }
              className="w-24 text-sm text-right px-2 py-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
              min={10}
              max={10000}
            />
          </label>

          {/* Retention days */}
          <label className="flex items-center justify-between">
            <span className="text-sm text-[var(--color-text)]">
              {t("sshHistory.retentionDays", "Retention (days, 0=forever)")}
            </span>
            <input
              type="number"
              value={mgr.config.retentionDays}
              onChange={(e) =>
                mgr.updateConfig({
                  retentionDays: Math.max(
                    0,
                    parseInt(e.target.value) || 0,
                  ),
                })
              }
              className="w-24 text-sm text-right px-2 py-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
              min={0}
              max={3650}
            />
          </label>

          {/* Track output */}
          <label className="flex items-center justify-between">
            <span className="text-sm text-[var(--color-text)]">
              {t("sshHistory.trackOutput", "Store command output")}
            </span>
            <input
              type="checkbox"
              checked={mgr.config.trackOutput}
              onChange={(e) =>
                mgr.updateConfig({ trackOutput: e.target.checked })
              }
              className="rounded"
            />
          </label>

          {/* Max output size */}
          {mgr.config.trackOutput && (
            <label className="flex items-center justify-between">
              <span className="text-sm text-[var(--color-text)]">
                {t("sshHistory.maxOutputSize", "Max output size (bytes)")}
              </span>
              <input
                type="number"
                value={mgr.config.maxOutputSize}
                onChange={(e) =>
                  mgr.updateConfig({
                    maxOutputSize: Math.max(
                      256,
                      parseInt(e.target.value) || 4096,
                    ),
                  })
                }
                className="w-24 text-sm text-right px-2 py-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
                min={256}
                max={65536}
              />
            </label>
          )}

          {/* Auto-categorize */}
          <label className="flex items-center justify-between">
            <span className="text-sm text-[var(--color-text)]">
              {t("sshHistory.autoCategorize", "Auto-categorize commands")}
            </span>
            <input
              type="checkbox"
              checked={mgr.config.autoCategorize}
              onChange={(e) =>
                mgr.updateConfig({ autoCategorize: e.target.checked })
              }
              className="rounded"
            />
          </label>

          {/* Dedup consecutive */}
          <label className="flex items-center justify-between">
            <span className="text-sm text-[var(--color-text)]">
              {t(
                "sshHistory.deduplicateConsecutive",
                "Merge repeated commands",
              )}
            </span>
            <input
              type="checkbox"
              checked={mgr.config.deduplicateConsecutive}
              onChange={(e) =>
                mgr.updateConfig({
                  deduplicateConsecutive: e.target.checked,
                })
              }
              className="rounded"
            />
          </label>

          {/* Persist */}
          <label className="flex items-center justify-between">
            <span className="text-sm text-[var(--color-text)]">
              {t("sshHistory.persistHistory", "Persist across restarts")}
            </span>
            <input
              type="checkbox"
              checked={mgr.config.persistEnabled}
              onChange={(e) =>
                mgr.updateConfig({ persistEnabled: e.target.checked })
              }
              className="rounded"
            />
          </label>

          {/* Danger zone */}
          <div className="pt-3 border-t border-[var(--color-border)]">
            <button
              onClick={() => mgr.clearHistory(false)}
              className="text-xs px-3 py-1.5 bg-error hover:bg-error/90 text-white rounded transition-colors"
            >
              {t("sshHistory.deleteAll", "Delete All History")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default SSHCommandHistoryPanel;
