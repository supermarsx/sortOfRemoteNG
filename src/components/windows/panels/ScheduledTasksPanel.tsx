import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Search,
  RefreshCw,
  Loader2,
  AlertCircle,
  Play,
  Square,
  ToggleLeft,
  ToggleRight,
  Clock,
} from "lucide-react";
import { ConfirmDialog } from "../../ui/dialogs/ConfirmDialog";
import type { WinmgmtContext } from "../WinmgmtWrapper";
import type {
  ScheduledTask,
  ScheduledTaskState,
} from "../../../types/windows/winmgmt";

const STATE_COLORS: Record<ScheduledTaskState, string> = {
  ready: "text-green-400",
  running: "text-blue-400",
  disabled: "text-[var(--color-textMuted)]",
  queued: "text-yellow-400",
  unknown: "text-[var(--color-textMuted)]",
};

type FilterMode = "all" | "ready" | "running" | "disabled";
type TaskAction = "run" | "stop" | "enable" | "disable";

interface ScheduledTasksPanelProps {
  ctx: WinmgmtContext;
}

const ScheduledTasksPanel: React.FC<ScheduledTasksPanelProps> = ({ ctx }) => {
  const { t } = useTranslation();
  const stateLabels: Record<ScheduledTaskState, string> = {
    ready: t("windows.scheduledTasks.states.ready", "Ready"),
    running: t("windows.scheduledTasks.states.running", "Running"),
    disabled: t("windows.scheduledTasks.states.disabled", "Disabled"),
    queued: t("windows.scheduledTasks.states.queued", "Queued"),
    unknown: t("windows.scheduledTasks.states.unknown", "Unknown"),
  };
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    action: TaskAction;
    task: ScheduledTask;
  } | null>(null);
  const actionLabels: Record<TaskAction, string> = {
    run: t("windows.scheduledTasks.actions.run", "Run"),
    stop: t("windows.scheduledTasks.actions.stop", "Stop"),
    enable: t("windows.scheduledTasks.actions.enable", "Enable"),
    disable: t("windows.scheduledTasks.actions.disable", "Disable"),
  };

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await ctx.cmd<ScheduledTask[]>("winmgmt_list_tasks");
      setTasks(list);
    } catch {
      setError(
        "Unable to load remote scheduled tasks. Sensitive error details were withheld.",
      );
    } finally {
      setLoading(false);
    }
  }, [ctx]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const doAction = useCallback(
    async (action: TaskAction, task: ScheduledTask) => {
      const key = `${task.taskPath}\\${task.taskName}`;
      setActionLoading(key);
      try {
        await ctx.cmd(`winmgmt_${action}_task`, {
          confirmed: true,
          taskPath: task.taskPath,
          taskName: task.taskName,
        });
        await fetchTasks();
      } catch {
        setError(`Unable to ${action} the selected scheduled task.`);
      } finally {
        setActionLoading(null);
      }
    },
    [ctx, fetchTasks],
  );

  const filtered = tasks.filter((t) => {
    if (search) {
      const q = search.toLowerCase();
      if (
        !t.taskName.toLowerCase().includes(q) &&
        !t.taskPath.toLowerCase().includes(q) &&
        !(t.description?.toLowerCase().includes(q) ?? false)
      )
        return false;
    }
    if (filter === "ready") return t.state === "ready";
    if (filter === "running") return t.state === "running";
    if (filter === "disabled") return t.state === "disabled";
    return true;
  });

  const selectedTask = selected
    ? tasks.find((t) => `${t.taskPath}\\${t.taskName}` === selected)
    : null;

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="relative flex-1 max-w-xs">
          <Search
            size={14}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-textMuted)]"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t(
              "windows.scheduledTasks.searchTasks",
              "Search tasks…",
            )}
            className="w-full pl-7 pr-2 py-1.5 text-xs rounded-md bg-[var(--color-background)] border border-[var(--color-border)] text-[var(--color-text)] placeholder:text-[var(--color-textMuted)] focus:outline-none focus:border-[var(--color-accent)]"
          />
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as FilterMode)}
          className="text-xs px-2 py-1.5 rounded-md bg-[var(--color-background)] border border-[var(--color-border)] text-[var(--color-text)]"
        >
          <option value="all">
            {t("windows.scheduledTasks.filters.all", "All")}
          </option>
          <option value="ready">{stateLabels.ready}</option>
          <option value="running">{stateLabels.running}</option>
          <option value="disabled">{stateLabels.disabled}</option>
        </select>
        <button
          onClick={fetchTasks}
          disabled={loading}
          className="p-1.5 rounded-md hover:bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)]"
          title={t("windows.scheduledTasks.refresh", "Refresh")}
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
        <span className="text-xs text-[var(--color-textMuted)] ml-auto">
          {filtered.length} / {tasks.length}
        </span>
      </div>

      {error && (
        <div className="px-3 py-2 text-xs text-[var(--color-error)] bg-[color-mix(in_srgb,var(--color-error)_8%,transparent)] flex items-center gap-1.5">
          <AlertCircle size={12} />
          {error}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Task List */}
        <div className="flex-1 overflow-auto">
          {loading && tasks.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <Loader2
                size={24}
                className="animate-spin text-[var(--color-textMuted)]"
              />
            </div>
          ) : (
            <table
              className="w-full text-xs"
              aria-label={t(
                "windows.scheduledTasks.tableLabel",
                "Scheduled tasks list",
              )}
            >
              <thead className="sticky top-0 bg-[var(--color-surface)] z-10">
                <tr className="text-left text-[var(--color-textSecondary)]">
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("windows.scheduledTasks.columns.name", "Name")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium w-20">
                    {t("windows.scheduledTasks.columns.status", "Status")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("windows.scheduledTasks.columns.lastRun", "Last Run")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("windows.scheduledTasks.columns.nextRun", "Next Run")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium w-24">
                    {t("windows.scheduledTasks.columns.actions", "Actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((task) => {
                  const key = `${task.taskPath}\\${task.taskName}`;
                  return (
                    <tr
                      key={key}
                      onClick={() => setSelected(key)}
                      className={`border-b border-[var(--color-border)] cursor-pointer transition-colors ${
                        selected === key
                          ? "bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)]"
                          : "hover:bg-[var(--color-surfaceHover)]"
                      }`}
                    >
                      <td className="px-3 py-1.5">
                        <div className="text-[var(--color-text)]">
                          {task.taskName}
                        </div>
                        <div className="text-[var(--color-textMuted)] text-[10px] truncate max-w-[200px]">
                          {task.taskPath}
                        </div>
                      </td>
                      <td className={`px-3 py-1.5 ${STATE_COLORS[task.state]}`}>
                        {stateLabels[task.state]}
                      </td>
                      <td className="px-3 py-1.5 text-[var(--color-textSecondary)] font-mono whitespace-nowrap">
                        {task.lastRunTime
                          ? new Date(task.lastRunTime).toLocaleString()
                          : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-[var(--color-textSecondary)] font-mono whitespace-nowrap">
                        {task.nextRunTime
                          ? new Date(task.nextRunTime).toLocaleString()
                          : "—"}
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="flex gap-1">
                          {task.state === "ready" && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setPendingAction({ action: "run", task });
                              }}
                              disabled={actionLoading === key}
                              className="p-1 rounded hover:bg-green-500/20 text-green-400"
                              title={t(
                                "windows.scheduledTasks.actions.run",
                                "Run",
                              )}
                            >
                              {actionLoading === key ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Play size={12} />
                              )}
                            </button>
                          )}
                          {task.state === "running" && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setPendingAction({ action: "stop", task });
                              }}
                              disabled={actionLoading === key}
                              className="p-1 rounded hover:bg-red-500/20 text-red-400"
                              title={t(
                                "windows.scheduledTasks.actions.stop",
                                "Stop",
                              )}
                            >
                              <Square size={12} />
                            </button>
                          )}
                          {task.state !== "disabled" ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setPendingAction({ action: "disable", task });
                              }}
                              disabled={actionLoading === key}
                              aria-label={t(
                                "windows.scheduledTasks.actions.disableTaskAria",
                                "Disable task {{task}}",
                                { task: task.taskName },
                              )}
                              aria-busy={actionLoading === key}
                              className="p-1 rounded hover:bg-yellow-500/20 text-yellow-400"
                              title={t(
                                "windows.scheduledTasks.actions.disable",
                                "Disable",
                              )}
                            >
                              {actionLoading === key ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <ToggleLeft size={12} />
                              )}
                            </button>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setPendingAction({ action: "enable", task });
                              }}
                              disabled={actionLoading === key}
                              aria-label={t(
                                "windows.scheduledTasks.actions.enableTaskAria",
                                "Enable task {{task}}",
                                { task: task.taskName },
                              )}
                              aria-busy={actionLoading === key}
                              className="p-1 rounded hover:bg-green-500/20 text-green-400"
                              title={t(
                                "windows.scheduledTasks.actions.enable",
                                "Enable",
                              )}
                            >
                              {actionLoading === key ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <ToggleRight size={12} />
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Detail Pane */}
        {selectedTask && (
          <div className="w-72 border-l border-[var(--color-border)] bg-[var(--color-surface)] overflow-auto p-3 space-y-3">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">
              {selectedTask.taskName}
            </h3>
            <dl className="text-xs space-y-2">
              <DetailRow
                label={t("windows.scheduledTasks.detail.path", "Path")}
                value={selectedTask.taskPath}
              />
              <DetailRow
                label={t("windows.scheduledTasks.detail.state", "State")}
                value={stateLabels[selectedTask.state]}
              />
              {selectedTask.author && (
                <DetailRow
                  label={t("windows.scheduledTasks.detail.author", "Author")}
                  value={selectedTask.author}
                />
              )}
              {selectedTask.description && (
                <DetailRow
                  label={t(
                    "windows.scheduledTasks.detail.description",
                    "Description",
                  )}
                  value={selectedTask.description}
                />
              )}
              {selectedTask.lastTaskResult != null && (
                <DetailRow
                  label={t(
                    "windows.scheduledTasks.detail.lastResult",
                    "Last Result",
                  )}
                  value={`0x${selectedTask.lastTaskResult.toString(16)}`}
                />
              )}
              {selectedTask.principal && (
                <>
                  {selectedTask.principal.userId && (
                    <DetailRow
                      label={t("windows.scheduledTasks.detail.runAs", "Run As")}
                      value={selectedTask.principal.userId}
                    />
                  )}
                  {selectedTask.principal.runLevel && (
                    <DetailRow
                      label={t(
                        "windows.scheduledTasks.detail.runLevel",
                        "Run Level",
                      )}
                      value={selectedTask.principal.runLevel}
                    />
                  )}
                </>
              )}
            </dl>

            {/* Actions */}
            {selectedTask.actions.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-[var(--color-textMuted)] mb-1">
                  {t("windows.scheduledTasks.columns.actions", "Actions")}
                </h4>
                {selectedTask.actions.map((a, i) => (
                  <div
                    key={`action-${(a.execute || "").slice(0, 50)}-${i}`}
                    className="text-xs text-[var(--color-textSecondary)] p-1.5 bg-[var(--color-background)] rounded mb-1"
                  >
                    <div className="font-mono text-[10px] truncate">
                      {a.execute}
                    </div>
                    {a.arguments && (
                      <div className="text-[var(--color-textMuted)] truncate">
                        {a.arguments}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Triggers */}
            {selectedTask.triggers.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-[var(--color-textMuted)] mb-1 flex items-center gap-1">
                  <Clock size={10} />
                  {t("windows.scheduledTasks.detail.triggers", "Triggers")}
                </h4>
                {selectedTask.triggers.map((trigger, i) => (
                  <div
                    key={`trigger-${trigger.triggerType}-${i}`}
                    className="text-xs text-[var(--color-textSecondary)] p-1.5 bg-[var(--color-background)] rounded mb-1"
                  >
                    <div>{trigger.triggerType}</div>
                    {trigger.startBoundary && (
                      <div className="text-[var(--color-textMuted)]">
                        {t("windows.scheduledTasks.detail.start", "Start:")}{" "}
                        {trigger.startBoundary}
                      </div>
                    )}
                    {trigger.repetitionInterval && (
                      <div className="text-[var(--color-textMuted)]">
                        {t("windows.scheduledTasks.detail.repeat", "Repeat:")}{" "}
                        {trigger.repetitionInterval}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={pendingAction !== null}
        title={t(
          "windows.scheduledTasks.confirmActionTitle",
          "Confirm Remote Task Action",
        )}
        message={t(
          "windows.scheduledTasks.confirmActionMessage",
          'This changes remote system state. {{action}} scheduled task "{{path}}\\{{task}}"?',
          {
            action: pendingAction ? actionLabels[pendingAction.action] : "",
            path: pendingAction?.task.taskPath ?? "",
            task: pendingAction?.task.taskName ?? "",
          },
        )}
        confirmText={
          pendingAction
            ? actionLabels[pendingAction.action]
            : t("common.confirm", "Confirm")
        }
        variant="warning"
        onConfirm={() => {
          const action = pendingAction;
          setPendingAction(null);
          if (action) {
            void doAction(action.action, action.task);
          }
        }}
        onCancel={() => setPendingAction(null)}
      />
    </div>
  );
};

const DetailRow: React.FC<{ label: string; value: string }> = ({
  label,
  value,
}) => (
  <div>
    <dt className="text-[var(--color-textMuted)]">{label}</dt>
    <dd className="text-[var(--color-text)] mt-0.5">{value}</dd>
  </div>
);

export default ScheduledTasksPanel;
