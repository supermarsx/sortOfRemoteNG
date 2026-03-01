import { Upload, Download, Zap } from "lucide-react";
import { Checkbox, NumberInput } from "../../../ui/forms";
import type { Mgr } from "./types";
import CollapsibleSection from "../../../ui/CollapsibleSection";
function AdvancedSection({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-4">
      <CollapsibleSection
        title="Advanced Options"
        icon={<Zap className="w-4 h-4" />}
        open={mgr.showAdvanced}
        onToggle={(v) => mgr.setShowAdvanced(v)}
      >
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox checked={mgr.cloudSync.compressionEnabled} onChange={(v: boolean) => mgr.updateCloudSync({ compressionEnabled: v })} className="w-4 h-4 rounded border-[var(--color-border)] bg-[var(--color-input)] text-blue-600" />
            <span className="text-sm text-[var(--color-text)]">
              Enable Compression
            </span>
          </label>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                Max File Size (MB)
              </label>
              <NumberInput value={mgr.cloudSync.maxFileSizeMB} onChange={(v: number) => mgr.updateCloudSync({
                    maxFileSizeMB: v,
                  })} className="sor-settings-input" min={1} max={500} />
            </div>

            <div>
              <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                <Upload className="w-3 h-3 inline mr-1" />
                Upload Limit (KB/s, 0=∞)
              </label>
              <NumberInput value={mgr.cloudSync.uploadLimitKBs} onChange={(v: number) => mgr.updateCloudSync({
                    uploadLimitKBs: v,
                  })} className="sor-settings-input" min={0} />
            </div>

            <div>
              <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
                <Download className="w-3 h-3 inline mr-1" />
                Download Limit (KB/s, 0=∞)
              </label>
              <NumberInput value={mgr.cloudSync.downloadLimitKBs} onChange={(v: number) => mgr.updateCloudSync({
                    downloadLimitKBs: v,
                  })} className="sor-settings-input" min={0} />
            </div>
          </div>

          <div>
            <label className="block text-xs text-[var(--color-textSecondary)] mb-1">
              Exclude Patterns (one per line)
            </label>
            <textarea
              value={mgr.cloudSync.excludePatterns.join("\n")}
              onChange={(e) =>
                mgr.updateCloudSync({
                  excludePatterns: e.target.value
                    .split("\n")
                    .filter((p) => p.trim()),
                })
              }
              placeholder="*.tmp&#10;*.bak&#10;temp/*"
              rows={3}
              className="sor-settings-input font-mono"
            />
          </div>
      </CollapsibleSection>
    </div>
  );
}

export default AdvancedSection;
