import React, { useState, useEffect } from "react";
import {
  WakeOnLanService,
  type WakeSchedule,
  type WakeRecurrence,
} from "../utils/wakeOnLan";
import {
  Trash2,
  Pencil,
  Save,
  X,
  Clock,
  Plus,
  Power,
  Calendar,
  Repeat,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Modal } from "./ui/Modal";

const wolService = new WakeOnLanService();

const toLocalInput = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);

const formatMac = (value: string): string => {
  const clean = value.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
  const pairs = clean.match(/.{1,2}/g) || [];
  return pairs.slice(0, 6).join(":");
};

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const WakeScheduleManager: React.FC<Props> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const [schedules, setSchedules] = useState<WakeSchedule[]>([]);
  const [editing, setEditing] = useState<WakeSchedule | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<WakeSchedule>({
    macAddress: "",
    wakeTime: toLocalInput(new Date()),
    port: 9,
  });

  useEffect(() => {
    if (isOpen) {
      setSchedules(wolService.listSchedules());
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showForm) {
          resetForm();
        } else {
          onClose();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, showForm, onClose]);

  if (!isOpen) return null;

  const resetForm = () => {
    setForm({ macAddress: "", wakeTime: toLocalInput(new Date()), port: 9 });
    setEditing(null);
    setShowForm(false);
  };

  const handleSubmit = () => {
    const date = new Date(form.wakeTime);
    if (editing) {
      wolService.cancelSchedule(editing);
    }
    const broadcast = form.broadcastAddress?.trim() || undefined;
    wolService.scheduleWakeUp(
      form.macAddress,
      date,
      broadcast,
      form.port,
      form.recurrence as WakeRecurrence | undefined,
    );
    setSchedules(wolService.listSchedules());
    resetForm();
  };

  const handleEdit = (s: WakeSchedule) => {
    setEditing(s);
    setForm({ ...s, wakeTime: toLocalInput(new Date(s.wakeTime)) });
    setShowForm(true);
  };

  const handleDelete = (s: WakeSchedule) => {
    wolService.cancelSchedule(s);
    setSchedules(wolService.listSchedules());
  };

  const getRecurrenceLabel = (recurrence?: string) => {
    switch (recurrence) {
      case "daily":
        return t("wake.daily", "Daily");
      case "weekly":
        return t("wake.weekly", "Weekly");
      default:
        return t("wake.once", "Once");
    }
  };

  const isSchedulePast = (wakeTime: string | Date) => {
    return new Date(wakeTime) < new Date();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      closeOnEscape={false}
      backdropClassName="bg-black/50 backdrop-blur-sm"
      panelClassName="relative max-w-xl rounded-xl overflow-hidden border border-[var(--color-border)]"
      contentClassName="relative bg-[var(--color-surface)]"
    >
      <div className="relative flex flex-1 min-h-0 flex-col">
        {/* Subtle glow effect */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute w-[200px] h-[150px] bg-orange-500/8 rounded-full blur-[80px] top-[20%] left-[15%]" />
          <div className="absolute w-[180px] h-[180px] bg-amber-500/6 rounded-full blur-[100px] bottom-[20%] right-[20%]" />
        </div>

        {/* Header */}
        <div className="relative z-10 flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-orange-500/20 rounded-lg">
              <Clock size={20} className="text-orange-500" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-text)]">
                {t("wake.scheduleManager", "Wake Schedule Manager")}
              </h2>
              <p className="text-xs text-[var(--color-textSecondary)]">
                Schedule automatic wake-up for devices
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[var(--color-surfaceHover)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="relative z-10 p-5">
          {/* Schedule List */}
          <div className="sor-selection-list max-h-60 overflow-y-auto mb-4">
            {schedules.map((s) => {
              const isPast = isSchedulePast(s.wakeTime) && !s.recurrence;
              return (
                <div
                  key={`${s.macAddress}-${s.wakeTime}-${s.broadcastAddress ?? ""}-${s.port}-${s.recurrence ?? ""}`}
                  className={`sor-selection-row cursor-default ${
                    isPast ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`p-2 rounded-lg ${isPast ? "bg-gray-500/20" : "bg-green-500/20"}`}
                    >
                      <Power
                        size={16}
                        className={
                          isPast
                            ? "text-[var(--color-textSecondary)]"
                            : "text-green-500"
                        }
                      />
                    </div>
                    <div>
                      <div className="text-sm font-mono text-[var(--color-text)]">
                        {s.macAddress}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
                        <Calendar size={10} />
                        <span>{new Date(s.wakeTime).toLocaleString()}</span>
                        {s.recurrence && (
                          <>
                            <Repeat size={10} className="ml-1" />
                            <span className="text-orange-400">
                              {getRecurrenceLabel(s.recurrence)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleEdit(s)}
                      className="p-2 text-[var(--color-textSecondary)] hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                      title="Edit schedule"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(s)}
                      className="p-2 text-[var(--color-textSecondary)] hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                      title="Delete schedule"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
            {schedules.length === 0 && !showForm && (
              <div className="text-center py-8 text-[var(--color-textMuted)]">
                <Clock size={32} className="mx-auto mb-3 opacity-50" />
                <p className="text-sm">
                  {t("wake.noSchedules", "No schedules configured")}
                </p>
                <p className="text-xs mt-1">
                  Click "New Schedule" to create one
                </p>
              </div>
            )}
          </div>

          {/* Add/Edit Form */}
          {showForm ? (
            <div className="space-y-3 p-4 bg-[var(--color-surfaceHover)]/30 rounded-lg border border-[var(--color-border)]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-[var(--color-text)]">
                  {editing ? "Edit Schedule" : "New Schedule"}
                </span>
                <button
                  onClick={resetForm}
                  className="text-xs text-[var(--color-textMuted)] hover:text-[var(--color-text)]"
                >
                  Cancel
                </button>
              </div>

              <div>
                <label className="sor-form-label-xs">MAC Address</label>
                <input
                  type="text"
                  placeholder="00:11:22:33:44:55"
                  className="sor-form-input font-mono"
                  value={form.macAddress}
                  onChange={(e) =>
                    setForm({ ...form, macAddress: formatMac(e.target.value) })
                  }
                />
              </div>

              <div>
                <label className="sor-form-label-xs">Wake Time</label>
                <input
                  type="datetime-local"
                  className="sor-form-input"
                  value={form.wakeTime}
                  onChange={(e) =>
                    setForm({ ...form, wakeTime: e.target.value })
                  }
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="sor-form-label-xs">Broadcast Address</label>
                  <input
                    type="text"
                    placeholder="255.255.255.255"
                    className="sor-form-input"
                    value={form.broadcastAddress ?? ""}
                    onChange={(e) =>
                      setForm({ ...form, broadcastAddress: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="sor-form-label-xs">UDP Port</label>
                  <input
                    type="number"
                    className="sor-form-input"
                    value={form.port}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        port: parseInt(e.target.value, 10) || 9,
                      })
                    }
                  />
                </div>
              </div>

              <div>
                <label className="sor-form-label-xs">Recurrence</label>
                <select
                  className="sor-form-select"
                  value={form.recurrence ?? ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      recurrence: e.target.value as WakeRecurrence,
                    })
                  }
                >
                  <option value="">{t("wake.once", "Once")}</option>
                  <option value="daily">{t("wake.daily", "Daily")}</option>
                  <option value="weekly">{t("wake.weekly", "Weekly")}</option>
                </select>
              </div>

              <button
                onClick={handleSubmit}
                disabled={!form.macAddress || form.macAddress.length < 17}
                className="w-full flex items-center justify-center space-x-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-[var(--color-text)] py-2.5 rounded-lg font-medium transition-colors shadow-lg shadow-orange-500/20 disabled:shadow-none"
              >
                <Save size={16} />
                <span>
                  {editing
                    ? t("common.save", "Save")
                    : t("common.add", "Add Schedule")}
                </span>
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowForm(true)}
              className="sor-option-chip w-full justify-center py-2.5 font-medium"
            >
              <Plus size={16} />
              <span>New Schedule</span>
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default WakeScheduleManager;
