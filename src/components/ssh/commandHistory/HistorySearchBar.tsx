import React from "react";
import { Search, Filter, X, ArrowUpDown, Star } from "lucide-react";
import { SSHCommandCategories } from "../../../types/ssh/sshCommandHistory";
import type { HistoryMgr, TFunc } from "./types";

function HistorySearchBar({
  mgr,
  t,
}: {
  mgr: HistoryMgr;
  t: TFunc;
}) {
  const [showAdvanced, setShowAdvanced] = React.useState(false);

  return (
    <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* Primary search row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex-1 relative">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-textMuted)]"
          />
          <input
            type="text"
            value={mgr.filter.searchQuery}
            onChange={(e) =>
              mgr.updateFilter({ searchQuery: e.target.value })
            }
            placeholder={t(
              "sshHistory.searchPlaceholder",
              "Search commands, tags, notes...",
            )}
            className="w-full pl-8 pr-8 py-1.5 text-sm bg-[var(--color-input)] border border-[var(--color-border)] rounded-md text-[var(--color-text)] placeholder-[var(--color-textMuted)] focus:outline-none focus:ring-1 focus:ring-green-500/50 font-mono"
          />
          {mgr.filter.searchQuery && (
            <button
              onClick={() => mgr.updateFilter({ searchQuery: "" })}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-textMuted)] hover:text-[var(--color-text)]"
            >
              <X size={12} />
            </button>
          )}
        </div>

        <button
          onClick={() =>
            mgr.updateFilter({ starredOnly: !mgr.filter.starredOnly })
          }
          className={`p-1.5 rounded transition-colors ${
            mgr.filter.starredOnly
              ? "text-yellow-500 bg-yellow-500/10"
              : "text-[var(--color-textSecondary)] hover:text-yellow-500"
          }`}
          title={t("sshHistory.starredOnly", "Starred only")}
        >
          <Star size={14} fill={mgr.filter.starredOnly ? "currentColor" : "none"} />
        </button>

        <button
          onClick={() => setShowAdvanced((prev) => !prev)}
          className={`p-1.5 rounded transition-colors ${
            showAdvanced
              ? "text-green-500 bg-green-500/10"
              : "text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
          }`}
          title={t("sshHistory.advancedFilters", "Advanced filters")}
        >
          <Filter size={14} />
        </button>

        <button
          onClick={() => {
            mgr.updateFilter({
              sortDirection:
                mgr.filter.sortDirection === "desc" ? "asc" : "desc",
            });
          }}
          className="p-1.5 rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
          title={t("sshHistory.toggleSort", "Toggle sort direction")}
        >
          <ArrowUpDown size={14} />
        </button>
      </div>

      {/* Advanced filters row */}
      {showAdvanced && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-t border-[var(--color-border)]/50 bg-[var(--color-surfaceHover)]/30">
          {/* Category filter */}
          <select
            value={mgr.filter.category}
            onChange={(e) =>
              mgr.updateFilter({
                category: e.target.value as typeof mgr.filter.category,
              })
            }
            className="text-xs px-2 py-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
          >
            <option value="all">
              {t("sshHistory.allCategories", "All Categories")}
            </option>
            {SSHCommandCategories.map((cat) => (
              <option key={cat} value={cat}>
                {cat.charAt(0).toUpperCase() + cat.slice(1)}
              </option>
            ))}
          </select>

          {/* Session filter */}
          <select
            value={mgr.filter.sessionId}
            onChange={(e) =>
              mgr.updateFilter({ sessionId: e.target.value })
            }
            className="text-xs px-2 py-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
          >
            <option value="all">
              {t("sshHistory.allSessions", "All Sessions")}
            </option>
            {mgr.availableSessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          {/* Status filter */}
          <select
            value={mgr.filter.statusFilter}
            onChange={(e) =>
              mgr.updateFilter({
                statusFilter: e.target.value as typeof mgr.filter.statusFilter,
              })
            }
            className="text-xs px-2 py-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
          >
            <option value="all">
              {t("sshHistory.allStatuses", "All Statuses")}
            </option>
            <option value="success">{t("sshHistory.success", "Success")}</option>
            <option value="error">{t("sshHistory.error", "Error")}</option>
            <option value="pending">{t("sshHistory.pending", "Pending")}</option>
          </select>

          {/* Sort by */}
          <select
            value={mgr.filter.sortBy}
            onChange={(e) =>
              mgr.updateFilter({
                sortBy: e.target.value as typeof mgr.filter.sortBy,
              })
            }
            className="text-xs px-2 py-1 bg-[var(--color-input)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
          >
            <option value="lastExecutedAt">
              {t("sshHistory.sortByRecent", "Most Recent")}
            </option>
            <option value="executionCount">
              {t("sshHistory.sortByFrequency", "Most Frequent")}
            </option>
            <option value="command">
              {t("sshHistory.sortByCommand", "Alphabetical")}
            </option>
            <option value="createdAt">
              {t("sshHistory.sortByCreated", "Date Created")}
            </option>
          </select>

          {/* Reset button */}
          <button
            onClick={mgr.resetFilter}
            className="text-xs px-2 py-1 text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
          >
            {t("sshHistory.resetFilters", "Reset")}
          </button>
        </div>
      )}
    </div>
  );
}

export default HistorySearchBar;
