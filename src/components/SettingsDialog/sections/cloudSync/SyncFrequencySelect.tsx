import { Clock } from "lucide-react";
import { CloudSyncFrequencies, CloudSyncFrequency } from "../../../../types/settings/settings";
import { frequencyLabels } from "../../../../hooks/settings/useCloudSyncSettings";
import { Select } from "../../../ui/forms";
import { SettingsSectionHeader as SectionHeader } from "../../../ui/settings/SettingsPrimitives";
import type { Mgr } from "./types";
function SyncFrequencySelect({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Clock className="w-4 h-4 text-primary" />}
        title="Sync Frequency"
      />
      <div className="sor-settings-card">
        <Select value={mgr.cloudSync.frequency} onChange={(v: string) =>
            mgr.updateCloudSync({
              frequency: v as CloudSyncFrequency,
            })} options={[...CloudSyncFrequencies.map((freq) => ({ value: freq, label: frequencyLabels[freq] }))]} className="sor-settings-input" />
      </div>
    </div>
  );
}

export default SyncFrequencySelect;
