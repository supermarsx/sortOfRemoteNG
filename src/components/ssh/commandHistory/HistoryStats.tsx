import React from "react";
import {
  BarChart3,
  Hash,
  Star,
  CheckCircle2,
  Activity,
  Server,
  TrendingUp,
} from "lucide-react";
import type { SSHCommandHistoryStats } from "../../../types/ssh/sshCommandHistory";
import type { TFunc } from "./types";

const CATEGORY_ICONS: Record<string, string> = {
  system: "bg-primary/10 text-primary",
  network: "bg-info/10 text-info",
  file: "bg-warning/10 text-warning",
  process: "bg-warning/10 text-warning",
  package: "bg-primary/10 text-primary",
  docker: "bg-sky-500/10 text-sky-500",
  kubernetes: "bg-primary/10 text-primary",
  git: "bg-error/10 text-error",
  database: "bg-success/10 text-success",
  service: "bg-teal-500/10 text-teal-500",
  security: "bg-rose-500/10 text-rose-500",
  user: "bg-primary/10 text-primary",
  disk: "bg-lime-500/10 text-lime-500",
  custom: "bg-primary/10 text-primary",
  unknown: "bg-text-secondary/10 text-text-secondary",
};

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--color-surfaceHover)]/50 border border-[var(--color-border)]/30">
      <div className={`p-1.5 rounded ${color}`}>
        <Icon size={12} />
      </div>
      <div>
        <div className="text-sm font-semibold text-[var(--color-text)]">
          {value}
        </div>
        <div className="text-[10px] text-[var(--color-textSecondary)]">
          {label}
        </div>
      </div>
    </div>
  );
}

function HistoryStats({
  stats,
  t,
}: {
  stats: SSHCommandHistoryStats;
  t: TFunc;
}) {
  const maxActivity = Math.max(...stats.recentActivity.map((a) => a.count), 1);

  return (
    <div className="p-3 space-y-4 overflow-y-auto">
      {/* Quick stat cards */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard
          icon={Hash}
          label={t("sshHistory.totalCommands", "Total Commands")}
          value={stats.totalCommands}
          color="bg-primary/10 text-primary"
        />
        <StatCard
          icon={Activity}
          label={t("sshHistory.totalExecutions", "Total Executions")}
          value={stats.totalExecutions}
          color="bg-success/10 text-success"
        />
        <StatCard
          icon={Star}
          label={t("sshHistory.starred", "Starred")}
          value={stats.starredCount}
          color="bg-warning/10 text-warning"
        />
        <StatCard
          icon={CheckCircle2}
          label={t("sshHistory.successRate", "Success Rate")}
          value={`${(stats.successRate * 100).toFixed(0)}%`}
          color="bg-success/10 text-success"
        />
        <StatCard
          icon={Server}
          label={t("sshHistory.sessionsUsed", "Sessions Used")}
          value={stats.sessionsUsed}
          color="bg-primary/10 text-primary"
        />
        <StatCard
          icon={TrendingUp}
          label={t("sshHistory.avgExecs", "Avg Executions")}
          value={stats.avgExecutionsPerCommand.toFixed(1)}
          color="bg-info/10 text-info"
        />
      </div>

      {/* Activity chart (14 days) */}
      <div>
        <div className="flex items-center gap-1.5 mb-2">
          <BarChart3
            size={12}
            className="text-[var(--color-textSecondary)]"
          />
          <span className="text-xs font-medium text-[var(--color-textSecondary)]">
            {t("sshHistory.recentActivityChart", "Activity (14 days)")}
          </span>
        </div>
        <div className="flex items-end gap-0.5 h-16">
          {stats.recentActivity.map((day) => (
            <div
              key={day.date}
              className="flex-1 flex flex-col items-center gap-0.5"
              title={`${day.date}: ${day.count} commands`}
            >
              <div
                className="w-full bg-success/60 rounded-t-sm transition-all duration-300 min-h-[2px]"
                style={{
                  height: `${Math.max((day.count / maxActivity) * 100, 3)}%`,
                }}
              />
              <span className="text-[8px] text-[var(--color-textMuted)] leading-none">
                {day.date.slice(8)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Top commands */}
      {stats.topCommands.length > 0 && (
        <div>
          <div className="text-xs font-medium text-[var(--color-textSecondary)] mb-2">
            {t("sshHistory.topCommands", "Top Commands")}
          </div>
          <div className="space-y-1">
            {stats.topCommands.slice(0, 8).map((item, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 text-xs"
              >
                <span className="text-[var(--color-textMuted)] w-4 text-right font-mono">
                  {idx + 1}.
                </span>
                <code className="flex-1 truncate font-mono text-[var(--color-text)]">
                  {item.command}
                </code>
                <span className="text-[var(--color-textSecondary)] font-mono">
                  {item.count}x
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Category breakdown */}
      {Object.keys(stats.categoryBreakdown).length > 0 && (
        <div>
          <div className="text-xs font-medium text-[var(--color-textSecondary)] mb-2">
            {t("sshHistory.categoryBreakdown", "Categories")}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(stats.categoryBreakdown)
              .sort(([, a], [, b]) => b - a)
              .map(([cat, count]) => (
                <span
                  key={cat}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${
                    CATEGORY_ICONS[cat] ?? CATEGORY_ICONS.unknown
                  }`}
                >
                  {cat}
                  <span className="opacity-70">{count}</span>
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default HistoryStats;
