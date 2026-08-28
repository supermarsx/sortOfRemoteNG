import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Edit3,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { useScheduler } from "../../hooks/scheduler/useScheduler";
import type {
  ScheduledTask,
  TaskAction,
  TaskExecutionRecord,
  TaskSchedule,
} from "../../types/scheduler/scheduler";

export interface SchedulerPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabId = "tasks" | "upcoming" | "history";

interface WakeForm {
  name: string;
  description: string;
  cron: string;
  macAddress: string;
  port: number;
  enabled: boolean;
}

interface WakeFormErrors {
  name: string | null;
  macAddress: string | null;
  port: string | null;
  cron: string | null;
}

const EMPTY_FORM: WakeForm = {
  name: "",
  description: "",
  cron: "0 8 * * 1-5",
  macAddress: "",
  port: 9,
  enabled: true,
};

const EMPTY_FORM_ERRORS: WakeFormErrors = {
  name: null,
  macAddress: null,
  port: null,
  cron: null,
};

const MAC_PATTERN = /^(?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/;

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "-";
}

function formatDuration(value: number | null): string {
  if (value == null) return "-";
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function scheduleLabel(schedule: TaskSchedule): string {
  switch (schedule.type) {
    case "cron":
      return schedule.expression;
    case "once":
      return formatDate(schedule.at);
    case "interval":
      return `Every ${schedule.every_seconds}s`;
    case "daily":
      return `Daily ${schedule.time}`;
    case "weekly":
      return `${schedule.day} ${schedule.time}`;
    case "monthly":
      return `Day ${schedule.day} ${schedule.time}`;
    case "on_event":
      return `Event: ${schedule.event_type}`;
  }
}

function actionLabel(action: TaskAction): string {
  switch (action.type) {
    case "send_wake_on_lan":
      return "Wake-on-LAN";
    case "pipeline":
      return "Pipeline";
    case "connect_connection":
      return "Connect";
    case "disconnect_connection":
      return "Disconnect";
    case "execute_script":
      return "Script";
    case "run_diagnostics":
      return "Diagnostics";
    case "backup_collection":
      return "Backup";
    case "sync_cloud":
      return "Cloud sync";
    case "run_health_check":
      return "Health check";
    case "http_request":
      return "HTTP request";
    case "execute_command":
      return "Command";
    case "generate_report":
      return "Report";
    case "notify":
      return "Notification";
  }
}

function isRunnableAction(action: TaskAction, depth = 0): boolean {
  if (action.type === "send_wake_on_lan") return true;
  if (action.type !== "pipeline" || depth >= 16 || action.steps.length > 256) {
    return false;
  }
  return action.steps.every((step) => isRunnableAction(step.action, depth + 1));
}

function formFromTask(task: ScheduledTask): WakeForm | null {
  if (
    task.action.type !== "send_wake_on_lan" ||
    task.schedule.type !== "cron"
  ) {
    return null;
  }
  return {
    name: task.name,
    description: task.description,
    cron: task.schedule.expression,
    macAddress: task.action.mac_address,
    port: task.action.port ?? 9,
    enabled: task.enabled,
  };
}

export const SchedulerPanel: React.FC<SchedulerPanelProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useTranslation();
  const scheduler = useScheduler();
  const [tab, setTab] = useState<TabId>("tasks");
  const [showEditor, setShowEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<WakeForm>(EMPTY_FORM);
  const [formErrors, setFormErrors] =
    useState<WakeFormErrors>(EMPTY_FORM_ERRORS);
  const [cronPreview, setCronPreview] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const formError =
    formErrors.name ??
    formErrors.macAddress ??
    formErrors.port ??
    formErrors.cron;

  const refresh = useCallback(async () => {
    await Promise.all([
      scheduler.fetchTasks(),
      scheduler.fetchStats(),
      scheduler.fetchUpcoming(20),
      scheduler.fetchHistory(undefined, 100),
      scheduler.loadConfig(),
    ]);
  }, [scheduler]);

  useEffect(() => {
    if (isOpen) void refresh();
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps, react/exhaustive-deps

  useEffect(() => {
    if (!showEditor || !form.cron.trim()) {
      setFormErrors((current) => ({ ...current, cron: null }));
      setCronPreview([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const error = await scheduler.validateCron(form.cron.trim());
      if (cancelled) return;
      setFormErrors((current) => ({ ...current, cron: error }));
      const occurrences = error
        ? []
        : await scheduler.getNextOccurrences(form.cron.trim(), 3);
      if (!cancelled) setCronPreview(occurrences);
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [form.cron, showEditor]); // eslint-disable-line react-hooks/exhaustive-deps, react/exhaustive-deps

  const tasks = useMemo(
    () =>
      [...scheduler.tasks].sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
    [scheduler.tasks],
  );
  const unavailableCount = tasks.filter(
    (task) => !isRunnableAction(task.action),
  ).length;

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormErrors(EMPTY_FORM_ERRORS);
    setCronPreview([]);
    setShowEditor(true);
  };

  const openEdit = (task: ScheduledTask) => {
    const next = formFromTask(task);
    if (!next) return;
    setEditingId(task.id);
    setForm(next);
    setFormErrors(EMPTY_FORM_ERRORS);
    setCronPreview([]);
    setShowEditor(true);
  };

  const saveTask = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = form.name.trim();
    const cron = form.cron.trim();
    const macAddress = form.macAddress.trim();

    const staticErrors: WakeFormErrors = {
      name:
        !name || name.length > 128
          ? t(
              "scheduler.nameInvalid",
              "Name is required and must be at most 128 characters.",
            )
          : null,
      macAddress: !MAC_PATTERN.test(macAddress)
        ? t(
            "scheduler.macInvalid",
            "Enter a MAC address such as AA:BB:CC:DD:EE:FF.",
          )
        : null,
      port:
        !Number.isInteger(form.port) || form.port < 1 || form.port > 65535
          ? t("scheduler.portInvalid", "Port must be between 1 and 65535.")
          : null,
      cron: null,
    };
    if (staticErrors.name || staticErrors.macAddress || staticErrors.port) {
      setFormErrors(staticErrors);
      return;
    }
    const validation = await scheduler.validateCron(cron);
    if (validation) {
      setFormErrors({ ...staticErrors, cron: validation });
      return;
    }
    setFormErrors(EMPTY_FORM_ERRORS);

    const existing = editingId
      ? (scheduler.tasks.find((task) => task.id === editingId) ?? null)
      : null;
    const now = new Date().toISOString();
    const task: ScheduledTask = {
      id: existing?.id ?? crypto.randomUUID(),
      name,
      description: form.description.trim().slice(0, 2048),
      enabled: form.enabled,
      schedule: { type: "cron", expression: cron },
      action: {
        type: "send_wake_on_lan",
        mac_address: macAddress,
        port: form.port,
      },
      conditions: [],
      retry_policy: null,
      timeout_ms: 10_000,
      tags: existing?.tags ?? [],
      priority: existing?.priority ?? "Normal",
      created_at: existing?.created_at ?? now,
      updated_at: now,
      last_run_at: existing?.last_run_at ?? null,
      next_run_at: existing?.next_run_at ?? null,
      run_count: existing?.run_count ?? 0,
      fail_count: existing?.fail_count ?? 0,
    };

    setSaving(true);
    const success = existing
      ? await scheduler.updateTask(task)
      : (await scheduler.addTask(task)) !== null;
    setSaving(false);
    if (success) {
      setShowEditor(false);
      await Promise.all([scheduler.fetchStats(), scheduler.fetchUpcoming(20)]);
    }
  };

  const runTask = async (task: ScheduledTask) => {
    if (!isRunnableAction(task.action)) return;
    setRunningId(task.id);
    await scheduler.executeNow(task.id);
    setRunningId(null);
    await Promise.all([scheduler.fetchStats(), scheduler.fetchUpcoming(20)]);
  };

  const deleteTask = async (task: ScheduledTask) => {
    if (
      !window.confirm(
        t("scheduler.confirmDelete", "Delete this scheduled task?"),
      )
    ) {
      return;
    }
    if (await scheduler.removeTask(task.id)) {
      await Promise.all([scheduler.fetchStats(), scheduler.fetchUpcoming(20)]);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3">
      <section className="flex h-[min(860px,94vh)] w-[min(1120px,96vw)] flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)] shadow-2xl">
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <CalendarClock size={20} className="text-[var(--color-accent)]" />
              <h2 className="text-base font-semibold text-[var(--color-text)]">
                {t("scheduler.title", "Automation scheduler")}
              </h2>
            </div>
            <p className="mt-1 text-xs text-[var(--color-textSecondary)]">
              {t(
                "scheduler.runtimeScope",
                "Wake-on-LAN is available. Other action types stay read-only until their runtime dispatchers are wired.",
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)]"
            aria-label={t("common.close", "Close")}
          >
            <X size={18} />
          </button>
        </header>

        <div className="grid grid-cols-2 gap-px border-b border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-4">
          {[
            [
              t("scheduler.tasks", "Tasks"),
              scheduler.stats?.total_tasks ?? tasks.length,
            ],
            [
              t("scheduler.enabled", "Enabled"),
              scheduler.stats?.enabled_tasks ??
                tasks.filter((task) => task.enabled).length,
            ],
            [
              t("scheduler.successful", "Successful"),
              scheduler.stats?.successful ?? 0,
            ],
            [t("scheduler.failed", "Failed"), scheduler.stats?.failed ?? 0],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="bg-[var(--color-surface)] px-4 py-3"
            >
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--color-textMuted)]">
                {label}
              </div>
              <div className="mt-1 text-xl font-semibold text-[var(--color-text)]">
                {value}
              </div>
            </div>
          ))}
        </div>

        {scheduler.error && (
          <div className="mx-4 mt-3 flex items-start justify-between gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            <span>{scheduler.error}</span>
            <button
              onClick={scheduler.clearError}
              aria-label={t("common.dismiss", "Dismiss")}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {unavailableCount > 0 && (
          <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <ShieldAlert size={15} />
            {t(
              "scheduler.unavailableCount",
              "{{count}} legacy task(s) use unavailable dispatchers and cannot be run or re-enabled.",
              { count: unavailableCount },
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
          <div className="flex gap-1 rounded-lg bg-[var(--color-surface)] p-1">
            {(["tasks", "upcoming", "history"] as TabId[]).map((value) => (
              <button
                key={value}
                onClick={() => setTab(value)}
                className={`rounded-md px-3 py-1.5 text-xs capitalize ${
                  tab === value
                    ? "bg-[var(--color-accent)] text-white"
                    : "text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)]"
                }`}
              >
                {t(`scheduler.${value}`, value)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void refresh()}
              disabled={scheduler.loading}
              className="rounded-lg border border-[var(--color-border)] p-2 text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)] disabled:opacity-50"
              title={t("common.refresh", "Refresh")}
            >
              <RefreshCw
                size={14}
                className={scheduler.loading ? "animate-spin" : ""}
              />
            </button>
            <button
              onClick={openAdd}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-xs font-medium text-white hover:brightness-110"
            >
              <Plus size={14} />
              {t("scheduler.addWakeTask", "Add Wake-on-LAN task")}
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {tab === "tasks" && (
            <div className="space-y-2">
              {tasks.length === 0 && !scheduler.loading && (
                <div className="flex h-52 flex-col items-center justify-center text-center text-[var(--color-textSecondary)]">
                  <CalendarClock size={34} className="mb-3 opacity-40" />
                  <p className="text-sm">
                    {t("scheduler.noTasks", "No scheduled tasks.")}
                  </p>
                </div>
              )}
              {tasks.map((task) => {
                const runnable = isRunnableAction(task.action);
                const editable = formFromTask(task) !== null;
                return (
                  <article
                    key={task.id}
                    className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-[var(--color-text)]">
                            {task.name}
                          </h3>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] ${
                              runnable
                                ? "bg-emerald-500/15 text-emerald-300"
                                : "bg-amber-500/15 text-amber-200"
                            }`}
                          >
                            {actionLabel(task.action)}
                          </span>
                          {!task.enabled && (
                            <span className="rounded-full bg-[var(--color-background)] px-2 py-0.5 text-[10px] text-[var(--color-textMuted)]">
                              {t("scheduler.disabled", "disabled")}
                            </span>
                          )}
                          {!runnable && (
                            <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] text-red-300">
                              {t("scheduler.unavailable", "unavailable")}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 truncate text-xs text-[var(--color-textSecondary)]">
                          {task.description ||
                            t("scheduler.noDescription", "No description")}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-[var(--color-textMuted)]">
                          <span className="flex items-center gap-1">
                            <Clock size={12} />
                            {scheduleLabel(task.schedule)}
                          </span>
                          <span>
                            {t("scheduler.next", "Next")}:{" "}
                            {formatDate(task.next_run_at)}
                          </span>
                          <span>
                            {t("scheduler.runs", "Runs")}: {task.run_count}
                          </span>
                          <span>
                            {t("scheduler.failures", "Failures")}:{" "}
                            {task.fail_count}
                          </span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          onClick={() =>
                            void scheduler.setTaskEnabled(
                              task.id,
                              !task.enabled,
                            )
                          }
                          disabled={!task.enabled && !runnable}
                          className="rounded-lg p-2 text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)] disabled:cursor-not-allowed disabled:opacity-35"
                          title={
                            task.enabled
                              ? t("scheduler.disable", "Disable")
                              : t("scheduler.enable", "Enable")
                          }
                        >
                          {task.enabled ? (
                            <Pause size={14} />
                          ) : (
                            <Play size={14} />
                          )}
                        </button>
                        <button
                          onClick={() => void runTask(task)}
                          disabled={!runnable || runningId === task.id}
                          className="rounded-lg p-2 text-[var(--color-accent)] hover:bg-[var(--color-surfaceHover)] disabled:cursor-not-allowed disabled:opacity-35"
                          title={
                            runnable
                              ? t("scheduler.runNow", "Run now")
                              : t(
                                  "scheduler.dispatcherUnavailable",
                                  "Runtime dispatcher unavailable",
                                )
                          }
                        >
                          {runningId === task.id ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Zap size={14} />
                          )}
                        </button>
                        {editable && (
                          <button
                            onClick={() => openEdit(task)}
                            className="rounded-lg p-2 text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)]"
                            title={t("common.edit", "Edit")}
                          >
                            <Edit3 size={14} />
                          </button>
                        )}
                        <button
                          onClick={() => void deleteTask(task)}
                          className="rounded-lg p-2 text-red-400 hover:bg-red-500/10"
                          title={t("common.delete", "Delete")}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {tab === "upcoming" && (
            <div className="space-y-2">
              {scheduler.upcoming.length === 0 && (
                <p className="py-16 text-center text-sm text-[var(--color-textSecondary)]">
                  {t("scheduler.noUpcoming", "No upcoming executions.")}
                </p>
              )}
              {scheduler.upcoming.map(({ task, next_run_at }) => (
                <div
                  key={`${task.id}-${next_run_at}`}
                  className="flex items-center justify-between rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3"
                >
                  <div>
                    <div className="text-sm text-[var(--color-text)]">
                      {task.name}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[var(--color-textMuted)]">
                      {actionLabel(task.action)}
                    </div>
                  </div>
                  <time className="text-xs text-[var(--color-textSecondary)]">
                    {formatDate(next_run_at)}
                  </time>
                </div>
              ))}
            </div>
          )}

          {tab === "history" && (
            <div className="overflow-hidden rounded-xl border border-[var(--color-border)]">
              <table className="w-full text-left text-xs">
                <thead className="bg-[var(--color-surface)] text-[var(--color-textMuted)]">
                  <tr>
                    <th className="px-3 py-2">{t("scheduler.task", "Task")}</th>
                    <th className="px-3 py-2">
                      {t("scheduler.started", "Started")}
                    </th>
                    <th className="px-3 py-2">
                      {t("scheduler.duration", "Duration")}
                    </th>
                    <th className="px-3 py-2">
                      {t("scheduler.result", "Result")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {scheduler.history.map((record: TaskExecutionRecord) => (
                    <tr
                      key={record.id}
                      className="border-t border-[var(--color-border)]"
                    >
                      <td className="px-3 py-2 text-[var(--color-text)]">
                        {record.task_name}
                      </td>
                      <td className="px-3 py-2 text-[var(--color-textSecondary)]">
                        {formatDate(record.started_at)}
                      </td>
                      <td className="px-3 py-2 text-[var(--color-textSecondary)]">
                        {formatDuration(record.duration_ms)}
                      </td>
                      <td className="max-w-sm px-3 py-2">
                        <div
                          className={`flex items-center gap-1 ${
                            record.status === "Completed"
                              ? "text-emerald-300"
                              : record.status === "Failed"
                                ? "text-red-300"
                                : "text-amber-200"
                          }`}
                        >
                          {record.status === "Completed" ? (
                            <CheckCircle2 size={13} />
                          ) : record.status === "Failed" ? (
                            <XCircle size={13} />
                          ) : (
                            <AlertTriangle size={13} />
                          )}
                          {record.status}
                        </div>
                        {record.error && (
                          <div
                            className="mt-1 truncate text-[10px] text-red-300/80"
                            title={record.error}
                          >
                            {record.error}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {scheduler.history.length === 0 && (
                <p className="py-16 text-center text-sm text-[var(--color-textSecondary)]">
                  {t("scheduler.noHistory", "No execution history.")}
                </p>
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-[var(--color-border)] px-4 py-3 text-[11px] text-[var(--color-textMuted)]">
          <span>
            {scheduler.config?.enabled === false
              ? t("scheduler.paused", "Scheduler paused")
              : t("scheduler.active", "Scheduler active")}
          </span>
          <button
            onClick={async () => {
              if (scheduler.config?.enabled === false) {
                await scheduler.resumeAll();
              } else {
                await scheduler.pauseAll();
              }
              await scheduler.loadConfig();
            }}
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)]"
          >
            {scheduler.config?.enabled === false
              ? t("scheduler.resume", "Resume scheduler")
              : t("scheduler.pause", "Pause scheduler")}
          </button>
        </footer>
      </section>

      {showEditor && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/65 p-4">
          <form
            onSubmit={saveTask}
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-text)]">
                  {editingId
                    ? t("scheduler.editWakeTask", "Edit Wake-on-LAN task")
                    : t("scheduler.addWakeTask", "Add Wake-on-LAN task")}
                </h3>
                <p className="mt-1 text-[11px] text-[var(--color-textMuted)]">
                  {t(
                    "scheduler.wakeScope",
                    "Sends one standard UDP magic packet to the local broadcast address.",
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowEditor(false)}
                className="rounded-lg p-2 text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)]"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <label className="block text-xs text-[var(--color-textSecondary)]">
                {t("scheduler.name", "Name")}
                <input
                  value={form.name}
                  maxLength={128}
                  onChange={(event) => {
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }));
                    setFormErrors((current) => ({
                      ...current,
                      name: null,
                    }));
                  }}
                  className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-[var(--color-text)]"
                  required
                />
              </label>
              <label className="block text-xs text-[var(--color-textSecondary)]">
                {t("scheduler.description", "Description")}
                <textarea
                  value={form.description}
                  maxLength={2048}
                  rows={2}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  className="mt-1 w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-[var(--color-text)]"
                />
              </label>
              <div className="grid grid-cols-[1fr_110px] gap-3">
                <label className="block text-xs text-[var(--color-textSecondary)]">
                  {t("scheduler.macAddress", "MAC address")}
                  <input
                    value={form.macAddress}
                    maxLength={17}
                    placeholder="AA:BB:CC:DD:EE:FF"
                    onChange={(event) => {
                      setForm((current) => ({
                        ...current,
                        macAddress: event.target.value,
                      }));
                      setFormErrors((current) => ({
                        ...current,
                        macAddress: null,
                      }));
                    }}
                    className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 font-mono text-sm text-[var(--color-text)]"
                    required
                  />
                </label>
                <label className="block text-xs text-[var(--color-textSecondary)]">
                  {t("scheduler.port", "UDP port")}
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={form.port}
                    onChange={(event) => {
                      setForm((current) => ({
                        ...current,
                        port: Number(event.target.value),
                      }));
                      setFormErrors((current) => ({
                        ...current,
                        port: null,
                      }));
                    }}
                    className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 text-sm text-[var(--color-text)]"
                    required
                  />
                </label>
              </div>
              <label className="block text-xs text-[var(--color-textSecondary)]">
                {t("scheduler.cron", "Cron schedule (UTC)")}
                <input
                  value={form.cron}
                  maxLength={256}
                  onChange={(event) => {
                    setForm((current) => ({
                      ...current,
                      cron: event.target.value,
                    }));
                    setFormErrors((current) => ({
                      ...current,
                      cron: null,
                    }));
                  }}
                  className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-2 font-mono text-sm text-[var(--color-text)]"
                  required
                />
              </label>
              {formError ? (
                <div className="flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  {formError}
                </div>
              ) : cronPreview.length > 0 ? (
                <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200">
                  <div className="mb-1 font-medium">
                    {t("scheduler.nextRuns", "Next runs")}
                  </div>
                  {cronPreview.map((value) => (
                    <div key={value}>{formatDate(value)}</div>
                  ))}
                </div>
              ) : null}
              <label className="flex items-center gap-2 text-xs text-[var(--color-textSecondary)]">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      enabled: event.target.checked,
                    }))
                  }
                />
                {t("scheduler.enableImmediately", "Enable immediately")}
              </label>
            </div>

            <div className="flex justify-end gap-2 border-t border-[var(--color-border)] px-5 py-4">
              <button
                type="button"
                onClick={() => setShowEditor(false)}
                className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-textSecondary)] hover:bg-[var(--color-surfaceHover)]"
              >
                {t("common.cancel", "Cancel")}
              </button>
              <button
                type="submit"
                disabled={saving || Boolean(formError)}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
              >
                {saving && <Loader2 size={13} className="animate-spin" />}
                {t("common.save", "Save")}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default SchedulerPanel;
