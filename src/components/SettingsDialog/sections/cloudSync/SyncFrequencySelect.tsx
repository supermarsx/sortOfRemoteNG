import { Clock, Repeat } from "lucide-react";
import {
  CloudSyncFrequencies,
  CloudSyncFrequency,
} from "../../../../types/settings/settings";
import { frequencyLabels } from "../../../../hooks/settings/useCloudSyncSettings";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  SettingsSelectRow,
} from "../../../ui/settings/SettingsPrimitives";
import type { Mgr } from "./types";

const frequencyOptions = CloudSyncFrequencies.map((freq) => ({
  value: freq,
  label: frequencyLabels[freq],
}));

function SyncFrequencySelect({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Clock className="w-4 h-4 text-primary" />}
        title="Sync Frequency"
      />
      <Card>
        <SettingsSelectRow
          icon={<Repeat size={16} />}
          label="Frequency"
          value={mgr.cloudSync.frequency}
          options={frequencyOptions}
          onChange={(v) =>
            mgr.updateCloudSync({ frequency: v as CloudSyncFrequency })
          }
          infoTooltip="How often the app syncs in the background. Set to manual to only sync on demand."
        />
      </Card>
    </div>
  );
}

export default SyncFrequencySelect;
