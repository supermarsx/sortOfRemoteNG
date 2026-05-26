import { Upload, Download, Zap, FileBox, Filter, FileArchive } from "lucide-react";
import { Textarea } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
  SettingsNumberRow,
} from "../../../ui/settings/SettingsPrimitives";
import type { Mgr } from "./types";

function AdvancedSection({ mgr }: { mgr: Mgr }) {
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
          <div style={{ width: "20rem" }}>
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
              rows={3}
              className="sor-settings-input font-mono"
            />
          </div>
        </div>
      </Card>
    </div>
  );
}

export default AdvancedSection;
