import React, { useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Clock, History } from "lucide-react";
import { useBulkSSHCommander } from "../../hooks/ssh/useBulkSSHCommander";
import EmptyState from "../ui/display/EmptyState";
import { BulkSSHCommanderProps } from "./bulkCommander/types";
import SecondaryToolbar from "./bulkCommander/SecondaryToolbar";
import ScriptLibraryPanel from "./bulkCommander/ScriptLibraryPanel";
import SessionPanel from "./bulkCommander/SessionPanel";
import CommandInput from "./bulkCommander/CommandInput";
import OutputArea from "./bulkCommander/OutputArea";
import SSHCommandHistoryPanel from "./commandHistory/SSHCommandHistoryPanel";

export const BulkSSHCommander: React.FC<BulkSSHCommanderProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const mgr = useBulkSSHCommander(isOpen);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      document.addEventListener("keydown", handler);
      return () => document.removeEventListener("keydown", handler);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="h-full flex flex-col bg-[var(--color-surface)] overflow-hidden">
        {/* Secondary toolbar */}
        <SecondaryToolbar mgr={mgr} t={t} onClose={onClose} />

        {/* Script Library Panel */}
        {mgr.showScriptLibrary && <ScriptLibraryPanel mgr={mgr} t={t} />}

        {/* Command history dropdown */}
        {mgr.showHistory && mgr.historyMgr.allEntries.length > 0 && (
          <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] max-h-80">
            <SSHCommandHistoryPanel
              mgr={mgr.historyMgr}
              t={t}
              onSelectCommand={(cmd) => mgr.setCommand(cmd)}
              onReExecute={(cmd) => {
                mgr.setCommand(cmd);
                mgr.toggleHistory();
              }}
              compact
            />
          </div>
        )}
        {/* Fallback: legacy in-memory history when persistent history is empty */}
        {mgr.showHistory && mgr.historyMgr.allEntries.length === 0 && mgr.commandHistory.length > 0 && (
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
        {mgr.showHistory && mgr.historyMgr.allEntries.length === 0 && mgr.commandHistory.length === 0 && (
          <EmptyState
            icon={History}
            iconSize={24}
            message={t("bulkSsh.noHistory", "No command history yet")}
            className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-8"
          />
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
  );
};
