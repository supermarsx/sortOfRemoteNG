import SectionHeading from '../../ui/SectionHeading';
import React from "react";
import {
  RefreshCw,
  Trash2,
  AlertTriangle,
  RotateCcw,
  Database,
  FolderX,
  Power,
  Loader2,
} from "lucide-react";
import { Modal } from "../../ui/overlays/Modal";
import { useRecoverySettings } from "../../../hooks/settings/useRecoverySettings";

type Mgr = ReturnType<typeof useRecoverySettings>;

interface RecoverySettingsProps {
  onClose?: () => void;
}

export const RecoverySettings: React.FC<RecoverySettingsProps> = ({
  onClose,
}) => {
  const mgr = useRecoverySettings();

  return (
    <div className="space-y-6">
      <SectionHeading icon={<RotateCcw className="w-5 h-5" />} title="Recovery" description="Use these options to troubleshoot issues or reset the application to a clean state." />

      {/* Data Management */}
      <div className="space-y-4">
        <h4 className="sor-section-heading">
          <Database className="w-4 h-4 text-primary" />
          Data Management
        </h4>

        <div className="sor-settings-card space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 text-[var(--color-text)] font-medium">
                <FolderX className="w-4 h-4 text-warning" />
                Delete App Data
              </div>
              <p className="text-xs text-[var(--color-textMuted)] mt-1">
                Delete settings, theme preferences, and cached data. Collections
                are preserved.
              </p>
            </div>
            <button
              onClick={() => mgr.setConfirmAction("deleteData")}
              className="px-4 py-2 text-sm rounded-lg bg-warning/20 text-warning hover:bg-warning/30 border border-warning/30 transition-colors flex items-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          </div>

          <div className="border-t border-[var(--color-border)]/50 pt-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 text-[var(--color-text)] font-medium">
                  <Trash2 className="w-4 h-4 text-error" />
                  Delete All Data & Collections
                </div>
                <p className="text-xs text-[var(--color-textMuted)] mt-1">
                  Permanently delete everything including collections and
                  passwords. Cannot be undone!
                </p>
              </div>
              <button
                onClick={() => mgr.setConfirmAction("deleteAll")}
                className="px-4 py-2 text-sm rounded-lg bg-error/20 text-error hover:bg-error/30 border border-error/30 transition-colors flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Delete All
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Reset Settings */}
      <div className="space-y-4">
        <h4 className="sor-section-heading">
          <RotateCcw className="w-4 h-4 text-warning" />
          Reset Options
        </h4>

        <div className="sor-settings-card">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 text-[var(--color-text)] font-medium">
                <RotateCcw className="w-4 h-4 text-warning" />
                Reset All Settings
              </div>
              <p className="text-xs text-[var(--color-textMuted)] mt-1">
                Reset all settings to their default values. Your collections
                will not be affected.
              </p>
            </div>
            <button
              onClick={() => mgr.setConfirmAction("resetSettings")}
              className="px-4 py-2 text-sm rounded-lg bg-warning/20 text-warning hover:bg-warning/30 border border-warning/30 transition-colors flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* Restart Options */}
      <div className="space-y-4">
        <h4 className="sor-section-heading">
          <RefreshCw className="w-4 h-4 text-success" />
          Restart Options
        </h4>

        <div className="sor-settings-card space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 text-[var(--color-text)] font-medium">
                <RefreshCw className="w-4 h-4 text-primary" />
                Soft Restart
              </div>
              <p className="text-xs text-[var(--color-textMuted)] mt-1">
                Reload the frontend without restarting the application. Quick
                way to apply changes.
              </p>
            </div>
            <button
              onClick={mgr.handleSoftRestart}
              className="px-4 py-2 text-sm rounded-lg bg-primary/20 text-primary hover:bg-primary/30 border border-primary/30 transition-colors flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              Reload
            </button>
          </div>

          <div className="border-t border-[var(--color-border)]/50 pt-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 text-[var(--color-text)] font-medium">
                  <Power className="w-4 h-4 text-success" />
                  Hard Restart
                </div>
                <p className="text-xs text-[var(--color-textMuted)] mt-1">
                  Completely restart the application including the backend.
                </p>
              </div>
              <button
                onClick={mgr.handleHardRestart}
                disabled={mgr.isLoading}
                className="px-4 py-2 text-sm rounded-lg bg-success/20 text-success hover:bg-success/30 border border-success/30 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {mgr.isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Power className="w-4 h-4" />
                )}
                Restart
              </button>
            </div>
          </div>
        </div>
      </div>

      {renderConfirmDialog(mgr)}
    </div>
  );
};

function renderConfirmDialog(mgr: Mgr) {
  if (!mgr.confirmAction) return null;
  const action = mgr.confirmActions[mgr.confirmAction];
  if (!action) return null;

  return (
    <Modal
      isOpen
      closeOnBackdrop={false}
      closeOnEscape={false}
      backdropClassName="z-[100] bg-black/60 p-4"
      panelClassName="max-w-md mx-4"
    >
      <div className="bg-[var(--color-surface)] rounded-xl p-6 max-w-md w-full border border-[var(--color-border)] shadow-2xl">
        <div className="flex items-start gap-4">
          <div
            className={`p-3 rounded-full ${action.danger ? "bg-error/20" : "bg-warning/20"}`}
          >
            <AlertTriangle
              className={`w-6 h-6 ${action.danger ? "text-error" : "text-warning"}`}
            />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-[var(--color-text)] mb-2">
              {action.title}
            </h3>
            <p className="text-sm text-[var(--color-textSecondary)] mb-4">
              {action.description}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => mgr.setConfirmAction(null)}
                disabled={mgr.isLoading}
                className="px-4 py-2 text-sm rounded-lg bg-[var(--color-border)] text-[var(--color-textSecondary)] hover:bg-[var(--color-border)] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={action.onConfirm}
                disabled={mgr.isLoading}
                className={`px-4 py-2 text-sm rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50 ${
                  action.danger
                    ? "bg-error text-[var(--color-text)] hover:bg-error/90"
                    : "bg-warning text-[var(--color-text)] hover:bg-warning/90"
                }`}
              >
                {mgr.isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                Confirm
              </button>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default RecoverySettings;
