import { Clock } from "lucide-react";
import { CloudSyncFrequencies, CloudSyncFrequency } from "../../../../types/settings";
import { frequencyLabels } from "../../../../hooks/settings/useCloudSyncSettings";
import { Select } from "../../../ui/forms";
import type { Mgr } from "./types";
function SyncFrequencySelect({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium text-[var(--color-textSecondary)]">
        <Clock className="w-4 h-4 inline mr-2" />
        Sync Frequency
      </label>
      <Select value={mgr.cloudSync.frequency} onChange={(v: string) =>
          mgr.updateCloudSync({
            frequency: v as CloudSyncFrequency,
          })} options={[...CloudSyncFrequencies.map((freq) => ({ value: freq, label: frequencyLabels[freq] }))]} className="sor-settings-input" />
    </div>
  );
}

export default SyncFrequencySelect;
