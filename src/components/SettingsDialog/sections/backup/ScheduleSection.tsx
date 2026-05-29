import type { Mgr } from './types';
import React from "react";
import { Clock, Repeat, Calendar, CalendarDays } from "lucide-react";
import {
  BackupFrequencies,
  DaysOfWeek,
  BackupFrequency,
  DayOfWeek,
} from "../../../../types/settings/settings";
import {
  frequencyLabels,
  dayLabels,
} from "../../../../hooks/settings/useBackupSettings";
import { InfoTooltip } from "../../../ui/InfoTooltip";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  SettingsSelectRow,
} from "../../../ui/settings/SettingsPrimitives";

const frequencyOptions = BackupFrequencies.map((freq) => ({
  value: freq,
  label: frequencyLabels[freq],
}));

const dayOfWeekOptions = DaysOfWeek.map((day) => ({
  value: day,
  label: dayLabels[day],
}));

const dayOfMonthOptions = Array.from({ length: 28 }, (_, i) => i + 1).map(
  (day) => ({ value: String(day), label: String(day) }),
);

const ScheduleSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => {
  const showTime =
    mgr.backup.frequency !== "manual" &&
    mgr.backup.frequency !== "hourly";
  const showWeekly = mgr.backup.frequency === "weekly";
  const showMonthly = mgr.backup.frequency === "monthly";

  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Clock className="w-4 h-4 text-primary" />}
        title="Schedule"
      />

      <Card>
        <SettingsSelectRow
          icon={<Repeat size={16} />}
          label="Frequency"
          value={mgr.backup.frequency}
          options={frequencyOptions}
          onChange={(v) =>
            mgr.updateBackup({ frequency: v as BackupFrequency })
          }
          infoTooltip="How often automatic backups are created. Choose manual to only back up on demand."
        />

        <div
          className={`flex flex-col gap-2.5 ${
            showTime ? "" : "opacity-50 pointer-events-none"
          }`}
        >
          <div className="sor-settings-select-row">
            <span className="sor-settings-row-label flex items-center gap-1">
              <span className="text-[var(--color-textSecondary)] mr-1">
                <Clock size={16} />
              </span>
              Time
              <InfoTooltip text="The time of day when the scheduled backup will run (local time)." />
            </span>
            <input
              type="time"
              value={mgr.backup.scheduledTime}
              onChange={(e) =>
                mgr.updateBackup({ scheduledTime: e.target.value })
              }
              className="sor-settings-input"
              style={{ width: "9rem" }}
              disabled={!showTime}
            />
          </div>
        </div>

        <div
          className={`flex flex-col gap-2.5 ${
            showWeekly ? "" : "opacity-50 pointer-events-none"
          }`}
        >
          <SettingsSelectRow
            icon={<Calendar size={16} />}
            label="Day of Week"
            value={mgr.backup.weeklyDay}
            options={dayOfWeekOptions}
            onChange={(v) =>
              mgr.updateBackup({ weeklyDay: v as DayOfWeek })
            }
            infoTooltip="The day of the week on which the weekly backup will run."
          />
        </div>

        <div
          className={`flex flex-col gap-2.5 ${
            showMonthly ? "" : "opacity-50 pointer-events-none"
          }`}
        >
          <SettingsSelectRow
            icon={<CalendarDays size={16} />}
            label="Day of Month"
            value={String(mgr.backup.monthlyDay)}
            options={dayOfMonthOptions}
            onChange={(v) =>
              mgr.updateBackup({ monthlyDay: parseInt(v, 10) })
            }
            infoTooltip="The day of the month on which the monthly backup will run. Capped at 28 to avoid skipped months."
          />
        </div>
      </Card>
    </div>
  );
};

export default ScheduleSection;
