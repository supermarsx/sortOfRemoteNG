import React, { useState, useEffect } from "react";
import {
  WakeOnLanService,
  type WakeSchedule,
  type WakeRecurrence,
} from "../utils/wakeOnLan";
import { Trash2, Pencil, Save, X, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";

const wolService = new WakeOnLanService();

const toLocalInput = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const WakeScheduleManager: React.FC<Props> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const [schedules, setSchedules] = useState<WakeSchedule[]>([]);
  const [editing, setEditing] = useState<WakeSchedule | null>(null);
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

  if (!isOpen) return null;

  const resetForm = () => {
    setForm({ macAddress: "", wakeTime: toLocalInput(new Date()), port: 9 });
    setEditing(null);
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
  };

  const handleDelete = (s: WakeSchedule) => {
    wolService.cancelSchedule(s);
    setSchedules(wolService.listSchedules());
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-[var(--color-surface)] rounded-xl shadow-xl p-5 w-full max-w-xl border border-[var(--color-border)]">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-orange-500/20 rounded-lg">
              <Clock size={16} className="text-orange-500" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">{t("wake.scheduleManager")}</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[var(--color-surfaceHover)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-2 max-h-60 overflow-y-auto mb-4">
          {schedules.map((s) => (
            <div
              key={`${s.macAddress}-${s.wakeTime}-${s.broadcastAddress ?? ""}-${s.port}-${s.recurrence ?? ""}`}
              className="flex justify-between items-center bg-gray-700 px-2 py-1 rounded"
            >
              <div className="text-sm">
                <div>{s.macAddress}</div>
                <div className="text-gray-300">
                  {new Date(s.wakeTime).toLocaleString()}{" "}
                  {s.recurrence && `(${s.recurrence})`}
                </div>
              </div>
              <div className="space-x-2">
                <button
                  onClick={() => handleEdit(s)}
                  className="text-blue-400 hover:text-blue-200"
                >
                  <Pencil size={16} />
                </button>
                <button
                  onClick={() => handleDelete(s)}
                  className="text-red-400 hover:text-red-200"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
          {schedules.length === 0 && (
            <div className="text-center text-gray-400">
              {t("wake.noSchedules")}
            </div>
          )}
        </div>
        <div className="space-y-2">
          <input
            type="text"
            placeholder="MAC Address"
            className="w-full px-2 py-1 rounded bg-gray-700 text-white"
            value={form.macAddress}
            onChange={(e) => setForm({ ...form, macAddress: e.target.value })}
          />
          <input
            type="datetime-local"
            className="w-full px-2 py-1 rounded bg-gray-700 text-white"
            value={form.wakeTime}
            onChange={(e) => setForm({ ...form, wakeTime: e.target.value })}
          />
          <input
            type="text"
            placeholder="Broadcast Address"
            className="w-full px-2 py-1 rounded bg-gray-700 text-white"
            value={form.broadcastAddress ?? ""}
            onChange={(e) =>
              setForm({ ...form, broadcastAddress: e.target.value })
            }
          />
          <input
            type="number"
            className="w-full px-2 py-1 rounded bg-gray-700 text-white"
            value={form.port}
            onChange={(e) =>
              setForm({ ...form, port: parseInt(e.target.value, 10) })
            }
          />
          <select
            className="w-full px-2 py-1 rounded bg-gray-700 text-white"
            value={form.recurrence ?? ""}
            onChange={(e) =>
              setForm({ ...form, recurrence: e.target.value as WakeRecurrence })
            }
          >
            <option value="">{t("wake.once")}</option>
            <option value="daily">{t("wake.daily")}</option>
            <option value="weekly">{t("wake.weekly")}</option>
          </select>
          <button
            onClick={handleSubmit}
            className="w-full flex items-center justify-center space-x-1 bg-blue-600 hover:bg-blue-500 text-white py-1 rounded"
          >
            <Save size={16} />
            <span>{editing ? t("common.save") : t("common.add")}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default WakeScheduleManager;
