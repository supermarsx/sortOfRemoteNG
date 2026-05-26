import { AlertTriangle, GitMerge } from "lucide-react";
import {
  ConflictResolutionStrategies,
  ConflictResolutionStrategy,
} from "../../../../types/settings/settings";
import {
  conflictLabels,
  conflictDescriptions,
} from "../../../../hooks/settings/useCloudSyncSettings";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  SettingsSelectRow,
} from "../../../ui/settings/SettingsPrimitives";
import type { Mgr } from "./types";

const strategyOptions = ConflictResolutionStrategies.map((strategy) => ({
  value: strategy,
  label: conflictLabels[strategy],
}));

function ConflictResolutionSection({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<AlertTriangle className="w-4 h-4 text-primary" />}
        title="Conflict Resolution"
      />
      <Card>
        <SettingsSelectRow
          icon={<GitMerge size={16} />}
          label="Strategy"
          value={mgr.cloudSync.conflictResolution}
          options={strategyOptions}
          onChange={(v) =>
            mgr.updateCloudSync({
              conflictResolution: v as ConflictResolutionStrategy,
            })
          }
          infoTooltip="How to reconcile when the local copy and the cloud copy have both changed since the last sync."
        />
        <p className="text-xs text-[var(--color-textSecondary)] mt-1 ml-7">
          {conflictDescriptions[mgr.cloudSync.conflictResolution]}
        </p>
      </Card>
    </div>
  );
}

export default ConflictResolutionSection;
