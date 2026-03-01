import React from "react";
import {
  X,
  Terminal,
  Send,
  Square,
  CheckSquare,
  Grid3x3,
  Rows,
  History,
  Trash2,
  Copy,
  Clock,
  AlertCircle,
  Check,
  Save,
  FileCode,
  StopCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Modal } from "./ui/Modal";
import { useBulkSSHCommander } from "../hooks/ssh/useBulkSSHCommander";

interface BulkSSHCommanderProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BulkSSHCommander: React.FC<BulkSSHCommanderProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const mgr = useBulkSSHCommander(isOpen);

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      backdropClassName="bg-black/50"
      panelClassName="max-w-6xl mx-4 h-[90vh]"
      contentClassName="overflow-hidden"
      dataTestId="bulk-ssh-commander-modal"
    >
      {/* Background glow effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none dark:opacity-100 opacity-0">
        <div className="absolute top-[15%] left-[10%] w-96 h-96 bg-green-500/8 rounded-full blur-3xl" />
        <div className="absolute bottom-[20%] right-[15%] w-80 h-80 bg-emerald-500/6 rounded-full blur-3xl" />
        <div className="absolute top-[50%] right-[25%] w-64 h-64 bg-teal-500/5 rounded-full blur-3xl" />
      </div>

      <div className="bg-[var(--color-surface)] rounded-xl shadow-xl w-full max-w-6xl mx-4 h-[90vh] overflow-hidden flex flex-col border border-[var(--color-border)] relative z-10">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-[var(--color-border)] px-5 py-4 flex items-center justify-between bg-[var(--color-surface)]">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-green-500/20 rounded-lg">
              <Terminal
                size={16}
                className="text-green-600 dark:text-green-500"
              />
            </div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">
              {t("bulkSsh.title", "Bulk SSH Commander")}
            </h2>
            <span className="text-sm text-[var(--color-textSecondary)] bg-[var(--color-surfaceHover)] px-2 py-0.5 rounded">
              {mgr.selectedCount}/{mgr.totalCount}{" "}
              {t("bulkSsh.sessions", "sessions")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-2 hover:bg-[var(--color-surfaceHover)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
              aria-label={t("common.close", "Close")}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Secondary toolbar */}
        <SecondaryToolbar mgr={mgr} t={t} />

        {/* Script Library Panel */}
        {mgr.showScriptLibrary && <ScriptLibraryPanel mgr={mgr} t={t} />}

        {/* Command history dropdown */}
        {mgr.showHistory && mgr.commandHistory.length > 0 && (
          <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] max-h-48 overflow-y-auto">
            {mgr.commandHistory.map((item) => (
              <button
                key={item.id}
                onClick={() => mgr.loadHistoryCommand(item)}
                className="w-full px-4 py-2 text-left hover:bg-[var(--color-surfaceHover)] flex items-center gap-3 border-b border-[var(--color-border)]/30 last:border-0"
              >
                <Clock
                  size={12}
                  className="text-[var(--color-textSecondary)] flex-shrink-0"
                />
                <code className="flex-1 text-sm font-mono text-[var(--color-text)] truncate">
                  {item.command}
                </code>
                <span className="text-xs text-[var(--color-textSecondary)]">
                  {new Date(item.timestamp).toLocaleTimeString()}
                </span>
              </button>
            ))}
          </div>
        )}
        {mgr.showHistory && mgr.commandHistory.length === 0 && (
          <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-8 text-center text-[var(--color-textSecondary)]">
            <History size={24} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">
              {t("bulkSsh.noHistory", "No command history yet")}
            </p>
          </div>
        )}

        <div className="flex-1 flex overflow-hidden">
          {/* Left panel - Session selection */}
          <SessionPanel mgr={mgr} t={t} />

          {/* Main content area */}
          <div className="flex-1 flex flex-col">
            {/* Command input area */}
            <CommandInput mgr={mgr} t={t} />

            {/* Output area */}
            <OutputArea mgr={mgr} t={t} />
          </div>
        </div>
      </div>
    </Modal>
  );
};

// ─── Sub-components ─────────────────────────────────────────────

type Mgr = ReturnType<typeof useBulkSSHCommander>;
type TFunc = ReturnType<typeof useTranslation>["t"];

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

function ScriptLibraryPanel({ mgr, t }: { mgr: Mgr; t: TFunc }) {
  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] max-h-72 overflow-hidden flex flex-col">
      <div className="px-4 py-2 border-b border-[var(--color-border)] flex items-center gap-3 bg-[var(--color-surfaceHover)]/30">
        <input
          type="text"
          value={mgr.scriptFilter}
          onChange={(e) => mgr.setScriptFilter(e.target.value)}
          placeholder={t("bulkSsh.searchScripts", "Search scripts...")}
          className="flex-1 px-3 py-1.5 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-green-500"
        />
        {mgr.command.trim() && (
          <button
            onClick={() =>
              mgr.setEditingScript({
                id: "",
                name: "",
                description: "",
                script: mgr.command,
                category: "Custom",
                createdAt: "",
                updatedAt: "",
              })
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-[var(--color-text)] rounded-md transition-colors"
          >
            <Save size={14} />
            {t("bulkSsh.saveAsScript", "Save Current")}
          </button>
        )}
      </div>

      {mgr.editingScript && (
        <div className="px-4 py-3 border-b border-[var(--color-border)] bg-green-500/5 space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={mgr.newScriptName}
              onChange={(e) => mgr.setNewScriptName(e.target.value)}
              placeholder={t("bulkSsh.scriptName", "Script name")}
              className="flex-1 px-3 py-1.5 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-green-500"
            />
            <select
              value={mgr.newScriptCategory}
              onChange={(e) => mgr.setNewScriptCategory(e.target.value)}
              className="px-3 py-1.5 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-green-500"
            >
              {mgr.categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
              <option value="Custom">Custom</option>
            </select>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={mgr.newScriptDescription}
              onChange={(e) => mgr.setNewScriptDescription(e.target.value)}
              placeholder={t(
                "bulkSsh.scriptDescription",
                "Description (optional)",
              )}
              className="flex-1 px-3 py-1.5 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-green-500"
            />
            <button
              onClick={mgr.saveCurrentAsScript}
              disabled={!mgr.newScriptName.trim()}
              className="px-4 py-1.5 text-sm bg-green-600 hover:bg-green-700 disabled:bg-gray-400 disabled:opacity-50 text-[var(--color-text)] rounded-md transition-colors"
            >
              {t("common.save", "Save")}
            </button>
            <button
              onClick={() => mgr.setEditingScript(null)}
              className="px-4 py-1.5 text-sm bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] text-[var(--color-text)] rounded-md transition-colors"
            >
              {t("common.cancel", "Cancel")}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {mgr.categories.map((category) => {
          const categoryScripts = mgr.filteredScripts.filter(
            (s) => s.category === category,
          );
          if (categoryScripts.length === 0) return null;
          return (
            <div key={category}>
              <div className="px-4 py-1.5 text-xs font-medium text-[var(--color-textSecondary)] bg-[var(--color-surfaceHover)]/50 uppercase tracking-wide">
                {category}
              </div>
              {categoryScripts.map((script) => (
                <div
                  key={script.id}
                  className="px-4 py-2 hover:bg-[var(--color-surfaceHover)] flex items-center gap-3 border-b border-[var(--color-border)]/30 cursor-pointer group"
                  onClick={() => mgr.loadScript(script)}
                >
                  <FileCode
                    size={14}
                    className="text-green-600 dark:text-green-500 flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[var(--color-text)] truncate">
                      {script.name}
                    </div>
                    {script.description && (
                      <div className="text-xs text-[var(--color-textSecondary)] truncate">
                        {script.description}
                      </div>
                    )}
                  </div>
                  <code className="text-xs text-[var(--color-textMuted)] font-mono truncate max-w-[200px] hidden sm:block">
                    {script.script.substring(0, 40)}
                    {script.script.length > 40 ? "..." : ""}
                  </code>
                  {!script.id.startsWith("default-") && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        mgr.deleteScript(script.id);
                      }}
                      className="p-1 text-[var(--color-textSecondary)] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      title={t("common.delete", "Delete")}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          );
        })}
        {mgr.filteredScripts.length === 0 && (
          <div className="px-4 py-8 text-center text-[var(--color-textSecondary)]">
            <FileCode size={24} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">
              {t("bulkSsh.noScriptsFound", "No scripts found")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function SessionPanel({ mgr, t }: { mgr: Mgr; t: TFunc }) {
  return (
    <div className="w-64 border-r border-[var(--color-border)] flex flex-col bg-[var(--color-surface)]">
      <div className="p-3 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-[var(--color-text)]">
            {t("bulkSsh.sshSessions", "SSH Sessions")}
          </span>
          <button
            onClick={mgr.selectAllSessions}
            className="text-xs text-green-700 dark:text-green-400 hover:underline"
          >
            {mgr.selectedSessionIds.size === mgr.sshSessions.length
              ? t("bulkSsh.deselectAll", "Deselect All")
              : t("bulkSsh.selectAll", "Select All")}
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {mgr.sshSessions.length === 0 ? (
          <div className="text-center py-8 text-[var(--color-textSecondary)]">
            <Terminal size={32} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">
              {t("bulkSsh.noSessions", "No active SSH sessions")}
            </p>
            <p className="text-xs mt-1">
              {t("bulkSsh.connectFirst", "Connect to SSH servers first")}
            </p>
          </div>
        ) : (
          mgr.sshSessions.map((session) => {
            const isSelected = mgr.selectedSessionIds.has(session.id);
            const output = mgr.sessionOutputs[session.id];
            return (
              <button
                key={session.id}
                onClick={() => mgr.toggleSessionSelection(session.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors ${
                  isSelected
                    ? "bg-green-500/20 border border-green-500/40"
                    : "hover:bg-[var(--color-surfaceHover)] border border-transparent"
                }`}
              >
                {isSelected ? (
                  <CheckSquare
                    size={14}
                    className="text-green-600 dark:text-green-500 flex-shrink-0"
                  />
                ) : (
                  <Square
                    size={14}
                    className="text-[var(--color-textSecondary)] flex-shrink-0"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[var(--color-text)] truncate">
                    {session.name}
                  </div>
                  <div className="text-xs text-[var(--color-textSecondary)] truncate">
                    {session.hostname}
                  </div>
                </div>
                {output?.status === "running" && (
                  <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
                )}
                {output?.status === "success" && (
                  <Check
                    size={12}
                    className="text-green-600 dark:text-green-500"
                  />
                )}
                {output?.status === "error" && (
                  <AlertCircle size={12} className="text-red-500" />
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function CommandInput({ mgr, t }: { mgr: Mgr; t: TFunc }) {
  return (
    <div className="p-4 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex gap-3">
        <div className="flex-1">
          <textarea
            ref={mgr.commandInputRef}
            value={mgr.command}
            onChange={(e) => mgr.setCommand(e.target.value)}
            onKeyDown={mgr.handleKeyDown}
            placeholder={t(
              "bulkSsh.commandPlaceholder",
              "Enter command to send to all selected sessions...",
            )}
            className="w-full px-4 py-3 bg-[var(--color-input)] border border-[var(--color-border)] rounded-lg text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500 font-mono text-sm resize-y min-h-[80px] max-h-[300px]"
            rows={3}
            disabled={mgr.isExecuting || mgr.selectedCount === 0}
          />
        </div>
        <div className="flex flex-col gap-2">
          <button
            onClick={mgr.executeCommand}
            disabled={
              !mgr.command.trim() ||
              mgr.selectedCount === 0 ||
              mgr.isExecuting
            }
            className="flex-1 px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-[var(--color-surfaceHover)] disabled:text-[var(--color-textMuted)] text-[var(--color-text)] rounded-lg transition-colors flex items-center justify-center gap-2 font-medium"
          >
            {mgr.isExecuting ? (
              <>
                <div className="w-4 h-4 border-2 border-[var(--color-border)]/30 border-t-[var(--color-text)] rounded-full animate-spin" />
                {t("bulkSsh.executing", "Running...")}
              </>
            ) : (
              <>
                <Send size={16} />
                {t("bulkSsh.send", "Send")}
              </>
            )}
          </button>
          <button
            onClick={mgr.sendCancel}
            disabled={mgr.selectedCount === 0}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-[var(--color-surfaceHover)] disabled:text-[var(--color-textMuted)] text-[var(--color-text)] rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
            title={t("bulkSsh.sendCancel", "Send Ctrl+C")}
          >
            <StopCircle size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function OutputArea({ mgr, t }: { mgr: Mgr; t: TFunc }) {
  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {mgr.viewMode === "tabs" ? (
        <TabOutputView mgr={mgr} t={t} />
      ) : (
        <MosaicOutputView mgr={mgr} t={t} />
      )}
    </div>
  );
}

function TabOutputView({ mgr, t }: { mgr: Mgr; t: TFunc }) {
  return (
    <>
      <div className="flex border-b border-[var(--color-border)] bg-[var(--color-surface)] overflow-x-auto">
        {mgr.sshSessions
          .filter((s) => mgr.selectedSessionIds.has(s.id))
          .map((session) => (
            <button
              key={session.id}
              onClick={() => mgr.setActiveOutputTab(session.id)}
              className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 transition-colors ${
                mgr.activeOutputTab === session.id
                  ? "border-green-500 text-green-700 dark:text-green-400 bg-green-500/10"
                  : "border-transparent text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)]"
              }`}
            >
              {session.name}
              {mgr.sessionOutputs[session.id]?.status === "running" && (
                <span className="ml-2 w-2 h-2 inline-block bg-yellow-500 rounded-full animate-pulse" />
              )}
            </button>
          ))}
      </div>
      <div className="flex-1 overflow-auto p-4 bg-[var(--color-background)]">
        {mgr.activeOutputTab &&
          mgr.sessionOutputs[mgr.activeOutputTab] && (
            <div className="font-mono text-sm">
              {mgr.sessionOutputs[mgr.activeOutputTab].error ? (
                <div className="text-red-600 dark:text-red-400">
                  {mgr.sessionOutputs[mgr.activeOutputTab].error}
                </div>
              ) : (
                <pre className="text-green-800 dark:text-green-400 whitespace-pre-wrap">
                  {mgr.sessionOutputs[mgr.activeOutputTab].output ||
                    t(
                      "bulkSsh.noOutput",
                      "No output yet. Send a command to see results.",
                    )}
                </pre>
              )}
            </div>
          )}
      </div>
    </>
  );
}

function MosaicOutputView({ mgr, t }: { mgr: Mgr; t: TFunc }) {
  return (
    <div className="flex-1 overflow-auto p-4 bg-[var(--color-background)]">
      <div
        className={`grid gap-4 h-full ${
          mgr.selectedCount <= 1
            ? "grid-cols-1"
            : mgr.selectedCount <= 2
              ? "grid-cols-2"
              : mgr.selectedCount <= 4
                ? "grid-cols-2"
                : mgr.selectedCount <= 6
                  ? "grid-cols-3"
                  : "grid-cols-4"
        }`}
      >
        {mgr.sshSessions
          .filter((s) => mgr.selectedSessionIds.has(s.id))
          .map((session) => {
            const output = mgr.sessionOutputs[session.id];
            return (
              <div
                key={session.id}
                className="flex flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden min-h-[200px]"
              >
                <div className="flex items-center justify-between px-3 py-2 bg-[var(--color-surfaceHover)] border-b border-[var(--color-border)]">
                  <div className="flex items-center gap-2">
                    <Terminal
                      size={12}
                      className="text-green-600 dark:text-green-500"
                    />
                    <span className="text-sm font-medium text-[var(--color-text)] truncate">
                      {session.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {output?.status === "running" && (
                      <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
                    )}
                    {output?.status === "success" && (
                      <Check
                        size={12}
                        className="text-green-600 dark:text-green-500"
                      />
                    )}
                    {output?.status === "error" && (
                      <AlertCircle size={12} className="text-red-500" />
                    )}
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(output?.output || "");
                      }}
                      className="p-1 hover:bg-[var(--color-surface)] rounded transition-colors"
                      title={t("common.copy", "Copy")}
                    >
                      <Copy
                        size={12}
                        className="text-[var(--color-textSecondary)]"
                      />
                    </button>
                  </div>
                </div>
                <div className="flex-1 p-3 overflow-auto bg-[var(--color-background)]">
                  <pre className="font-mono text-xs text-green-800 dark:text-green-400 whitespace-pre-wrap">
                    {output?.error ? (
                      <span className="text-red-600 dark:text-red-400">
                        {output.error}
                      </span>
                    ) : (
                      output?.output || (
                        <span className="text-[var(--color-textMuted)]">
                          {t(
                            "bulkSsh.waitingOutput",
                            "Waiting for output...",
                          )}
                        </span>
                      )
                    )}
                  </pre>
                </div>
              </div>
            );
          })}
      </div>
      {mgr.selectedCount === 0 && (
        <div className="flex items-center justify-center h-full text-[var(--color-textSecondary)]">
          <div className="text-center">
            <Grid3x3 size={48} className="mx-auto mb-4 opacity-30" />
            <p>
              {t(
                "bulkSsh.selectSessions",
                "Select SSH sessions from the left panel",
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
