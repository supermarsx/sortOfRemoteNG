import React from "react";
import { useTranslation } from "react-i18next";
import { ListTodo, XCircle, CheckCircle, Clock, RefreshCw, Eye, StopCircle } from "lucide-react";
import type { SubProps } from "./types";

const TasksView: React.FC<SubProps> = ({ mgr }) => {
  const { t } = useTranslation();
  const node = mgr.selectedNode;

  if (!node) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-[var(--color-text-secondary)]">
        {t("proxmox.selectNode", "Select a node first")}
      </div>
    );
  }

  const statusIcon = (status?: string) => {
    switch (status) {
      case "OK": return <CheckCircle className="w-3.5 h-3.5 text-success" />;
      case "running": return <Clock className="w-3.5 h-3.5 text-primary animate-pulse" />;
      default: return <XCircle className="w-3.5 h-3.5 text-error" />;
    }
  };

  return (
    <div className="p-6 overflow-y-auto flex-1">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-2">
          <ListTodo className="w-4 h-4 text-info" />
          {t("proxmox.tasks.title", "Tasks")}
          <span className="text-xs font-normal text-[var(--color-text-secondary)]">
            ({mgr.tasks.length})
          </span>
        </h3>
        <button
          onClick={() => mgr.refreshTasks(node)}
          className="p-1.5 rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${mgr.refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {mgr.tasks.length === 0 ? (
        <div className="text-center py-16 text-sm text-[var(--color-text-secondary)]">
          <ListTodo className="w-10 h-10 mx-auto mb-3 opacity-30" />
          {t("proxmox.tasks.noTasks", "No recent tasks")}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[var(--color-text-secondary)] border-b border-[var(--color-border)]">
                <th className="pb-2 pr-3 w-8" />
                <th className="pb-2 pr-3">{t("proxmox.tasks.type", "Type")}</th>
                <th className="pb-2 pr-3">{t("proxmox.tasks.id", "ID")}</th>
                <th className="pb-2 pr-3">{t("proxmox.tasks.user", "User")}</th>
                <th className="pb-2 pr-3">{t("proxmox.tasks.startTime", "Started")}</th>
                <th className="pb-2 pr-3">{t("proxmox.tasks.status", "Status")}</th>
                <th className="pb-2 w-20" />
              </tr>
            </thead>
            <tbody>
              {mgr.tasks.map((task, i) => (
                <tr
                  key={task.upid ?? i}
                  className="border-b border-[var(--color-border)]/50 text-[var(--color-text)]"
                >
                  <td className="py-2 pr-3">{statusIcon(task.status)}</td>
                  <td className="py-2 pr-3 font-medium">{task.taskType ?? "—"}</td>
                  <td className="py-2 pr-3 font-mono text-[10px]">{task.id ?? "—"}</td>
                  <td className="py-2 pr-3">{task.user ?? "—"}</td>
                  <td className="py-2 pr-3">
                    {task.starttime ? new Date(task.starttime * 1000).toLocaleString() : "—"}
                  </td>
                  <td className="py-2 pr-3">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      task.status === "running"
                        ? "bg-primary/15 text-primary"
                        : task.status === "OK"
                        ? "bg-success/15 text-success"
                        : "bg-error/15 text-error"
                    }`}>
                      {task.status ?? "unknown"}
                    </span>
                  </td>
                  <td className="py-2">
                    <div className="flex gap-1">
                      <button
                        onClick={() => task.upid && mgr.loadTaskDetail(node, task.upid)}
                        className="p-1 rounded border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
                        title={t("proxmox.tasks.viewLog", "View Log")}
                      >
                        <Eye className="w-3 h-3" />
                      </button>
                      {task.status === "running" && (
                        <button
                          onClick={() =>
                            task.upid &&
                            mgr.requestConfirm(
                              t("proxmox.tasks.stopTitle", "Stop Task"),
                              t("proxmox.tasks.stopMsg", "Stop this running task?"),
                              () => mgr.stopTask(node, task.upid!),
                            )
                          }
                          className="p-1 rounded border border-error/30 text-error hover:bg-error/10 transition-colors"
                          title={t("proxmox.tasks.stop", "Stop")}
                        >
                          <StopCircle className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Task detail panel */}
      {mgr.taskDetail && (
        <div className="mt-6 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-semibold text-[var(--color-text)]">
              {t("proxmox.tasks.detailTitle", "Task Log")}
            </h4>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
              mgr.taskDetail.status === "running" ? "bg-primary/15 text-primary" : "bg-success/15 text-success"
            }`}>
              {mgr.taskDetail.status}
            </span>
          </div>
          <div className="font-mono text-[10px] max-h-48 overflow-y-auto space-y-0.5 bg-[var(--color-bg)] p-3 rounded-lg">
            {mgr.taskLog.map((line, i) => (
              <div key={i} className="text-[var(--color-text-secondary)]">
                <span className="text-[var(--color-text-secondary)] mr-2">{line.n}</span>
                {line.t}
              </div>
            ))}
            {mgr.taskLog.length === 0 && (
              <div className="text-[var(--color-text-secondary)]">No log entries</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default TasksView;
