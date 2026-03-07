import React from "react";
import {
  Star,
  Play,
  Trash2,
  Copy,
  Tag,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  Clock,
  Hash,
  MessageSquare,
  X,
} from "lucide-react";
import type { SSHCommandHistoryEntry, SSHCommandCategory } from "../../../types/ssh/sshCommandHistory";
import type { TFunc } from "./types";

const CATEGORY_COLORS: Record<SSHCommandCategory, string> = {
  system: "text-primary bg-primary/10",
  network: "text-info bg-info/10",
  file: "text-warning bg-warning/10",
  process: "text-warning bg-warning/10",
  package: "text-accent bg-accent/10",
  docker: "text-sky-500 bg-sky-500/10",
  kubernetes: "text-accent bg-accent/10",
  git: "text-error bg-error/10",
  database: "text-success bg-success/10",
  service: "text-teal-500 bg-teal-500/10",
  security: "text-rose-500 bg-rose-500/10",
  user: "text-accent bg-accent/10",
  disk: "text-lime-500 bg-lime-500/10",
  custom: "text-accent bg-accent/10",
  unknown: "text-text-secondary bg-text-secondary/10",
};

function StatusIcon({ status }: { status: string }) {
  if (status === "success")
    return <CheckCircle2 size={12} className="text-success" />;
  if (status === "error")
    return <XCircle size={12} className="text-error" />;
  return <Clock size={12} className="text-warning" />;
}

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(isoDate).toLocaleDateString();
}

interface HistoryEntryProps {
  entry: SSHCommandHistoryEntry;
  isSelected: boolean;
  t: TFunc;
  onSelect: () => void;
  onToggleStar: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onReExecute?: () => void;
  onUpdateNote?: (note: string) => void;
  onUpdateTags?: (tags: string[]) => void;
  compact?: boolean;
}

function HistoryEntry({
  entry,
  isSelected,
  t,
  onSelect,
  onToggleStar,
  onDelete,
  onCopy,
  onReExecute,
  onUpdateNote,
  onUpdateTags,
  compact,
}: HistoryEntryProps) {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [editingNote, setEditingNote] = React.useState(false);
  const [noteValue, setNoteValue] = React.useState(entry.note ?? "");
  const [editingTags, setEditingTags] = React.useState(false);
  const [tagInput, setTagInput] = React.useState("");

  const lastExecution = entry.executions[entry.executions.length - 1];
  const catColor = CATEGORY_COLORS[entry.category] ?? CATEGORY_COLORS.unknown;

  return (
    <div
      className={`border-b border-[var(--color-border)]/30 transition-colors ${
        isSelected
          ? "bg-success/10 border-l-2 border-l-success"
          : "hover:bg-[var(--color-surfaceHover)]/50"
      }`}
    >
      {/* Main row */}
      <div
        className="flex items-start gap-2 px-3 py-2 cursor-pointer"
        onClick={onSelect}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onSelect();
        }}
      >
        {/* Star button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleStar();
          }}
          className={`mt-0.5 flex-shrink-0 transition-colors ${
            entry.starred
              ? "text-warning"
              : "text-[var(--color-textMuted)] hover:text-warning"
          }`}
          title={t("sshHistory.toggleStar", "Toggle star")}
        >
          <Star
            size={14}
            fill={entry.starred ? "currentColor" : "none"}
          />
        </button>

        {/* Command + metadata */}
        <div className="flex-1 min-w-0">
          <code className="block text-sm font-mono text-[var(--color-text)] truncate">
            {entry.command}
          </code>
          {!compact && (
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${catColor}`}
              >
                {entry.category}
              </span>
              <span className="flex items-center gap-0.5 text-[10px] text-[var(--color-textSecondary)]">
                <Hash size={9} />
                {entry.executionCount}
              </span>
              <span className="flex items-center gap-0.5 text-[10px] text-[var(--color-textSecondary)]">
                <Clock size={9} />
                {formatRelativeTime(entry.lastExecutedAt)}
              </span>
              {lastExecution && (
                <StatusIcon status={lastExecution.status} />
              )}
              {entry.tags.length > 0 &&
                entry.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)]"
                  >
                    <Tag size={8} />
                    {tag}
                  </span>
                ))}
              {entry.note && (
                <span className="flex items-center gap-0.5 text-[10px] text-[var(--color-textSecondary)]">
                  <MessageSquare size={9} />
                </span>
              )}
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {onReExecute && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onReExecute();
              }}
              className="p-1 rounded text-[var(--color-textSecondary)] hover:text-success hover:bg-success/10 transition-colors"
              title={t("sshHistory.reExecute", "Re-execute")}
            >
              <Play size={12} />
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCopy();
            }}
            className="p-1 rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surfaceHover)] transition-colors"
            title={t("sshHistory.copyCommand", "Copy command")}
          >
            <Copy size={12} />
          </button>
          {!compact && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded((prev) => !prev);
              }}
              className="p-1 rounded text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
            >
              {isExpanded ? (
                <ChevronUp size={12} />
              ) : (
                <ChevronDown size={12} />
              )}
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-1 rounded text-[var(--color-textSecondary)] hover:text-error hover:bg-error/10 transition-colors"
            title={t("sshHistory.delete", "Delete")}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {isExpanded && !compact && (
        <div className="px-3 pb-3 space-y-2">
          {/* Full command */}
          <div className="bg-[var(--color-background)] rounded p-2 border border-[var(--color-border)]/50">
            <pre className="text-xs font-mono text-[var(--color-text)] whitespace-pre-wrap break-all">
              {entry.command}
            </pre>
          </div>

          {/* Note */}
          <div className="flex items-start gap-2">
            <MessageSquare
              size={12}
              className="text-[var(--color-textSecondary)] mt-1 flex-shrink-0"
            />
            {editingNote ? (
              <div className="flex-1 flex gap-1">
                <input
                  type="text"
                  value={noteValue}
                  onChange={(e) => setNoteValue(e.target.value)}
                  onBlur={() => {
                    onUpdateNote?.(noteValue);
                    setEditingNote(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      onUpdateNote?.(noteValue);
                      setEditingNote(false);
                    }
                    if (e.key === "Escape") setEditingNote(false);
                  }}
                  className="flex-1 text-xs px-2 py-0.5 bg-[var(--color-input)] border border-[var(--color-border)] rounded text-[var(--color-text)]"
                  placeholder={t("sshHistory.addNote", "Add a note...")}
                  autoFocus
                />
              </div>
            ) : (
              <button
                onClick={() => setEditingNote(true)}
                className="text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)] transition-colors"
              >
                {entry.note || t("sshHistory.addNote", "Add a note...")}
              </button>
            )}
          </div>

          {/* Tags */}
          <div className="flex items-center gap-1 flex-wrap">
            <Tag
              size={12}
              className="text-[var(--color-textSecondary)] flex-shrink-0"
            />
            {entry.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-[var(--color-surfaceHover)] text-[var(--color-textSecondary)] group"
              >
                {tag}
                <button
                  onClick={() =>
                    onUpdateTags?.(entry.tags.filter((t) => t !== tag))
                  }
                  className="ml-0.5 opacity-0 group-hover:opacity-100 hover:text-error transition-opacity"
                >
                  <X size={8} />
                </button>
              </span>
            ))}
            {editingTags ? (
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && tagInput.trim()) {
                    onUpdateTags?.([...entry.tags, tagInput.trim()]);
                    setTagInput("");
                    setEditingTags(false);
                  }
                  if (e.key === "Escape") setEditingTags(false);
                }}
                onBlur={() => setEditingTags(false)}
                className="text-[10px] px-1.5 py-0.5 bg-[var(--color-input)] border border-[var(--color-border)] rounded text-[var(--color-text)] w-20"
                placeholder="tag"
                autoFocus
              />
            ) : (
              <button
                onClick={() => setEditingTags(true)}
                className="text-[10px] px-1.5 py-0.5 rounded border border-dashed border-[var(--color-border)] text-[var(--color-textMuted)] hover:text-[var(--color-text)] hover:border-[var(--color-text)] transition-colors"
              >
                + {t("sshHistory.addTag", "tag")}
              </button>
            )}
          </div>

          {/* Execution history */}
          {entry.executions.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-[var(--color-textSecondary)] mb-1 font-medium">
                {t("sshHistory.recentExecutions", "Recent Executions")}
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {entry.executions
                  .slice(-5)
                  .reverse()
                  .map((ex, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-2 text-[10px] text-[var(--color-textSecondary)] px-2 py-1 rounded bg-[var(--color-background)]/50"
                    >
                      <StatusIcon status={ex.status} />
                      <span className="font-medium truncate">
                        {ex.sessionName || ex.hostname}
                      </span>
                      {ex.durationMs != null && (
                        <span>{ex.durationMs}ms</span>
                      )}
                      {ex.exitCode != null && (
                        <span className="font-mono">
                          exit: {ex.exitCode}
                        </span>
                      )}
                      {ex.output && (
                        <span
                          className="truncate flex-1 font-mono opacity-60"
                          title={ex.output}
                        >
                          {ex.output.slice(0, 80)}
                        </span>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default HistoryEntry;
