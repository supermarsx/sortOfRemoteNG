import React from "react";
import { Search, Filter, X, ArrowUpDown, Star } from "lucide-react";
import { SSHCommandCategories } from "../../../types/ssh/sshCommandHistory";
import { Select } from "../../ui/forms";
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
            className="sor-form-input-sm w-full pl-8 pr-8 font-mono"
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
              ? "text-warning bg-warning/10"
              : "text-[var(--color-textSecondary)] hover:text-warning"
          }`}
          title={t("sshHistory.starredOnly", "Starred only")}
        >
          <Star size={14} fill={mgr.filter.starredOnly ? "currentColor" : "none"} />
        </button>

        <button
          onClick={() => setShowAdvanced((prev) => !prev)}
          className={`p-1.5 rounded transition-colors ${
            showAdvanced
              ? "text-success bg-success/10"
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
          <Select
            value={mgr.filter.category}
            onChange={(v) => mgr.updateFilter({ category: v as typeof mgr.filter.category })}
            variant="form-sm"
            options={[
              { value: 'all', label: t("sshHistory.allCategories", "All Categories") },
              ...SSHCommandCategories.map((cat) => ({ value: cat, label: cat.charAt(0).toUpperCase() + cat.slice(1) })),
            ]}
          />

          {/* Session filter */}
          <Select
            value={mgr.filter.sessionId}
            onChange={(v) => mgr.updateFilter({ sessionId: v })}
            variant="form-sm"
            options={[
              { value: 'all', label: t("sshHistory.allSessions", "All Sessions") },
              ...mgr.availableSessions.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />

          {/* Status filter */}
          <Select
            value={mgr.filter.statusFilter}
            onChange={(v) => mgr.updateFilter({ statusFilter: v as typeof mgr.filter.statusFilter })}
            variant="form-sm"
            options={[
              { value: 'all', label: t("sshHistory.allStatuses", "All Statuses") },
              { value: 'success', label: t("sshHistory.success", "Success") },
              { value: 'error', label: t("sshHistory.error", "Error") },
              { value: 'pending', label: t("sshHistory.pending", "Pending") },
            ]}
          />

          {/* Sort by */}
          <Select
            value={mgr.filter.sortBy}
            onChange={(v) => mgr.updateFilter({ sortBy: v as typeof mgr.filter.sortBy })}
            variant="form-sm"
            options={[
              { value: 'lastExecutedAt', label: t("sshHistory.sortByRecent", "Most Recent") },
              { value: 'executionCount', label: t("sshHistory.sortByFrequency", "Most Frequent") },
              { value: 'command', label: t("sshHistory.sortByCommand", "Alphabetical") },
              { value: 'createdAt', label: t("sshHistory.sortByCreated", "Date Created") },
            ]}
          />

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
