import { useState } from "react";
import { Clock, Repeat } from "lucide-react";
import {
  CloudSyncFrequencies,
  CloudSyncFrequency,
  cloudSyncFrequencyLabels,
  MAX_CLOUD_SYNC_INTERVAL_MINUTES,
  normalizeCloudSyncIntervalMinutes,
} from "../../../../types/settings/cloudSyncSettings";
import {
  Card,
  SettingsNumberRow,
  SettingsSectionHeader as SectionHeader,
  SettingsSelectRow,
} from "../../../ui/settings/SettingsPrimitives";
import type { Mgr } from "./types";

const frequencyOptions = CloudSyncFrequencies.map((freq) => ({
  value: freq,
  label: cloudSyncFrequencyLabels[freq],
}));

const minutesPerUnit = { minutes: 1, hours: 60, days: 1440 } as const;
type IntervalUnit = keyof typeof minutesPerUnit;
const unitOptions = [
  { value: "minutes", label: "Minutes" },
  { value: "hours", label: "Hours" },
  { value: "days", label: "Days" },
];

function intervalUnit(minutes: number): IntervalUnit {
  if (minutes % minutesPerUnit.days === 0) return "days";
  if (minutes % minutesPerUnit.hours === 0) return "hours";
  return "minutes";
}

function SyncFrequencySelect({ mgr }: { mgr: Mgr }) {
  const intervalMinutes = normalizeCloudSyncIntervalMinutes(
    mgr.cloudSync.customIntervalMinutes,
  );
  const [preferredUnit, setPreferredUnit] = useState<IntervalUnit>(() =>
    intervalUnit(intervalMinutes),
  );
  // Imported or externally edited intervals must remain exactly representable.
  const unit =
    intervalMinutes % minutesPerUnit[preferredUnit] === 0
      ? preferredUnit
      : intervalUnit(intervalMinutes);
  const amount = intervalMinutes / minutesPerUnit[unit];
  const updateInterval = (value: number, nextUnit: IntervalUnit) => {
    if (!Number.isFinite(value)) return;
    const bounded = Math.min(
      MAX_CLOUD_SYNC_INTERVAL_MINUTES / minutesPerUnit[nextUnit],
      Math.max(1, Math.round(value)),
    );
    setPreferredUnit(nextUnit);
    mgr.updateCloudSync({
      customIntervalMinutes: bounded * minutesPerUnit[nextUnit],
    });
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Clock className="w-4 h-4 text-primary" />}
        title="Sync Frequency"
      />
      <Card>
        <SettingsSelectRow
          settingKey="cloudSync.frequency"
          icon={<Repeat size={16} />}
          label="Frequency"
          value={mgr.cloudSync.frequency}
          options={frequencyOptions}
          onChange={(v) =>
            mgr.updateCloudSync({
              frequency: v as CloudSyncFrequency,
              ...(v === "custom"
                ? { customIntervalMinutes: intervalMinutes }
                : {}),
            })
          }
          infoTooltip="How often the app syncs in the background. Set to manual to only sync on demand."
        />
        {mgr.cloudSync.frequency === "custom" && (
          <>
            <SettingsNumberRow
              settingKey="cloudSync.customIntervalMinutes"
              label="Custom Interval"
              description="Choose a whole number from 1 minute to 7 days."
              value={amount}
              min={1}
              max={MAX_CLOUD_SYNC_INTERVAL_MINUTES / minutesPerUnit[unit]}
              step={1}
              unit={unit}
              onChange={(value) => updateInterval(value, unit)}
            />
            <SettingsSelectRow
              settingKey="cloudSync.customIntervalUnit"
              label="Interval Unit"
              value={unit}
              options={unitOptions}
              onChange={(value) =>
                updateInterval(amount, value as IntervalUnit)
              }
            />
          </>
        )}
      </Card>
    </div>
  );
}

export default SyncFrequencySelect;
