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
    value: "temp",
    label: "Temp & backup files",
    patterns: ["*.tmp", "*.bak", "*.swp", "*.swo", "*~", "*.cache"],
  },
  {
    value: "os",
    label: "OS metadata files",
    patterns: [".DS_Store", "Thumbs.db", "desktop.ini", "$RECYCLE.BIN/*"],
  },
  {
    value: "logs",
    label: "Logs",
    patterns: ["*.log", "*.log.*", "logs/*"],
  },
  {
    value: "vcs",
    label: "Version control",
    patterns: [".git/*", ".svn/*", ".hg/*"],
  },
  {
    value: "build",
    label: "Build artifacts",
    patterns: [
      "node_modules/*",
      "dist/*",
      "build/*",
      "target/*",
      "*.pyc",
      "__pycache__/*",
    ],
  },
  {
    value: "secrets",
    label: "Secrets & env files",
    patterns: [".env", ".env.*", "*.pem", "*.key", "id_rsa", "id_ed25519"],
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
          icon={<FileArchive size={16} />}
          label="Enable Compression"
          description="Compress payloads before uploading to save bandwidth"
          checked={mgr.cloudSync.compressionEnabled}
          onChange={(v) => mgr.updateCloudSync({ compressionEnabled: v })}
          infoTooltip="Gzip-compress payloads before uploading. Reduces bandwidth at the cost of slightly more CPU per sync."
        />

        <SettingsNumberRow
          icon={<FileBox size={16} />}
          label="Max File Size"
          value={mgr.cloudSync.maxFileSizeMB}
          min={1}
          max={500}
          unit="MB"
          onChange={(v) => mgr.updateCloudSync({ maxFileSizeMB: v })}
          infoTooltip="Files larger than this are skipped during sync. Set generously high to allow large attachments."
        />

        <SettingsNumberRow
          icon={<Upload size={16} />}
          label="Upload Limit"
          value={mgr.cloudSync.uploadLimitKBs}
          min={0}
          unit="KB/s"
          onChange={(v) => mgr.updateCloudSync({ uploadLimitKBs: v })}
          infoTooltip="Throttle upload bandwidth in kilobytes per second. 0 means unlimited."
        />

        <SettingsNumberRow
          icon={<Download size={16} />}
          label="Download Limit"
          value={mgr.cloudSync.downloadLimitKBs}
          min={0}
          unit="KB/s"
          onChange={(v) => mgr.updateCloudSync({ downloadLimitKBs: v })}
          infoTooltip="Throttle download bandwidth in kilobytes per second. 0 means unlimited."
        />

        <div className="sor-settings-select-row !items-start">
          <span className="sor-settings-row-label flex items-center gap-1">
            <span className="text-[var(--color-textSecondary)] mr-1">
              <Filter size={16} />
            </span>
            Exclude Patterns
            <InfoTooltip text="Glob patterns (one per line) for files to skip during sync. Useful for temp files, caches, or local-only data." />
          </span>
          <div className="flex flex-col gap-2" style={{ width: "20rem" }}>
            <div className="flex items-center gap-2">
              <Plus size={14} className="text-[var(--color-textMuted)] flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <Select
                  value=""
                  onChange={applyPreset}
                  options={presetOptions}
                  variant="settings"
                  aria-label="Add an exclude-pattern preset"
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
              placeholder={"*.tmp\n*.bak\ntemp/*"}
              rows={4}
              className="sor-settings-input font-mono"
            />
          </div>
        </div>
      </Card>
    </div>
  );
}

export default AdvancedSection;
