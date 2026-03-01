import React from "react";
import { Clock } from "lucide-react";
import { BackupFrequencies, DaysOfWeek, BackupFrequency, DayOfWeek } from "../../../../types/settings";
import { frequencyLabels, dayLabels } from "../../../../hooks/settings/useBackupSettings";
import { Select } from "../../../ui/forms";

const ScheduleSection: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <div className="space-y-4">
    <h4 className="sor-section-heading">
      <Clock className="w-4 h-4 text-blue-400" />
      Schedule
    </h4>

    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-2">
        <label className="block text-sm text-[var(--color-textSecondary)]">
          Frequency
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
              Time
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
            Day of Week
          </label>
          <Select value={mgr.backup.weeklyDay} onChange={(v: string) =>
              mgr.updateBackup({ weeklyDay: v as DayOfWeek })} options={[...DaysOfWeek.map((day) => ({ value: day, label: dayLabels[day] }))]} className="sor-settings-input" />
        </div>
      )}

      {mgr.backup.frequency === "monthly" && (
        <div className="space-y-2">
          <label className="block text-sm text-[var(--color-textSecondary)]">
            Day of Month
          </label>
          <Select value={mgr.backup.monthlyDay} onChange={(v: string) =>
              mgr.updateBackup({ monthlyDay: parseInt(v) })} options={[...Array.from({ length: 28 }, (_, i) => i + 1).map((day) => ({ value: day, label: day }))]} className="sor-settings-input" />
        </div>
      )}
    </div>
  </div>
);

export default ScheduleSection;
