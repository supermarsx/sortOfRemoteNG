import {
  Upload,
  Download,
  Zap,
  FileBox,
  Filter,
  FileArchive,
  Plus,
} from "lucide-react";
import { Textarea, Select } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsNumberRow,
} from "../../../ui/settings/SettingsPrimitives";
import type { Mgr } from "./types";
import { MAX_CLOUD_SYNC_FILE_SIZE_MIB } from "../../../../types/settings/cloudSyncSettings";

/* ── Built-in exclude-pattern presets ────────────────────────────
 * Each preset appends a small bundle of globs that targets a common
 * "don't sync this" category. Selecting a preset merges into the
 * current list (dedupe-by-string) without clobbering custom entries.
 */
const EXCLUDE_PRESETS: Array<{
  value: string;
  label: string;
  patterns: string[];
}> = [
  {
    value: "databases",
    label: "Database archives",
    patterns: ["database:*"],
  },
  {
    value: "libraries",
    label: "Global scripts and automation libraries",
    patterns: ["app:recording.*"],
  },
  {
    value: "settings",
    label: "Portable settings (when available)",
    patterns: ["app:settings"],
  },
  {
    value: "scripts",
    label: "Saved terminal scripts",
    patterns: ["app:recording.managed-scripts"],
  },
  {
    value: "macros",
    label: "Terminal macros",
    patterns: ["app:recording.terminal-macros"],
  },
  {
    value: "webAutomation",
    label: "Website scripts and macros",
    patterns: ["app:recording.web-automation.v1"],
  },
];

const presetOptions = [
  { value: "", label: "Add a preset…" },
  ...EXCLUDE_PRESETS.map((p) => ({ value: p.value, label: p.label })),
];

function AdvancedSection({ mgr }: { mgr: Mgr }) {
  const applyPreset = (value: string) => {
    if (!value) return;
    const preset = EXCLUDE_PRESETS.find((p) => p.value === value);
    if (!preset) return;
    const existing = mgr.cloudSync.excludePatterns ?? [];
    const seen = new Set(existing.map((p) => p.trim()));
    const merged = [...existing];
    for (const pat of preset.patterns) {
      if (!seen.has(pat.trim())) {
        merged.push(pat);
        seen.add(pat.trim());
      }
    }
    mgr.updateCloudSync({ excludePatterns: merged });
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Zap className="w-4 h-4 text-primary" />}
        title="Advanced Options"
      />
      <Card>
        <Toggle
          settingKey="cloudSync.compressionEnabled"
          icon={<FileArchive size={16} />}
          label="Enable Compression"
          description="Compress payloads before uploading to save bandwidth"
          checked={mgr.cloudSync.compressionEnabled}
          onChange={(v) => mgr.updateCloudSync({ compressionEnabled: v })}
          infoTooltip="Gzip-compress payloads before uploading. Reduces bandwidth at the cost of slightly more CPU per sync."
        />

        <SettingsNumberRow
          settingKey="cloudSync.maxFileSizeMB"
          icon={<FileBox size={16} />}
          label="Maximum Sync Snapshot Size"
          value={mgr.cloudSync.maxFileSizeMB}
          min={1}
          max={MAX_CLOUD_SYNC_FILE_SIZE_MIB}
          unit="MiB"
          onChange={(v) =>
            mgr.updateCloudSync({
              maxFileSizeMB: Number.isFinite(v)
                ? Math.min(MAX_CLOUD_SYNC_FILE_SIZE_MIB, Math.max(1, v))
                : 1,
            })
          }
          infoTooltip={`Maximum complete sync snapshot size, from 1 to ${MAX_CLOUD_SYNC_FILE_SIZE_MIB} MiB. Encryption and encoded envelope overhead count toward this limit. Oversized snapshots fail rather than silently skipping selected items.`}
        />
        <p className="text-xs text-[var(--color-textSecondary)]">
          Limit: 1–{MAX_CLOUD_SYNC_FILE_SIZE_MIB} MiB for the complete snapshot,
          including encrypted and encoded overhead. Oversized snapshots are
          rejected.
        </p>

        <SettingsNumberRow
          settingKey="cloudSync.uploadLimitKBs"
          icon={<Upload size={16} />}
          label="Upload Limit"
          value={mgr.cloudSync.uploadLimitKBs}
          min={0}
          unit="KB/s"
          onChange={(v) => mgr.updateCloudSync({ uploadLimitKBs: v })}
          infoTooltip="Throttle upload bandwidth in kilobytes per second. 0 means unlimited."
        />

        <SettingsNumberRow
          settingKey="cloudSync.downloadLimitKBs"
          icon={<Download size={16} />}
          label="Download Limit"
          value={mgr.cloudSync.downloadLimitKBs}
          min={0}
          unit="KB/s"
          onChange={(v) => mgr.updateCloudSync({ downloadLimitKBs: v })}
          infoTooltip="Throttle download bandwidth in kilobytes per second. 0 means unlimited."
        />

        <div
          className="sor-settings-select-row !items-start"
          data-setting-key="cloudSync.excludePatterns"
        >
          <span className="sor-settings-row-label flex items-center gap-1">
            <span className="text-[var(--color-textSecondary)] mr-1">
              <Filter size={16} />
            </span>
            Exclude Patterns
            <InfoTooltip text="Glob patterns (one per line) matching selected application artifact IDs or labels. They exclude entire artifacts, not files or records inside a database archive. No arbitrary filesystem paths are scanned." />
          </span>
          <div className="flex flex-col gap-2" style={{ width: "20rem" }}>
            <div className="flex items-center gap-2">
              <Plus
                size={14}
                className="text-[var(--color-textMuted)] flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <Select
                  value=""
                  onChange={applyPreset}
                  options={presetOptions}
                  variant="settings"
                  label="Add an exclude-pattern preset"
                />
              </div>
            </div>
            <Textarea
              value={mgr.cloudSync.excludePatterns.join("\n")}
              onChange={(v) =>
                mgr.updateCloudSync({
                  excludePatterns: v
                    .split("\n")
                    .filter((p: string) => p.trim()),
                })
              }
              placeholder={"database:*\n*macros*"}
              rows={4}
              className="sor-settings-input font-mono"
            />
            <p className="text-xs text-[var(--color-textSecondary)]">
              Patterns and presets match artifact IDs or labels only; they do
              not select filesystem paths or filter archive contents.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default AdvancedSection;
