import { AlertTriangle } from "lucide-react";
import { ConflictResolutionStrategies, ConflictResolutionStrategy } from "../../../../types/settings/settings";
import { conflictLabels, conflictDescriptions } from "../../../../hooks/settings/useCloudSyncSettings";
import { Select } from "../../../ui/forms";
import { SettingsSectionHeader as SectionHeader } from "../../../ui/settings/SettingsPrimitives";
import type { Mgr } from "./types";
function ConflictResolutionSection({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<AlertTriangle className="w-4 h-4 text-primary" />}
        title="Conflict Resolution"
      />
      <div className="sor-settings-card">
        <Select value={mgr.cloudSync.conflictResolution} onChange={(v: string) =>
            mgr.updateCloudSync({
              conflictResolution: v as ConflictResolutionStrategy,
            })} options={[...ConflictResolutionStrategies.map((strategy) => ({ value: strategy, label: conflictLabels[strategy] }))]} className="sor-settings-input" />
        <p className="text-xs text-[var(--color-textSecondary)]">
          {conflictDescriptions[mgr.cloudSync.conflictResolution]}
        </p>
      </div>
    </div>
  );
}

export default ConflictResolutionSection;
