import { AlertTriangle } from "lucide-react";
import { ConflictResolutionStrategies, ConflictResolutionStrategy } from "../../../../types/settings";
import { conflictLabels, conflictDescriptions } from "../../../../hooks/settings/useCloudSyncSettings";
import { Select } from "../../../ui/forms";
import type { Mgr } from "./types";
function ConflictResolutionSection({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium text-[var(--color-textSecondary)]">
        <AlertTriangle className="w-4 h-4 inline mr-2" />
        Conflict Resolution
      </label>
      <Select value={mgr.cloudSync.conflictResolution} onChange={(v: string) =>
          mgr.updateCloudSync({
            conflictResolution: v as ConflictResolutionStrategy,
          })} options={[...ConflictResolutionStrategies.map((strategy) => ({ value: strategy, label: conflictLabels[strategy] }))]} className="sor-settings-input" />
      <p className="text-xs text-[var(--color-textSecondary)]">
        {conflictDescriptions[mgr.cloudSync.conflictResolution]}
      </p>
    </div>
  );
}

export default ConflictResolutionSection;
