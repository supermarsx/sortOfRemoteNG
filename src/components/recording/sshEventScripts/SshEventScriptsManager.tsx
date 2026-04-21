import React, { useState } from "react";
import { useSshScripts } from "../../../hooks/recording/useSshScripts";
import { useScriptExecutionConsumer } from "../../../hooks/recording/useScriptExecutionConsumer";
import type { SshEventScriptsManagerProps } from "./types";
import { ScriptsTab } from "./ScriptsTab";
import { ChainsTab } from "./ChainsTab";
import { HistoryTab } from "./HistoryTab";
import { TimersTab } from "./TimersTab";

const TABS = [
  { key: "scripts", label: "Scripts", icon: "📜" },
  { key: "chains", label: "Chains", icon: "🔗" },
  { key: "history", label: "History", icon: "📊" },
  { key: "timers", label: "Timers", icon: "⏱️" },
] as const;

export const SshEventScriptsManager: React.FC<SshEventScriptsManagerProps> = ({
  isOpen,
  onClose,
  sessionId,
  connectionId,
}) => {
  const hook = useSshScripts();
  const [showCreate, setShowCreate] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Automatically execute pending scripts on their target SSH sessions
  useScriptExecutionConsumer(hook.pendingExecutions);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex h-[90vh] w-[95vw] max-w-[1600px] flex-col rounded-xl border border-theme-border bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-theme-border px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="text-xl">⚡</span>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">
              SSH Event Scripts
            </h2>
            {hook.summary && (
              <span className="rounded-full bg-surfaceHover px-2 py-0.5 text-xs text-text-secondary">
                {hook.summary.totalScripts} scripts · {hook.summary.enabledScripts}{" "}
                enabled · {hook.summary.totalChains} chains
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => hook.exportScripts()}
              className="rounded-lg border border-theme-border px-3 py-1.5 text-sm text-text-secondary hover:bg-surfaceHover"
              title="Export all scripts"
            >
              📤 Export
            </button>
            <button
              onClick={hook.refresh}
              className="rounded-lg border border-theme-border px-3 py-1.5 text-sm text-text-secondary hover:bg-surfaceHover"
              title="Refresh"
            >
              🔄
            </button>
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-sm text-text-muted hover:bg-surfaceHover hover:text-theme-text"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-theme-border">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => hook.setTab(t.key)}
              className={`px-5 py-2.5 text-sm font-medium transition-colors ${
                hook.tab === t.key
                  ? "border-b-2 border-primary text-primary"
                  : "text-text-muted hover:text-theme-text"
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Error banner */}
        {hook.error && (
          <div className="mx-6 mt-3 rounded-lg border border-error bg-error/30 px-4 py-2 text-sm text-error">
            {hook.error}
          </div>
        )}

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {hook.tab === "scripts" && (
            <ScriptsTab
              scripts={hook.scripts}
              selectedScript={hook.selectedScript}
              searchFilter={hook.searchFilter}
              setSearchFilter={hook.setSearchFilter}
              triggerFilter={hook.triggerFilter}
              setTriggerFilter={hook.setTriggerFilter}
              categoryFilter={hook.categoryFilter}
              setCategoryFilter={hook.setCategoryFilter}
              tagFilter={hook.tagFilter}
              setTagFilter={hook.setTagFilter}
              categories={hook.categories}
              tags={hook.tags}
              stats={hook.stats}
              bulkSelected={bulkSelected}
              setBulkSelected={setBulkSelected}
              selectScript={hook.selectScript}
              toggleScript={hook.toggleScript}
              deleteScript={hook.deleteScript}
              duplicateScript={hook.duplicateScript}
              runScript={hook.runScript}
              createScript={hook.createScript}
              updateScript={hook.updateScript}
              bulkEnable={hook.bulkEnable}
              bulkDelete={hook.bulkDelete}
              showCreate={showCreate}
              setShowCreate={setShowCreate}
              confirmDelete={confirmDelete}
              setConfirmDelete={setConfirmDelete}
              sessionId={sessionId}
              connectionId={connectionId}
              loading={hook.loading}
            />
          )}
          {hook.tab === "chains" && (
            <ChainsTab chains={hook.chains} scripts={hook.scripts} />
          )}
          {hook.tab === "history" && (
            <HistoryTab
              history={hook.history}
              historyTotal={hook.historyTotal}
              queryHistory={hook.queryHistory}
              clearHistory={hook.clearHistory}
            />
          )}
          {hook.tab === "timers" && <TimersTab timers={hook.timers} />}
        </div>
      </div>
    </div>
  );
};

export default SshEventScriptsManager;
