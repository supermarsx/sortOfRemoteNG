import type { Mgr } from './types';
import React from "react";
import { Clock } from "lucide-react";
import { BackupFrequencies, DaysOfWeek, BackupFrequency, DayOfWeek } from "../../../../types/settings/settings";
import { frequencyLabels, dayLabels } from "../../../../hooks/settings/useBackupSettings";
import { Select } from "../../../ui/forms";
import { InfoTooltip } from "../../../ui/InfoTooltip";

const ScheduleSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-4">
    <h4 className="sor-section-heading">
      <Clock className="w-4 h-4 text-primary" />
      Schedule
    </h4>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-2">
        <label className="block text-sm text-[var(--color-textSecondary)]">
          Frequency <InfoTooltip text="How often automatic backups are created. Choose manual to only back up on demand." />
        </label>
        <Select value={mgr.backup.frequency} onChange={(v: string) =>
            mgr.updateBackup({
              frequency: v as BackupFrequency,
            })} options={[...BackupFrequencies.map((freq) => ({ value: freq, label: frequencyLabels[freq] }))]} className="sor-settings-input" />
      </div>

      {mgr.backup.frequency !== "manual" &&
        mgr.backup.frequency !== "hourly" && (
          <div className="space-y-2">
            <label className="block text-sm text-[var(--color-textSecondary)]">
              Time <InfoTooltip text="The time of day when the scheduled backup will run." />
            </label>
            <input
              type="time"
              value={mgr.backup.scheduledTime}
              onChange={(e) =>
                mgr.updateBackup({ scheduledTime: e.target.value })
              }
              className="sor-settings-input"
            />
          </div>
        )}

      {mgr.backup.frequency === "weekly" && (
        <div className="space-y-2">
          <label className="block text-sm text-[var(--color-textSecondary)]">
            Day of Week <InfoTooltip text="The day of the week on which the weekly backup will run." />
          </label>
          <Select value={mgr.backup.weeklyDay} onChange={(v: string) =>
              mgr.updateBackup({ weeklyDay: v as DayOfWeek })} options={[...DaysOfWeek.map((day) => ({ value: day, label: dayLabels[day] }))]} className="sor-settings-input" />
        </div>
      )}

      {mgr.backup.frequency === "monthly" && (
        <div className="space-y-2">
          <label className="block text-sm text-[var(--color-textSecondary)]">
            Day of Month <InfoTooltip text="The day of the month on which the monthly backup will run." />
          </label>
          <Select value={mgr.backup.monthlyDay} onChange={(v: string) =>
              mgr.updateBackup({ monthlyDay: parseInt(v) })} options={[...Array.from({ length: 28 }, (_, i) => i + 1).map((day) => ({ value: day, label: String(day) }))]} className="sor-settings-input" />
        </div>
      )}
    </div>
  </div>
);

export default ScheduleSection;
