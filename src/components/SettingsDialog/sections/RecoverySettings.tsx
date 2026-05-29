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
import SectionHeading from "../../ui/SectionHeading";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
} from "../../ui/settings/SettingsPrimitives";

type Mgr = ReturnType<typeof useRecoverySettings>;

interface RecoverySettingsProps {
  onClose?: () => void;
}

type Tone = "primary" | "warning" | "error" | "success";

const toneClasses: Record<
  Tone,
  { iconText: string; button: string }
> = {
  primary: {
    iconText: "text-primary",
    button:
      "bg-primary/20 text-primary hover:bg-primary/30 border border-primary/30",
  },
  warning: {
    iconText: "text-warning",
    button:
      "bg-warning/20 text-warning hover:bg-warning/30 border border-warning/30",
  },
  error: {
    iconText: "text-error",
    button:
      "bg-error/20 text-error hover:bg-error/30 border border-error/30",
  },
  success: {
    iconText: "text-success",
    button:
      "bg-success/20 text-success hover:bg-success/30 border border-success/30",
  },
};

/* ── Action row primitive ────────────────────────────── */

const ActionRow: React.FC<{
  icon: React.ReactNode;
  tone: Tone;
  label: string;
  description: string;
  onClick: () => void;
  buttonIcon: React.ReactNode;
  buttonLabel: string;
  disabled?: boolean;
}> = ({
  icon,
  tone,
  label,
  description,
  onClick,
  buttonIcon,
  buttonLabel,
  disabled,
}) => {
  const cls = toneClasses[tone];
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-[var(--color-text)] font-medium">
          <span className={`flex-shrink-0 ${cls.iconText}`}>{icon}</span>
          {label}
        </div>
        <p className="text-xs text-[var(--color-textSecondary)] mt-1">
          {description}
        </p>
      </div>
      <button
        onClick={onClick}
        disabled={disabled}
        className={`px-4 py-2 text-sm rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 flex-shrink-0 ${cls.button}`}
      >
        {buttonIcon}
        {buttonLabel}
      </button>
    </div>
  );
};

const Divider: React.FC = () => (
  <div className="border-t border-[var(--color-border)]/50 my-2" />
);

/* ── Main Component ──────────────────────────────────── */

export const RecoverySettings: React.FC<RecoverySettingsProps> = ({
  onClose: _onClose,
}) => {
  const mgr = useRecoverySettings();

  return (
    <div className="space-y-6">
      <SectionHeading
        icon={<RotateCcw className="w-5 h-5 text-primary" />}
        title="Recovery"
        description="Use these options to troubleshoot issues or reset the application to a clean state."
      />

      {/* Data Management */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Database className="w-4 h-4 text-primary" />}
          title="Data Management"
        />
        <Card>
          <ActionRow
            icon={<FolderX className="w-4 h-4" />}
            tone="warning"
            label="Delete App Data"
            description="Delete settings, theme preferences, and cached data. Collections are preserved."
            onClick={() => mgr.setConfirmAction("deleteData")}
            buttonIcon={<Trash2 className="w-4 h-4" />}
            buttonLabel="Delete"
          />
          <Divider />
          <ActionRow
            icon={<Trash2 className="w-4 h-4" />}
            tone="error"
            label="Delete All Data & Collections"
            description="Permanently delete everything including collections and passwords. Cannot be undone!"
            onClick={() => mgr.setConfirmAction("deleteAll")}
            buttonIcon={<Trash2 className="w-4 h-4" />}
            buttonLabel="Delete All"
          />
        </Card>
      </div>

      {/* Reset Options */}
      <div className="space-y-4">
        <SectionHeader
          icon={<RotateCcw className="w-4 h-4 text-primary" />}
          title="Reset Options"
        />
        <Card>
          <ActionRow
            icon={<RotateCcw className="w-4 h-4" />}
            tone="warning"
            label="Reset All Settings"
            description="Reset all settings to their default values. Your collections will not be affected."
            onClick={() => mgr.setConfirmAction("resetSettings")}
            buttonIcon={<RotateCcw className="w-4 h-4" />}
            buttonLabel="Reset"
          />
        </Card>
      </div>

      {/* Restart Options */}
      <div className="space-y-4">
        <SectionHeader
          icon={<RefreshCw className="w-4 h-4 text-primary" />}
          title="Restart Options"
        />
        <Card>
          <ActionRow
            icon={<RefreshCw className="w-4 h-4" />}
            tone="primary"
            label="Soft Restart"
            description="Reload the frontend without restarting the application. Quick way to apply changes."
            onClick={mgr.handleSoftRestart}
            buttonIcon={<RefreshCw className="w-4 h-4" />}
            buttonLabel="Reload"
          />
          <Divider />
          <ActionRow
            icon={<Power className="w-4 h-4" />}
            tone="success"
            label="Hard Restart"
            description="Completely restart the application including the backend."
            onClick={mgr.handleHardRestart}
            disabled={mgr.isLoading}
            buttonIcon={
              mgr.isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Power className="w-4 h-4" />
              )
            }
            buttonLabel="Restart"
          />
        </Card>
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
