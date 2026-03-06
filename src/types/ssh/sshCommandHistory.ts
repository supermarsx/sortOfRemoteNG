/**
 * SSH Command History — types for persistent, searchable command history
 * with per-session tracking, favorites, frequency analytics, and export/import.
 */

// ─── Core Entry ────────────────────────────────────────────────

/** Result status of a command execution. */
export type CommandExecutionStatus = "success" | "error" | "pending" | "cancelled";

/** A single execution of a command against one session. */
export interface CommandExecution {
  sessionId: string;
  sessionName: string;
  hostname: string;
  status: CommandExecutionStatus;
  output?: string;
  errorMessage?: string;
  exitCode?: number;
  durationMs?: number;
}

/** A single entry in the SSH command history. */
export interface SSHCommandHistoryEntry {
  /** Unique identifier */
  id: string;
  /** The command string that was executed */
  command: string;
  /** ISO timestamp of the first execution */
  createdAt: string;
  /** ISO timestamp of the most recent execution */
  lastExecutedAt: string;
  /** Number of times this command has been executed */
  executionCount: number;
  /** Whether the user has starred/favorited this entry */
  starred: boolean;
  /** Optional user-assigned tags */
  tags: string[];
  /** Auto-detected command category (e.g. 'system', 'network', 'file') */
  category: SSHCommandCategory;
  /** Per-session execution records (most recent for each session) */
  executions: CommandExecution[];
  /** Optional user-provided note */
  note?: string;
}

// ─── Categories ────────────────────────────────────────────────

export const SSHCommandCategories = [
  "system",
  "network",
  "file",
  "process",
  "package",
  "docker",
  "kubernetes",
  "git",
  "database",
  "service",
  "security",
  "user",
  "disk",
  "custom",
  "unknown",
] as const;
export type SSHCommandCategory = (typeof SSHCommandCategories)[number];

// ─── Filters ───────────────────────────────────────────────────

export type HistorySortField = "lastExecutedAt" | "createdAt" | "executionCount" | "command";
export type HistorySortDirection = "asc" | "desc";

export interface SSHCommandHistoryFilter {
  /** Free-text search (command text, tags, notes) */
  searchQuery: string;
  /** Only entries with this category */
  category: SSHCommandCategory | "all";
  /** Only entries associated with this session ID */
  sessionId: string | "all";
  /** Only starred entries */
  starredOnly: boolean;
  /** Only entries executed after this ISO date */
  dateFrom: string | null;
  /** Only entries executed before this ISO date */
  dateTo: string | null;
  /** Only entries with this execution status (most recent) */
  statusFilter: CommandExecutionStatus | "all";
  /** Sort field */
  sortBy: HistorySortField;
  /** Sort direction */
  sortDirection: HistorySortDirection;
}

export const defaultHistoryFilter: SSHCommandHistoryFilter = {
  searchQuery: "",
  category: "all",
  sessionId: "all",
  starredOnly: false,
  dateFrom: null,
  dateTo: null,
  statusFilter: "all",
  sortBy: "lastExecutedAt",
  sortDirection: "desc",
};

// ─── Statistics ────────────────────────────────────────────────

export interface SSHCommandHistoryStats {
  totalCommands: number;
  uniqueCommands: number;
  totalExecutions: number;
  starredCount: number;
  successRate: number;
  topCommands: Array<{ command: string; count: number }>;
  categoryBreakdown: Record<SSHCommandCategory, number>;
  recentActivity: Array<{ date: string; count: number }>;
  sessionsUsed: number;
  avgExecutionsPerCommand: number;
}

// ─── Storage / Config ──────────────────────────────────────────

export interface SSHCommandHistoryConfig {
  /** Maximum number of history entries to retain */
  maxEntries: number;
  /** Auto-delete entries older than this many days (0 = never) */
  retentionDays: number;
  /** Whether to persist history across app restarts */
  persistEnabled: boolean;
  /** Whether to track command output in history */
  trackOutput: boolean;
  /** Maximum output size to store per execution (bytes) */
  maxOutputSize: number;
  /** Auto-categorize commands */
  autoCategorize: boolean;
  /** De-duplicate consecutive identical commands */
  deduplicateConsecutive: boolean;
}

export const defaultHistoryConfig: SSHCommandHistoryConfig = {
  maxEntries: 1000,
  retentionDays: 90,
  persistEnabled: true,
  trackOutput: true,
  maxOutputSize: 4096,
  autoCategorize: true,
  deduplicateConsecutive: true,
};

// ─── Export / Import ───────────────────────────────────────────

export type HistoryExportFormat = "json" | "shell" | "csv";

export interface HistoryExportOptions {
  format: HistoryExportFormat;
  includeOutput: boolean;
  includeMetadata: boolean;
  starredOnly: boolean;
  dateFrom?: string;
  dateTo?: string;
}

export interface HistoryImportResult {
  imported: number;
  duplicatesSkipped: number;
  errors: string[];
}
