import { useState } from "react";
import { Clock, Repeat } from "lucide-react";
import {
  CloudSyncFrequencies,
  CloudSyncFrequency,
  cloudSyncFrequencyLabels,
  MAX_CLOUD_SYNC_INTERVAL_MINUTES,
  normalizeCloudSyncIntervalMinutes,
  normalizeCloudSyncDebounceSeconds,
  resolveCloudSyncDebounce,
} from "../../../../types/settings/cloudSyncSettings";
import {
  Card,
  SettingsNumberRow,
  SettingsSectionHeader as SectionHeader,
  SettingsSelectRow,
  Toggle,
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
  const debounce = resolveCloudSyncDebounce(mgr.cloudSync);
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
        {mgr.cloudSync.frequency === "realtime" && (
          <>
            <Toggle
              settingKey="cloudSync.adaptiveSyncEnabled"
              label="Adaptive smart sync"
              checked={debounce.adaptive}
              onChange={(adaptiveSyncEnabled: boolean) =>
                mgr.updateCloudSync({ adaptiveSyncEnabled })
              }
              description="Five relevant saved changes within the last 3 minutes switch to a longer quiet period. Isolated edits use the baseline delay. Turn off to use fixed debouncing."
            />
            <SettingsNumberRow
              settingKey="cloudSync.realtimeDebounceSeconds"
              label="Realtime quiet period"
              description="Wait after the latest saved change. Used for isolated edits, or every edit when adaptive smart sync is off."
              value={debounce.quietMs / 1000}
              min={0.1}
              max={120}
              step={0.1}
              unit="seconds"
              onChange={(value) =>
                mgr.updateCloudSync({
                  realtimeDebounceSeconds: normalizeCloudSyncDebounceSeconds(
                    value,
                    3,
                  ),
                })
              }
            />
            {debounce.adaptive && (
              <SettingsNumberRow
                settingKey="cloudSync.adaptiveSyncQuietSeconds"
                label="Busy quiet period"
                description="After a burst, wait this long after the last saved change (at least the baseline delay). Defaults to 90 seconds."
                value={debounce.busyQuietMs / 1000}
                min={60}
                max={120}
                step={1}
                unit="seconds"
                onChange={(value) =>
                  mgr.updateCloudSync({
                    adaptiveSyncQuietSeconds: normalizeCloudSyncDebounceSeconds(
                      value,
                      90,
                      60,
                      120,
                    ),
                  })
                }
              />
            )}
          </>
        )}
        {mgr.cloudSync.frequency === "onSave" && (
          <SettingsNumberRow
            settingKey="cloudSync.onSaveDebounceSeconds"
            label="On-save quiet period"
            description="Wait after the latest saved change before syncing. Defaults to half a second."
            value={debounce.quietMs / 1000}
            min={0.1}
            max={120}
            step={0.1}
            unit="seconds"
            onChange={(value) =>
              mgr.updateCloudSync({
                onSaveDebounceSeconds: normalizeCloudSyncDebounceSeconds(
                  value,
                  0.5,
                ),
              })
            }
          />
        )}
        {["realtime", "onSave"].includes(mgr.cloudSync.frequency) && (
          <>
            <SettingsNumberRow
              settingKey="cloudSync.debounceMaxWaitSeconds"
              label="Maximum change wait"
              description="Continuous changes eventually sync at this limit, even before the quiet period ends. Realtime defaults to 10 minutes. Active syncs and the minimum pause take priority; concurrent edits are checked before applying data."
              value={debounce.maxWaitMs / 1000}
              min={1}
              max={3600}
              step={1}
              unit="seconds"
              onChange={(value) =>
                mgr.updateCloudSync({
                  debounceMaxWaitSeconds: normalizeCloudSyncDebounceSeconds(
                    value,
                    600,
                    1,
                    3600,
                  ),
                })
              }
            />
            <SettingsNumberRow
              settingKey="cloudSync.debounceMinIntervalSeconds"
              label="Minimum sync pause"
              description="Minimum pause after scheduled or manual activity before another automatic run. Manual sync remains available immediately."
              value={debounce.minIntervalMs / 1000}
              min={0}
              max={120}
              step={0.1}
              unit="seconds"
              onChange={(value) =>
                mgr.updateCloudSync({
                  debounceMinIntervalSeconds: normalizeCloudSyncDebounceSeconds(
                    value,
                    debounce.quietMs / 1000,
                    0,
                    120,
                  ),
                })
              }
            />
          </>
        )}
      </Card>
    </div>
  );
}

export default SyncFrequencySelect;
