import React from "react";
import {
  FolderOpen,
  Info,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import locationPresetIcons from "./locationPresetIcons";
import type { Mgr } from "./types";
import {
  BackupLocationPresets,
  type BackupLocationPreset,
  type BackupTarget,
} from "../../../../types/settings/settings";
import { locationPresetLabels } from "../../../../hooks/settings/useBackupSettings";
import { Select } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
} from "../../../ui/settings/SettingsPrimitives";

const presetOptions = BackupLocationPresets.map((preset) => ({
  value: preset,
  label: locationPresetLabels[preset],
}));

interface DestinationRowProps {
  mgr: Mgr;
  target: BackupTarget;
  index: number;
  total: number;
}

const DestinationRow: React.FC<DestinationRowProps> = ({
  mgr,
  target,
  index,
  total,
}) => {
  const [retentionExpanded, setRetentionExpanded] = React.useState(
    Boolean(target.retentionOverride),
  );

  const isLocal =
    target.preset === "custom" ||
    target.preset === "appData" ||
    target.preset === "documents";

  return (
    <div
      className={`rounded-lg border ${
        target.enabled
          ? "border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30"
          : "border-[var(--color-border)] bg-[var(--color-surface)]/50 opacity-70"
      } p-3 space-y-3`}
    >
      {/* Top row: icon + label + reorder + remove + enabled toggle */}
      <div className="flex items-center gap-2">
        <span className="flex-shrink-0">{locationPresetIcons[target.preset]}</span>
        <input
          type="text"
          value={target.label}
          onChange={(e) =>
            mgr.updateDestination(target.id, { label: e.target.value })
          }
          placeholder="Label"
          className="sor-settings-input flex-1 text-sm"
          aria-label="Destination label"
        />
        <button
          type="button"
          onClick={() => mgr.reorderDestinations(index, index - 1)}
          disabled={index === 0}
          className="p-1 text-[var(--color-textMuted)] hover:text-[var(--color-text)] disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Move up"
          title="Move up"
        >
          <ArrowUp className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => mgr.reorderDestinations(index, index + 1)}
          disabled={index === total - 1}
          className="p-1 text-[var(--color-textMuted)] hover:text-[var(--color-text)] disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Move down"
          title="Move down"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={target.enabled}
            onChange={() => mgr.toggleDestination(target.id)}
            className="sor-settings-checkbox"
          />
          <span className="text-[var(--color-textSecondary)]">Enabled</span>
        </label>
        <button
          type="button"
          onClick={() => mgr.removeDestination(target.id)}
          className="p-1 text-[var(--color-textMuted)] hover:text-[var(--color-error)]"
          aria-label="Remove destination"
          title="Remove destination"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Preset + path row */}
      <div className="flex items-center gap-2">
        <div style={{ width: "11rem" }}>
          <Select
            value={target.preset}
            onChange={(value: string) =>
              mgr.updateDestination(target.id, {
                preset: value as BackupLocationPreset,
              })
            }
            options={presetOptions}
            variant="settings"
            aria-label="Destination preset"
          />
        </div>
        <input
          type="text"
          value={target.customPath ?? ""}
          onChange={(e) =>
            mgr.updateDestination(target.id, { customPath: e.target.value })
          }
          placeholder={
            isLocal ? "Folder path" : "Cloud subfolder (optional)"
          }
          className="sor-settings-input text-sm"
          style={{ width: "20rem" }}
        />
        {isLocal && (
          <button
            type="button"
            onClick={() => mgr.handleSelectFolderForDestination(target.id)}
            aria-label="Browse for folder"
            title="Browse for folder"
            className="inline-flex items-center justify-center p-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] hover:bg-[var(--color-border)] text-[var(--color-text)] transition-colors flex-shrink-0"
          >
            <FolderOpen className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Retention override (collapsible) */}
      <div>
        <button
          type="button"
          onClick={() => setRetentionExpanded((v) => !v)}
          className="flex items-center gap-1 text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
          aria-expanded={retentionExpanded}
        >
          {retentionExpanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
          <span>Retention override</span>
          {target.retentionOverride?.maxBackupsToKeep != null && (
            <span className="text-[var(--color-textMuted)]">
              · keep {target.retentionOverride.maxBackupsToKeep}
            </span>
          )}
        </button>
        {retentionExpanded && (
          <div className="mt-2 pl-4 space-y-2 border-l-2 border-[var(--color-border)]">
            <label className="block text-xs text-[var(--color-textSecondary)]">
              Override max backups to keep at this destination
              <InfoTooltip text="Leave empty to inherit the global retention policy. Useful when a destination has tighter quota than the others." />
            </label>
            <input
              type="number"
              min={0}
              value={target.retentionOverride?.maxBackupsToKeep ?? ""}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") {
                  mgr.updateDestinationRetention(target.id, undefined);
                  return;
                }
                const parsed = Number.parseInt(raw, 10);
                if (Number.isNaN(parsed) || parsed < 0) return;
                mgr.updateDestinationRetention(target.id, {
                  maxBackupsToKeep: parsed,
                });
              }}
              placeholder="(use global)"
              className="sor-settings-input text-sm w-40"
            />
          </div>
        )}
      </div>
    </div>
  );
};

const DestinationSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<FolderOpen className="w-4 h-4 text-primary" />}
      title={
        <span className="flex items-center gap-2">
          Backup destinations
          <InfoTooltip text="The scheduled backup writes the same payload to every enabled destination. Disable a row to skip it without losing the credentials/path." />
        </span>
      }
    />

    <Card>
      {mgr.destinations.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surfaceHover)]/20 p-4 text-center">
          <p className="text-sm text-[var(--color-textSecondary)]">
            No destinations configured yet.
          </p>
          <button
            type="button"
            onClick={() => mgr.addDestination("custom")}
            className="mt-3 inline-flex items-center gap-1 px-3 py-1.5 bg-primary/10 border border-primary/30 rounded text-xs text-primary hover:bg-primary/20 transition-colors"
          >
            <Plus className="w-3 h-3" />
            Add a local folder destination
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {mgr.destinations.map((target, index) => (
            <DestinationRow
              key={target.id}
              mgr={mgr}
              target={target}
              index={index}
              total={mgr.destinations.length}
            />
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <label
          htmlFor="backup-add-destination"
          className="text-xs text-[var(--color-textSecondary)]"
        >
          Add destination
        </label>
        <div style={{ width: "14rem" }}>
          <Select
            value="add"
            onChange={(value: string) => {
              if (value === "add") return;
              mgr.addDestination(value as BackupLocationPreset);
            }}
            options={[
              { value: "add", label: "Choose a preset…" },
              ...presetOptions,
            ]}
            variant="settings"
            aria-label="Add destination preset"
          />
        </div>
      </div>

      <p className="text-xs text-[var(--color-textMuted)] flex items-start gap-1">
        <Info className="w-3 h-3 flex-shrink-0 mt-0.5" />
        <span>
          Cloud destinations rely on the corresponding sync client being
          installed and running — sortOfRemoteNG writes to the local sync
          folder and the client uploads from there.
        </span>
      </p>
    </Card>
  </div>
);

export default DestinationSection;
