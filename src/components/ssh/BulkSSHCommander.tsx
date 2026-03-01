import React from "react";
import { useTranslation } from "react-i18next";
import { Terminal, Clock, History } from "lucide-react";
import { useBulkSSHCommander } from "../../hooks/ssh/useBulkSSHCommander";
import Modal from "../ui/overlays/Modal";
import DialogHeader from "../ui/overlays/DialogHeader";
import EmptyState from "../ui/display/EmptyState";
import { BulkSSHCommanderProps } from "./bulkCommander/types";
import SecondaryToolbar from "./bulkCommander/SecondaryToolbar";
import ScriptLibraryPanel from "./bulkCommander/ScriptLibraryPanel";
import SessionPanel from "./bulkCommander/SessionPanel";
import CommandInput from "./bulkCommander/CommandInput";
import OutputArea from "./bulkCommander/OutputArea";

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
        <DialogHeader
          icon={Terminal}
          iconColor="text-green-600 dark:text-green-500"
          iconBg="bg-green-500/20"
          title={t("bulkSsh.title", "Bulk SSH Commander")}
          badge={`${mgr.selectedCount}/${mgr.totalCount} ${t("bulkSsh.sessions", "sessions")}`}
          onClose={onClose}
          sticky
        />

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
    </Modal>
  );
};
