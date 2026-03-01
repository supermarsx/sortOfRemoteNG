import { useState, useEffect, useCallback } from 'react';
import { WakeOnLanService, type WakeSchedule, type WakeRecurrence } from '../../utils/wakeOnLan';
import { useTranslation } from 'react-i18next';

const wolService = new WakeOnLanService();

const toLocalInput = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export const formatMac = (value: string): string => {
  const clean = value.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  const pairs = clean.match(/.{1,2}/g) || [];
  return pairs.slice(0, 6).join(':');
};

export function useWakeScheduleManager(isOpen: boolean, onClose: () => void) {
  const { t } = useTranslation();
  const [schedules, setSchedules] = useState<WakeSchedule[]>([]);
  const [editing, setEditing] = useState<WakeSchedule | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<WakeSchedule>({
    macAddress: '',
    wakeTime: toLocalInput(new Date()),
    port: 9,
  });

  useEffect(() => {
    if (isOpen) {
      setSchedules(wolService.listSchedules());
    }
  }, [isOpen]);

  const resetForm = useCallback(() => {
    setForm({ macAddress: '', wakeTime: toLocalInput(new Date()), port: 9 });
    setEditing(null);
    setShowForm(false);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showForm) {
          resetForm();
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, showForm, onClose, resetForm]);

  const handleSubmit = useCallback(() => {
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
    setForm({ macAddress: '', wakeTime: toLocalInput(new Date()), port: 9 });
    setEditing(null);
    setShowForm(false);
  }, [form, editing]);

  const handleEdit = useCallback((s: WakeSchedule) => {
    setEditing(s);
    setForm({ ...s, wakeTime: toLocalInput(new Date(s.wakeTime)) });
    setShowForm(true);
  }, []);

  const handleDelete = useCallback((s: WakeSchedule) => {
    wolService.cancelSchedule(s);
    setSchedules(wolService.listSchedules());
  }, []);

  const getRecurrenceLabel = useCallback(
    (recurrence?: string) => {
      switch (recurrence) {
        case 'daily':
          return t('wake.daily', 'Daily');
        case 'weekly':
          return t('wake.weekly', 'Weekly');
        default:
          return t('wake.once', 'Once');
      }
    },
    [t],
  );

  const isSchedulePast = useCallback((wakeTime: string | Date) => {
    return new Date(wakeTime) < new Date();
  }, []);

  return {
    t,
    schedules,
    editing,
    showForm,
    setShowForm,
    form,
    setForm,
    resetForm,
    handleSubmit,
    handleEdit,
    handleDelete,
    getRecurrenceLabel,
    isSchedulePast,
  };
}
