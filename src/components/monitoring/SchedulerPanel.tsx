import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Calendar,
  Clock,
  Play,
  Pause,
  Plus,
  Trash2,
  Edit3,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Timer,
  ListChecks,
  History,
  Zap,
  Settings,
} from "lucide-react";
import { useScheduler } from "../../hooks/monitoring/useScheduler";
import type {
  ScheduledTask,
  TaskKind,
  TaskHistoryEntry,
  UpcomingTask,
} from "../../types/scheduler";

// ─── Props ───────────────────────────────────────────────────────────

export interface SchedulerPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────

type TabId = "tasks" | "upcoming" | "history";

const TASK_KIND_COLORS: Record<TaskKind, string> = {
  script: "bg-purple-500/20 text-purple-300",
  backup: "bg-blue-500/20 text-blue-300",
  health_check: "bg-green-500/20 text-green-300",
  connect: "bg-cyan-500/20 text-cyan-300",
  disconnect: "bg-orange-500/20 text-orange-300",
  wake_on_lan: "bg-yellow-500/20 text-yellow-300",
  notification: "bg-pink-500/20 text-pink-300",
  custom: "bg-gray-500/20 text-gray-300",
  connection_test: "bg-teal-500/20 text-teal-300",
};

const CRON_PRESETS = [
  { label: "Every minute", cron: "* * * * *" },
  { label: "Every 5 minutes", cron: "*/5 * * * *" },
  { label: "Every hour", cron: "0 * * * *" },
  { label: "Daily at midnight", cron: "0 0 * * *" },
  { label: "Daily at 6 AM", cron: "0 6 * * *" },
  { label: "Weekly (Sun midnight)", cron: "0 0 * * 0" },
  { label: "Monthly (1st midnight)", cron: "0 0 1 * *" },
];

const AVAILABLE_KINDS: TaskKind[] = [
  "script",
  "backup",
  "health_check",
  "connect",
  "disconnect",
  "wake_on_lan",
  "notification",
  "custom",
];

// ─── Helpers ─────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

function timeUntil(dateStr: string): string {
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return "now";
  if (diff < 60_000) return `${Math.ceil(diff / 1000)}s`;
  if (diff < 3_600_000) return `${Math.ceil(diff / 60_000)}m`;
  if (diff < 86_400_000) {
    const h = Math.floor(diff / 3_600_000);
    const m = Math.round((diff % 3_600_000) / 60_000);
    return `${h}h ${m}m`;
  }
  return `${Math.round(diff / 86_400_000)}d`;
}

function kindBadge(kind: TaskKind): string {
  return TASK_KIND_COLORS[kind] ?? TASK_KIND_COLORS.custom;
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

// ─── Tab Button ──────────────────────────────────────────────────────

const TabButton: React.FC<{
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}> = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    className={`sor-tab-btn flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors ${
      active
        ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
        : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] border border-transparent"
    }`}
  >
    {icon}
    {label}
  </button>
);

// ─── Task Form (Add / Edit) ─────────────────────────────────────────

interface TaskFormState {
  name: string;
  kind: TaskKind;
  cronExpression: string;
  description: string;
  connectionIds: string;
  timeoutMs: number;
  maxRetries: number;
  enabled: boolean;
}

const EMPTY_FORM: TaskFormState = {
  name: "",
  kind: "script",
  cronExpression: "",
  description: "",
  connectionIds: "",
  timeoutMs: 30_000,
  maxRetries: 0,
  enabled: true,
};

function taskToForm(t: ScheduledTask): TaskFormState {
  return {
    name: t.name,
    kind: t.kind,
    cronExpression: t.cronExpression ?? "",
    description: t.description,
    connectionIds: t.connectionIds.join(", "),
    timeoutMs: t.timeoutMs,
    maxRetries: t.maxRetries,
    enabled: t.enabled,
  };
}

// ─── Main Component ──────────────────────────────────────────────────

export const SchedulerPanel: React.FC<SchedulerPanelProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const sched = useScheduler();

  const [tab, setTab] = useState<TabId>("tasks");
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<TaskFormState>(EMPTY_FORM);
  const [cronPreview, setCronPreview] = useState<string[]>([]);
  const [cronError, setCronError] = useState<string | null>(null);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [lastOutputs, setLastOutputs] = useState<Record<string, string>>({});

  // ── Bootstrap ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    sched.fetchTasks();
    sched.fetchStats();
    sched.fetchUpcoming(20);
    sched.fetchHistory();
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cron validation ──────────────────────────────────────────────
  useEffect(() => {
    if (!form.cronExpression) {
      setCronPreview([]);
      setCronError(null);
      return;
    }
    const id = setTimeout(async () => {
      const v = await sched.validateCron(form.cronExpression);
      if (v?.valid) {
        setCronError(null);
        const occ = await sched.getNextOccurrences(form.cronExpression, 5);
        setCronPreview(occ);
      } else {
        setCronError(v?.errorMessage ?? "Invalid expression");
        setCronPreview([]);
      }
    }, 400);
    return () => clearTimeout(id);
  }, [form.cronExpression]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Callbacks ────────────────────────────────────────────────────
  const openAdd = useCallback(() => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setCronPreview([]);
    setCronError(null);
    setShowModal(true);
  }, []);

  const openEdit = useCallback((task: ScheduledTask) => {
    setEditingId(task.id);
    setForm(taskToForm(task));
    setCronPreview([]);
    setCronError(null);
    setShowModal(true);
  }, []);

  const handleSave = useCallback(async () => {
    const payload = {
      name: form.name,
      description: form.description,
      kind: form.kind,
      scheduleType: "cron" as const,
      cronExpression: form.cronExpression || null,
      intervalMs: null,
      scheduledAt: null,
      enabled: form.enabled,
      connectionIds: form.connectionIds
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      payload: {},
      tags: [],
      maxRetries: form.maxRetries,
      retryDelayMs: 5000,
      timeoutMs: form.timeoutMs,
    };
    if (editingId) {
      await sched.updateTask(editingId, payload);
    } else {
      await sched.addTask(payload);
    }
    setShowModal(false);
  }, [form, editingId, sched]);

  const toggleExpand = useCallback(
    async (taskId: string) => {
      if (expandedTask === taskId) {
        setExpandedTask(null);
        return;
      }
      setExpandedTask(taskId);
      if (!lastOutputs[taskId]) {
        const hist = await sched.fetchHistory(taskId);
        if (hist.length > 0) {
          setLastOutputs((prev) => ({
            ...prev,
            [taskId]: hist[0].output ?? "No output recorded.",
          }));
        }
      }
    },
    [expandedTask, lastOutputs, sched],
  );

  // ── Derived ──────────────────────────────────────────────────────
  const statsData = sched.stats;
  const totalTasks = statsData?.totalTasks ?? sched.tasks.length;
  const activeTasks = statsData?.enabledTasks ?? sched.tasks.filter((t) => t.enabled).length;
  const pausedTasks = totalTasks - activeTasks;

  // ── Guard ────────────────────────────────────────────────────────
  if (!isOpen) return null;

  // ── Render helpers ───────────────────────────────────────────────
  const renderTaskCard = (task: ScheduledTask) => {
    const isExpanded = expandedTask === task.id;
    const lastSuccess = task.failCount < task.runCount;
    return (
      <div
        key={task.id}
        className="sor-sched-task-card rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 mb-2"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium text-[var(--color-text)] truncate">
                {task.name}
              </span>
              <span className={`px-1.5 py-0.5 text-[10px] rounded-full font-medium ${kindBadge(task.kind)}`}>
                {task.kind}
              </span>
              {!task.enabled && (
                <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-gray-500/20 text-gray-400 font-medium">
                  {t("scheduler.paused", "paused")}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-[11px] text-[var(--color-text-secondary)]">
              {task.cronExpression && (
                <span className="flex items-center gap-1" title="Cron">
                  <Clock size={11} /> {task.cronExpression}
                </span>
              )}
              <span className="flex items-center gap-1" title="Next run">
                <Timer size={11} /> {fmtDate(task.nextRun)}
              </span>
              <span>
                {t("scheduler.runs", "Runs")}: {task.runCount}
              </span>
              {task.runCount > 0 && (
                <span className={`flex items-center gap-0.5 ${lastSuccess ? "text-green-400" : "text-red-400"}`}>
                  {lastSuccess ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
                  {lastSuccess
                    ? t("scheduler.lastOk", "Last OK")
                    : t("scheduler.lastFail", "Last failed")}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => (task.enabled ? sched.disableTask(task.id) : sched.enableTask(task.id))}
              className="sor-sched-toggle p-1 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
              title={task.enabled ? t("scheduler.disable", "Disable") : t("scheduler.enable", "Enable")}
            >
              {task.enabled ? <Pause size={14} className="text-yellow-400" /> : <Play size={14} className="text-green-400" />}
            </button>
            <button
              onClick={() => sched.executeNow(task.id)}
              className="sor-sched-run p-1 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
              title={t("scheduler.runNow", "Run now")}
            >
              <Zap size={14} className="text-blue-400" />
            </button>
            <button
              onClick={() => openEdit(task)}
              className="sor-sched-edit p-1 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
              title={t("common.edit", "Edit")}
            >
              <Edit3 size={14} className="text-[var(--color-text-secondary)]" />
            </button>
            <button
              onClick={() => sched.removeTask(task.id)}
              className="sor-sched-delete p-1 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
              title={t("common.delete", "Delete")}
            >
              <Trash2 size={14} className="text-red-400" />
            </button>
            <button
              onClick={() => toggleExpand(task.id)}
              className="p-1 rounded hover:bg-[var(--color-bg-hover)] transition-colors"
              title={t("scheduler.details", "Details")}
            >
              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </div>
        {isExpanded && (
          <div className="sor-sched-detail mt-2 pt-2 border-t border-[var(--color-border)]">
            <p className="text-[11px] text-[var(--color-text-secondary)] mb-1">
              {task.description || t("scheduler.noDesc", "No description.")}
            </p>
            <pre className="text-[10px] font-mono bg-[var(--color-bg)] p-2 rounded max-h-32 overflow-auto text-[var(--color-text-secondary)]">
              {lastOutputs[task.id] ?? t("scheduler.noOutput", "No output available.")}
            </pre>
          </div>
        )}
      </div>
    );
  };

  const renderUpcoming = () => {
    if (sched.upcoming.length === 0) {
      return (
        <div className="sor-sched-empty flex flex-col items-center justify-center py-12 text-[var(--color-text-secondary)]">
          <Calendar size={32} className="mb-2 opacity-40" />
          <p className="text-sm">{t("scheduler.noUpcoming", "No upcoming executions.")}</p>
        </div>
      );
    }
    return (
      <div className="sor-sched-upcoming space-y-1">
        {sched.upcoming.map((u: UpcomingTask, i: number) => (
          <div
            key={`${u.taskId}-${i}`}
            className="flex items-center justify-between px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]"
          >
            <div className="flex items-center gap-2">
              <span className={`px-1.5 py-0.5 text-[10px] rounded-full font-medium ${kindBadge(u.kind)}`}>
                {u.kind}
              </span>
              <span className="text-xs text-[var(--color-text)]">{u.taskName}</span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-[var(--color-text-secondary)]">
              <span>{fmtDate(u.nextRunAt)}</span>
              <span className="font-mono text-blue-400">{timeUntil(u.nextRunAt)}</span>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderHistory = () => {
    if (sched.history.length === 0) {
      return (
        <div className="sor-sched-empty flex flex-col items-center justify-center py-12 text-[var(--color-text-secondary)]">
          <History size={32} className="mb-2 opacity-40" />
          <p className="text-sm">{t("scheduler.noHistory", "No execution history yet.")}</p>
        </div>
      );
    }
    return (
      <div className="sor-sched-history overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[var(--color-text-secondary)] border-b border-[var(--color-border)]">
              <th className="pb-2 pr-3">{t("scheduler.time", "Time")}</th>
              <th className="pb-2 pr-3">{t("scheduler.task", "Task")}</th>
              <th className="pb-2 pr-3">{t("scheduler.duration", "Duration")}</th>
              <th className="pb-2 pr-3">{t("scheduler.result", "Result")}</th>
              <th className="pb-2">{t("scheduler.output", "Output")}</th>
            </tr>
          </thead>
          <tbody>
            {sched.history.map((h: TaskHistoryEntry) => (
              <tr key={h.id} className="border-b border-[var(--color-border)]/50 hover:bg-[var(--color-bg-hover)]">
                <td className="py-1.5 pr-3 text-[var(--color-text-secondary)] whitespace-nowrap">
                  {fmtDate(h.startedAt)}
                </td>
                <td className="py-1.5 pr-3 text-[var(--color-text)]">{h.taskName}</td>
                <td className="py-1.5 pr-3 font-mono text-[var(--color-text-secondary)]">
                  {formatDuration(h.durationMs)}
                </td>
                <td className="py-1.5 pr-3">
                  {h.status === "completed" && (
                    <span className="flex items-center gap-1 text-green-400">
                      <CheckCircle2 size={12} /> {t("scheduler.success", "success")}
                    </span>
                  )}
                  {h.status === "failed" && (
                    <span className="flex items-center gap-1 text-red-400">
                      <XCircle size={12} /> {t("scheduler.failure", "failure")}
                    </span>
                  )}
                  {h.status === "cancelled" && (
                    <span className="flex items-center gap-1 text-yellow-400">
                      <AlertCircle size={12} /> {t("scheduler.cancelled", "cancelled")}
                    </span>
                  )}
                  {!["completed", "failed", "cancelled"].includes(h.status) && (
                    <span className="text-[var(--color-text-secondary)]">{h.status}</span>
                  )}
                </td>
                <td className="py-1.5 max-w-[200px] truncate font-mono text-[10px] text-[var(--color-text-secondary)]">
                  {h.output ?? h.errorMessage ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  // ── Modal ────────────────────────────────────────────────────────
  const renderModal = () => {
    if (!showModal) return null;
    return (
      <div className="sor-sched-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="sor-sched-modal w-full max-w-lg rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl">
          <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)]">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">
              {editingId
                ? t("scheduler.editTask", "Edit Task")
                : t("scheduler.addTask", "Add Task")}
            </h3>
            <button
              onClick={() => setShowModal(false)}
              className="text-[var(--color-text-secondary)] hover:text-[var(--color-text)] text-lg leading-none"
            >
              ×
            </button>
          </div>
          <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
            {/* Name */}
            <label className="block text-[11px] text-[var(--color-text-secondary)]">
              {t("scheduler.name", "Name")}
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="mt-1 w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)]"
              />
            </label>
            {/* Kind */}
            <label className="block text-[11px] text-[var(--color-text-secondary)]">
              {t("scheduler.type", "Type")}
              <select
                value={form.kind}
                onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as TaskKind }))}
                className="mt-1 w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)]"
              >
                {AVAILABLE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </label>
            {/* Cron */}
            <label className="block text-[11px] text-[var(--color-text-secondary)]">
              {t("scheduler.cron", "Cron Expression")}
              <input
                type="text"
                value={form.cronExpression}
                onChange={(e) => setForm((f) => ({ ...f, cronExpression: e.target.value }))}
                placeholder="* * * * *"
                className={`mt-1 w-full px-3 py-1.5 text-xs rounded-lg border bg-[var(--color-bg)] text-[var(--color-text)] ${
                  cronError
                    ? "border-red-500/60"
                    : "border-[var(--color-border)]"
                }`}
              />
              {cronError && (
                <p className="mt-1 text-[10px] text-red-400">{cronError}</p>
              )}
              {cronPreview.length > 0 && (
                <div className="mt-1.5 space-y-0.5">
                  <p className="text-[10px] text-[var(--color-text-secondary)]">
                    {t("scheduler.nextOccurrences", "Next occurrences:")}
                  </p>
                  {cronPreview.map((d, i) => (
                    <p key={i} className="text-[10px] font-mono text-blue-400 pl-2">
                      {fmtDate(d)}
                    </p>
                  ))}
                </div>
              )}
            </label>
            {/* Cron helper */}
            <details className="text-[11px]">
              <summary className="cursor-pointer text-[var(--color-text-secondary)] hover:text-[var(--color-text)]">
                {t("scheduler.cronHelper", "Common cron patterns")}
              </summary>
              <div className="mt-1 grid grid-cols-2 gap-1">
                {CRON_PRESETS.map((p) => (
                  <button
                    key={p.cron}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, cronExpression: p.cron }))}
                    className="text-left px-2 py-1 rounded hover:bg-[var(--color-bg-hover)] text-[var(--color-text-secondary)]"
                  >
                    <span className="font-mono text-blue-400">{p.cron}</span>{" "}
                    <span className="text-[10px]">{p.label}</span>
                  </button>
                ))}
              </div>
            </details>
            {/* Target (connection IDs) */}
            <label className="block text-[11px] text-[var(--color-text-secondary)]">
              {t("scheduler.target", "Target (connection IDs / script path)")}
              <input
                type="text"
                value={form.connectionIds}
                onChange={(e) => setForm((f) => ({ ...f, connectionIds: e.target.value }))}
                placeholder="id1, id2"
                className="mt-1 w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)]"
              />
            </label>
            {/* Timeout + Retries */}
            <div className="flex gap-3">
              <label className="flex-1 block text-[11px] text-[var(--color-text-secondary)]">
                {t("scheduler.timeout", "Timeout (ms)")}
                <input
                  type="number"
                  min={0}
                  value={form.timeoutMs}
                  onChange={(e) => setForm((f) => ({ ...f, timeoutMs: Number(e.target.value) }))}
                  className="mt-1 w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)]"
                />
              </label>
              <label className="flex-1 block text-[11px] text-[var(--color-text-secondary)]">
                {t("scheduler.retries", "Retries")}
                <input
                  type="number"
                  min={0}
                  value={form.maxRetries}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, maxRetries: Number(e.target.value) }))
                  }
                  className="mt-1 w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)]"
                />
              </label>
            </div>
            {/* Description */}
            <label className="block text-[11px] text-[var(--color-text-secondary)]">
              {t("scheduler.description", "Description")}
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
                className="mt-1 w-full px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] resize-none"
              />
            </label>
            {/* Enabled toggle */}
            <label className="flex items-center gap-2 text-xs text-[var(--color-text)]">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                className="rounded"
              />
              {t("scheduler.enabled", "Enabled")}
            </label>
          </div>
          <div className="flex justify-end gap-2 px-5 py-3 border-t border-[var(--color-border)]">
            <button
              onClick={() => setShowModal(false)}
              className="px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
            >
              {t("common.cancel", "Cancel")}
            </button>
            <button
              onClick={handleSave}
              disabled={!form.name || !form.cronExpression || !!cronError}
              className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {editingId ? t("common.save", "Save") : t("scheduler.create", "Create")}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── Main Render ──────────────────────────────────────────────────
  return (
    <>
      <div className="sor-sched-panel flex flex-col h-full">
        {/* Header */}
        <div className="sor-sched-header flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-3">
            <Settings size={18} className="text-blue-400" />
            <h2 className="text-sm font-semibold text-[var(--color-text)]">
              {t("scheduler.title", "Scheduled Automation")}
            </h2>
            <div className="flex items-center gap-2 ml-3 text-[11px] text-[var(--color-text-secondary)]">
              <span>
                {t("scheduler.total", "Total")}: {totalTasks}
              </span>
              <span className="text-green-400">
                {t("scheduler.active", "Active")}: {activeTasks}
              </span>
              <span className="text-yellow-400">
                {t("scheduler.pausedCount", "Paused")}: {pausedTasks}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={openAdd}
              className="sor-sched-add flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors"
            >
              <Plus size={13} /> {t("scheduler.add", "Add")}
            </button>
            <button
              onClick={sched.pauseAll}
              className="sor-sched-pause-all flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors"
              title={t("scheduler.pauseAll", "Pause all")}
            >
              <Pause size={13} />
            </button>
            <button
              onClick={sched.resumeAll}
              className="sor-sched-resume-all flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors"
              title={t("scheduler.resumeAll", "Resume all")}
            >
              <Play size={13} />
            </button>
            <button
              onClick={() => {
                sched.fetchTasks();
                sched.fetchStats();
                sched.fetchUpcoming(20);
                sched.fetchHistory();
              }}
              className="sor-sched-refresh p-1.5 rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] transition-colors"
              title={t("common.refresh", "Refresh")}
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="sor-sched-tabs flex gap-1 px-5 py-2 border-b border-[var(--color-border)]">
          <TabButton
            active={tab === "tasks"}
            onClick={() => setTab("tasks")}
            icon={<ListChecks size={13} />}
            label={t("scheduler.tabTasks", "Tasks")}
          />
          <TabButton
            active={tab === "upcoming"}
            onClick={() => {
              setTab("upcoming");
              sched.fetchUpcoming(20);
            }}
            icon={<Calendar size={13} />}
            label={t("scheduler.tabUpcoming", "Upcoming")}
          />
          <TabButton
            active={tab === "history"}
            onClick={() => {
              setTab("history");
              sched.fetchHistory();
            }}
            icon={<History size={13} />}
            label={t("scheduler.tabHistory", "History")}
          />
        </div>

        {/* Error banner */}
        {sched.error && (
          <div className="sor-sched-error flex items-center gap-2 mx-5 mt-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
            <AlertCircle size={14} />
            {sched.error}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {sched.loading ? (
            <div className="sor-sched-loading flex flex-col items-center justify-center py-16 text-[var(--color-text-secondary)]">
              <Loader2 size={28} className="animate-spin mb-2" />
              <p className="text-xs">{t("common.loading", "Loading…")}</p>
            </div>
          ) : (
            <>
              {tab === "tasks" && (
                <>
                  {sched.tasks.length === 0 ? (
                    <div className="sor-sched-empty flex flex-col items-center justify-center py-16 text-[var(--color-text-secondary)]">
                      <ListChecks size={32} className="mb-2 opacity-40" />
                      <p className="text-sm mb-2">
                        {t("scheduler.noTasks", "No scheduled tasks yet.")}
                      </p>
                      <button
                        onClick={openAdd}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-500"
                      >
                        <Plus size={13} /> {t("scheduler.createFirst", "Create your first task")}
                      </button>
                    </div>
                  ) : (
                    sched.tasks.map(renderTaskCard)
                  )}
                </>
              )}
              {tab === "upcoming" && renderUpcoming()}
              {tab === "history" && renderHistory()}
            </>
          )}
        </div>
      </div>
      {renderModal()}
    </>
  );
};

export default SchedulerPanel;
