import React, { useState, useEffect } from "react";
import {
  WakeOnLanService,
  type WakeSchedule,
  type WakeRecurrence,
} from "../utils/wakeOnLan";
import { Trash2, Pencil, Save, X } from "lucide-react";
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
    wolService.scheduleWakeUp(
      form.macAddress,
      date,
      form.broadcastAddress,
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
      <div className="bg-gray-800 rounded-lg p-4 w-full max-w-xl">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">{t("wake.scheduleManager")}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>
        <div className="space-y-2 max-h-60 overflow-y-auto mb-4">
          {schedules.map((s) => (
            <div
              key={s.wakeTime + s.macAddress}
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
