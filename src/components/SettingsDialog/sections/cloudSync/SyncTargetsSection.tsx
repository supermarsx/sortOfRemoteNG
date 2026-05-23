import React from "react";
import {
  Cloud,
  Info,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-react";
import type { Mgr } from "./types";
import {
  CloudSyncProviders,
  type CloudSyncProvider,
  type CloudSyncTarget,
} from "../../../../types/settings/settings";
import {
  providerLabels,
  providerIcons,
} from "../../../../hooks/settings/useCloudSyncSettings";
import { Select } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import { SettingsSectionHeader as SectionHeader } from "../../../ui/settings/SettingsPrimitives";
import ProviderConfig from "./ProviderConfig";

const providerOptions = CloudSyncProviders.filter((p) => p !== "none").map(
  (provider) => ({
    value: provider,
    label: providerLabels[provider],
  }),
);

interface SyncTargetRowProps {
  mgr: Mgr;
  target: CloudSyncTarget;
  index: number;
  total: number;
}

const SyncTargetRow: React.FC<SyncTargetRowProps> = ({
  mgr,
  target,
  index,
  total,
}) => {
  const isExpanded = mgr.expandedTargetId === target.id;
  const isSyncing = mgr.syncingTargetId === target.id;
  return (
    <div
      className={`rounded-lg border ${
        target.enabled
          ? "border-[var(--color-border)] bg-[var(--color-surfaceHover)]/30"
          : "border-[var(--color-border)] bg-[var(--color-surface)]/50 opacity-70"
      }`}
    >
      {/* Header row: icon + label + provider + sync + reorder + remove + enabled */}
      <div className="flex items-center gap-2 p-3">
        <span className="flex-shrink-0">{providerIcons[target.provider]}</span>
        <input
          type="text"
          value={target.label}
          onChange={(e) =>
            mgr.updateSyncTarget(target.id, { label: e.target.value })
          }
          placeholder="Label"
          className="sor-settings-input flex-1 text-sm"
          aria-label="Sync target label"
        />
        <div className="md:w-40">
          <Select
            value={target.provider}
            onChange={(value: string) =>
              mgr.updateSyncTarget(target.id, {
                provider: value as CloudSyncProvider,
              })
            }
            options={providerOptions}
            variant="form"
            aria-label="Sync target provider"
          />
        </div>
        <button
          type="button"
          onClick={() => mgr.handleSyncTarget(target.id)}
          disabled={!target.enabled || mgr.isSyncing}
          className="p-1.5 rounded hover:bg-[var(--color-surfaceHover)] disabled:opacity-30 disabled:cursor-not-allowed text-[var(--color-textSecondary)]"
          aria-label={`Sync ${target.label} now`}
          title={`Sync ${target.label} now`}
        >
          <RefreshCw
            className={`w-4 h-4 ${isSyncing ? "animate-spin" : ""}`}
          />
        </button>
        <button
          type="button"
          onClick={() => mgr.reorderSyncTargets(index, index - 1)}
          disabled={index === 0}
          className="p-1 text-[var(--color-textMuted)] hover:text-[var(--color-text)] disabled:opacity-30 disabled:cursor-not-allowed"
          aria-label="Move up"
          title="Move up"
        >
          <ArrowUp className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => mgr.reorderSyncTargets(index, index + 1)}
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
            onChange={() => mgr.toggleSyncTarget(target.id)}
            className="sor-settings-checkbox"
          />
          <span className="text-[var(--color-textSecondary)]">Enabled</span>
        </label>
        <button
          type="button"
          onClick={() =>
            mgr.setExpandedTargetId(isExpanded ? null : target.id)
          }
          className="p-1.5 rounded hover:bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)]"
          aria-label={
            isExpanded ? "Collapse credentials" : "Edit credentials"
          }
          title={isExpanded ? "Collapse credentials" : "Edit credentials"}
        >
          {isExpanded ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>
        <button
          type="button"
          onClick={() => mgr.removeSyncTarget(target.id)}
          className="p-1 text-[var(--color-textMuted)] hover:text-[var(--color-error)]"
          aria-label="Remove sync target"
          title="Remove sync target"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Expanded per-target credentials editor */}
      {isExpanded && (
        <div className="border-t border-[var(--color-border)] p-3 bg-[var(--color-surface)]/50">
          <ProviderConfig target={target} mgr={mgr} />
        </div>
      )}
    </div>
  );
};

const SyncTargetsSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Cloud className="w-4 h-4 text-primary" />}
      title={
        <span className="flex items-center gap-2">
          Sync targets
          <InfoTooltip text="Each target is a named destination with its own provider credentials and folder. Run several targets in parallel (e.g. personal + work Google Drive) or mix providers." />
        </span>
      }
    />

    <div className="sor-settings-card">
      {mgr.syncTargets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surfaceHover)]/20 p-4 text-center">
          <p className="text-sm text-[var(--color-textSecondary)]">
            No sync targets configured yet.
          </p>
          <button
            type="button"
            onClick={() => mgr.addSyncTarget("googleDrive")}
            className="mt-3 inline-flex items-center gap-1 px-3 py-1.5 bg-primary/10 border border-primary/30 rounded text-xs text-primary hover:bg-primary/20 transition-colors"
          >
            <Plus className="w-3 h-3" />
            Add a Google Drive target
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {mgr.syncTargets.map((target, index) => (
            <SyncTargetRow
              key={target.id}
              mgr={mgr}
              target={target}
              index={index}
              total={mgr.syncTargets.length}
            />
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <label
          htmlFor="cloudsync-add-target"
          className="text-xs text-[var(--color-textSecondary)]"
        >
          Add target
        </label>
        <Select
          value="add"
          onChange={(value: string) => {
            if (value === "add") return;
            mgr.addSyncTarget(value as CloudSyncProvider);
          }}
          options={[
            { value: "add", label: "Choose a provider…" },
            ...providerOptions,
          ]}
          variant="form"
          aria-label="Add sync target provider"
        />
      </div>

      <p className="text-xs text-[var(--color-textMuted)] flex items-start gap-1">
        <Info className="w-3 h-3 flex-shrink-0 mt-0.5" />
        <span>
          Each target carries its own tokens / server URLs / keys —
          expand a row to edit them.
        </span>
      </p>
    </div>
  </div>
);

export default SyncTargetsSection;
