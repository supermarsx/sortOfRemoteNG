import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { generateId } from "../../utils/id";
import {
  SSHCommandHistoryEntry,
  SSHCommandHistoryFilter,
  SSHCommandHistoryStats,
  SSHCommandHistoryConfig,
  SSHCommandCategory,
  CommandExecution,
  CommandExecutionStatus,
  HistoryExportOptions,
  HistoryImportResult,
  defaultHistoryFilter,
  defaultHistoryConfig,
} from "../../types/sshCommandHistory";

// ─── Constants ─────────────────────────────────────────────────

const HISTORY_STORAGE_KEY = "sshCommandHistory";
const CONFIG_STORAGE_KEY = "sshCommandHistoryConfig";

// ─── Category auto-detection ───────────────────────────────────

const CATEGORY_PATTERNS: Array<{ pattern: RegExp; category: SSHCommandCategory }> = [
  { pattern: /\b(docker|podman|container|compose)\b/i, category: "docker" },
  { pattern: /\b(kubectl|k8s|helm|minikube|kube)\b/i, category: "kubernetes" },
  { pattern: /\b(git|svn|hg)\b/i, category: "git" },
  { pattern: /\b(mysql|psql|mongo|redis-cli|sqlite|pg_dump|mysqldump)\b/i, category: "database" },
  { pattern: /\b(systemctl|service|journalctl|supervisorctl)\b/i, category: "service" },
  { pattern: /\b(apt|yum|dnf|pacman|brew|pip|npm|gem|cargo)\b/i, category: "package" },
  { pattern: /\b(netstat|ss|ifconfig|ip\s|ping|traceroute|nslookup|dig|curl|wget|nmap|tcpdump|iptables|firewall)\b/i, category: "network" },
  { pattern: /\b(ps|top|htop|kill|killall|pkill|pgrep|nice|renice|nohup)\b/i, category: "process" },
  { pattern: /\b(ls|cat|cp|mv|rm|mkdir|chmod|chown|find|grep|awk|sed|tar|zip|unzip|rsync|scp|ln|stat|du|head|tail|wc|sort|diff)\b/i, category: "file" },
  { pattern: /\b(df|fdisk|mount|umount|lsblk|blkid|mkfs|fsck|swap)\b/i, category: "disk" },
  { pattern: /\b(useradd|userdel|usermod|passwd|groupadd|su\s|sudo|who|w\s|last|id\s)\b/i, category: "user" },
  { pattern: /\b(ssh-keygen|openssl|gpg|fail2ban|selinux|apparmor|ufw|audit)\b/i, category: "security" },
  { pattern: /\b(uname|hostname|uptime|date|cal|free|lscpu|lsmod|dmesg|sysctl|vmstat|iostat|sar)\b/i, category: "system" },
];

function detectCategory(command: string): SSHCommandCategory {
  for (const { pattern, category } of CATEGORY_PATTERNS) {
    if (pattern.test(command)) return category;
  }
  return "unknown";
}

// ─── Helpers ───────────────────────────────────────────────────

function loadHistory(): SSHCommandHistoryEntry[] {
  try {
    const stored = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!stored) return [];
    return JSON.parse(stored) as SSHCommandHistoryEntry[];
  } catch {
    return [];
  }
}

function saveHistory(entries: SSHCommandHistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded — trim oldest non-starred entries and retry
    const trimmed = entries
      .sort((a, b) => {
        if (a.starred !== b.starred) return a.starred ? -1 : 1;
        return new Date(b.lastExecutedAt).getTime() - new Date(a.lastExecutedAt).getTime();
      })
      .slice(0, Math.floor(entries.length * 0.75));
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // give up silently
    }
  }
}

function loadConfig(): SSHCommandHistoryConfig {
  try {
    const stored = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!stored) return defaultHistoryConfig;
    return { ...defaultHistoryConfig, ...JSON.parse(stored) };
  } catch {
    return defaultHistoryConfig;
  }
}

function saveConfig(config: SSHCommandHistoryConfig): void {
  try {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // ignore
  }
}

function fuzzyMatch(text: string, query: string): boolean {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  if (lowerText.includes(lowerQuery)) return true;
  // Simple subsequence match
  let qi = 0;
  for (let ti = 0; ti < lowerText.length && qi < lowerQuery.length; ti++) {
    if (lowerText[ti] === lowerQuery[qi]) qi++;
  }
  return qi === lowerQuery.length;
}

function truncateOutput(output: string, maxSize: number): string {
  if (output.length <= maxSize) return output;
  return output.slice(0, maxSize) + "\n... [truncated]";
}

// ─── Retention enforcement ─────────────────────────────────────

function enforceRetention(
  entries: SSHCommandHistoryEntry[],
  config: SSHCommandHistoryConfig,
): SSHCommandHistoryEntry[] {
  let result = entries;

  // Enforce retention days
  if (config.retentionDays > 0) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - config.retentionDays);
    const cutoffStr = cutoff.toISOString();
    result = result.filter(
      (e) => e.starred || e.lastExecutedAt >= cutoffStr,
    );
  }

  // Enforce max entries
  if (result.length > config.maxEntries) {
    // Keep starred entries, then most recent
    const starred = result.filter((e) => e.starred);
    const unstarred = result
      .filter((e) => !e.starred)
      .sort((a, b) => b.lastExecutedAt.localeCompare(a.lastExecutedAt));
    const keep = config.maxEntries - starred.length;
    result = [...starred, ...unstarred.slice(0, Math.max(0, keep))];
  }

  return result;
}

// ─── Export helpers ────────────────────────────────────────────

function exportAsJSON(
  entries: SSHCommandHistoryEntry[],
  options: HistoryExportOptions,
): string {
  const data = entries.map((e) => {
    const base: Record<string, unknown> = { command: e.command };
    if (options.includeMetadata) {
      base.id = e.id;
      base.createdAt = e.createdAt;
      base.lastExecutedAt = e.lastExecutedAt;
      base.executionCount = e.executionCount;
      base.starred = e.starred;
      base.tags = e.tags;
      base.category = e.category;
      base.note = e.note;
    }
    if (options.includeOutput) {
      base.executions = e.executions;
    }
    return base;
  });
  return JSON.stringify(data, null, 2);
}

function exportAsShell(entries: SSHCommandHistoryEntry[]): string {
  const lines = [
    "#!/usr/bin/env bash",
    `# SSH Command History Export — ${new Date().toISOString()}`,
    `# ${entries.length} commands`,
    "",
  ];
  for (const e of entries) {
    lines.push(`# [${e.lastExecutedAt}] (${e.executionCount}x) ${e.category}`);
    if (e.note) lines.push(`# Note: ${e.note}`);
    lines.push(e.command);
    lines.push("");
  }
  return lines.join("\n");
}

function exportAsCSV(
  entries: SSHCommandHistoryEntry[],
  options: HistoryExportOptions,
): string {
  const headers = ["command", "lastExecutedAt", "executionCount", "category", "starred", "tags"];
  if (options.includeMetadata) headers.push("note", "createdAt", "id");
  const rows = entries.map((e) => {
    const row: string[] = [
      `"${e.command.replace(/"/g, '""')}"`,
      e.lastExecutedAt,
      String(e.executionCount),
      e.category,
      String(e.starred),
      `"${e.tags.join(", ")}"`,
    ];
    if (options.includeMetadata) {
      row.push(
        `"${(e.note ?? "").replace(/"/g, '""')}"`,
        e.createdAt,
        e.id,
      );
    }
    return row.join(",");
  });
  return [headers.join(","), ...rows].join("\n");
}

// ─── Hook ──────────────────────────────────────────────────────

export function useSSHCommandHistory(sessionId?: string) {
  const [entries, setEntries] = useState<SSHCommandHistoryEntry[]>(() => loadHistory());
  const [config, setConfig] = useState<SSHCommandHistoryConfig>(() => loadConfig());
  const [filter, setFilter] = useState<SSHCommandHistoryFilter>(defaultHistoryFilter);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  // Arrow-key navigation index (-1 = not navigating, 0 = most recent)
  const [navigationIndex, setNavigationIndex] = useState(-1);
  const navigationSnapshotRef = useRef<string>("");

  // ── Persist on change ───────────────────────────────────────

  useEffect(() => {
    if (config.persistEnabled) {
      const enforced = enforceRetention(entries, config);
      // Only save if retention actually trimmed something
      if (enforced.length !== entries.length) {
        setEntries(enforced);
      }
      saveHistory(enforced.length !== entries.length ? enforced : entries);
    }
  }, [entries, config]);

  useEffect(() => {
    saveConfig(config);
  }, [config]);

  // ── Filtered & sorted entries ───────────────────────────────

  const filteredEntries = useMemo(() => {
    let result = entries;

    // Session filter
    if (filter.sessionId !== "all") {
      result = result.filter((e) =>
        e.executions.some((ex) => ex.sessionId === filter.sessionId),
      );
    }

    // If sessionId prop is provided, default to also showing that session's entries
    if (sessionId && filter.sessionId === "all") {
      // still show all in "all" mode
    }

    // Text search
    if (filter.searchQuery) {
      result = result.filter(
        (e) =>
          fuzzyMatch(e.command, filter.searchQuery) ||
          e.tags.some((tag) => fuzzyMatch(tag, filter.searchQuery)) ||
          (e.note && fuzzyMatch(e.note, filter.searchQuery)),
      );
    }

    // Category
    if (filter.category !== "all") {
      result = result.filter((e) => e.category === filter.category);
    }

    // Starred only
    if (filter.starredOnly) {
      result = result.filter((e) => e.starred);
    }

    // Date range
    if (filter.dateFrom) {
      result = result.filter((e) => e.lastExecutedAt >= filter.dateFrom!);
    }
    if (filter.dateTo) {
      result = result.filter((e) => e.lastExecutedAt <= filter.dateTo!);
    }

    // Status filter
    if (filter.statusFilter !== "all") {
      result = result.filter((e) => {
        const last = e.executions[e.executions.length - 1];
        return last?.status === filter.statusFilter;
      });
    }

    // Sort
    result = [...result].sort((a, b) => {
      const dir = filter.sortDirection === "asc" ? 1 : -1;
      switch (filter.sortBy) {
        case "lastExecutedAt":
          return dir * a.lastExecutedAt.localeCompare(b.lastExecutedAt);
        case "createdAt":
          return dir * a.createdAt.localeCompare(b.createdAt);
        case "executionCount":
          return dir * (a.executionCount - b.executionCount);
        case "command":
          return dir * a.command.localeCompare(b.command);
        default:
          return 0;
      }
    });

    return result;
  }, [entries, filter, sessionId]);

  // ── Statistics ──────────────────────────────────────────────

  const stats = useMemo((): SSHCommandHistoryStats => {
    const totalExecutions = entries.reduce((sum, e) => sum + e.executionCount, 0);
    const allSessions = new Set<string>();
    let successCount = 0;
    let totalWithStatus = 0;

    const categoryBreakdown = {} as Record<SSHCommandCategory, number>;

    for (const entry of entries) {
      categoryBreakdown[entry.category] = (categoryBreakdown[entry.category] ?? 0) + 1;
      for (const ex of entry.executions) {
        allSessions.add(ex.sessionId);
        if (ex.status === "success" || ex.status === "error") {
          totalWithStatus++;
          if (ex.status === "success") successCount++;
        }
      }
    }

    // Top commands by frequency
    const topCommands = [...entries]
      .sort((a, b) => b.executionCount - a.executionCount)
      .slice(0, 10)
      .map((e) => ({ command: e.command, count: e.executionCount }));

    // Recent activity (last 14 days)
    const recentActivity: Array<{ date: string; count: number }> = [];
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const count = entries.filter(
        (e) => e.lastExecutedAt.slice(0, 10) === dateStr,
      ).length;
      recentActivity.push({ date: dateStr, count });
    }

    return {
      totalCommands: entries.length,
      uniqueCommands: new Set(entries.map((e) => e.command)).size,
      totalExecutions,
      starredCount: entries.filter((e) => e.starred).length,
      successRate: totalWithStatus > 0 ? successCount / totalWithStatus : 0,
      topCommands,
      categoryBreakdown,
      recentActivity,
      sessionsUsed: allSessions.size,
      avgExecutionsPerCommand:
        entries.length > 0 ? totalExecutions / entries.length : 0,
    };
  }, [entries]);

  // ── Available sessions for filter ───────────────────────────

  const availableSessions = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of entries) {
      for (const ex of entry.executions) {
        if (!map.has(ex.sessionId)) {
          map.set(ex.sessionId, ex.sessionName || ex.hostname || ex.sessionId);
        }
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [entries]);

  // ── Add to history ──────────────────────────────────────────

  const addEntry = useCallback(
    (command: string, executions: CommandExecution[]) => {
      setEntries((prev) => {
        // Check for duplicate
        const existing = prev.find(
          (e) => e.command.trim() === command.trim(),
        );

        if (existing) {
          // Update existing entry
          const updated = prev.map((e) =>
            e.id === existing.id
              ? {
                  ...e,
                  lastExecutedAt: new Date().toISOString(),
                  executionCount: e.executionCount + 1,
                  executions: [
                    ...e.executions,
                    ...executions.map((ex) => ({
                      ...ex,
                      output: config.trackOutput
                        ? truncateOutput(ex.output ?? "", config.maxOutputSize)
                        : undefined,
                    })),
                  ].slice(-20), // keep last 20 executions per entry
                }
              : e,
          );
          return enforceRetention(updated, config);
        }

        // New entry
        const category = config.autoCategorize
          ? detectCategory(command)
          : "unknown";
        const newEntry: SSHCommandHistoryEntry = {
          id: generateId(),
          command: command.trim(),
          createdAt: new Date().toISOString(),
          lastExecutedAt: new Date().toISOString(),
          executionCount: 1,
          starred: false,
          tags: [],
          category,
          executions: executions.map((ex) => ({
            ...ex,
            output: config.trackOutput
              ? truncateOutput(ex.output ?? "", config.maxOutputSize)
              : undefined,
          })),
        };

        return enforceRetention([newEntry, ...prev], config);
      });
    },
    [config],
  );

  // ── Toggle star ─────────────────────────────────────────────

  const toggleStar = useCallback((entryId: string) => {
    setEntries((prev) =>
      prev.map((e) =>
        e.id === entryId ? { ...e, starred: !e.starred } : e,
      ),
    );
  }, []);

  // ── Update tags ─────────────────────────────────────────────

  const updateTags = useCallback((entryId: string, tags: string[]) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === entryId ? { ...e, tags } : e)),
    );
  }, []);

  // ── Update note ─────────────────────────────────────────────

  const updateNote = useCallback((entryId: string, note: string) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === entryId ? { ...e, note } : e)),
    );
  }, []);

  // ── Update category ─────────────────────────────────────────

  const updateCategory = useCallback(
    (entryId: string, category: SSHCommandCategory) => {
      setEntries((prev) =>
        prev.map((e) => (e.id === entryId ? { ...e, category } : e)),
      );
    },
    [],
  );

  // ── Delete entry ────────────────────────────────────────────

  const deleteEntry = useCallback((entryId: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== entryId));
    setSelectedEntryId((prev) => (prev === entryId ? null : prev));
  }, []);

  // ── Delete all (with optional filter) ───────────────────────

  const clearHistory = useCallback(
    (keepStarred = true) => {
      if (keepStarred) {
        setEntries((prev) => prev.filter((e) => e.starred));
      } else {
        setEntries([]);
      }
      setSelectedEntryId(null);
    },
    [],
  );

  // ── Arrow-key history navigation ────────────────────────────

  const navigateUp = useCallback(
    (currentInput: string): string | null => {
      const historyList = filteredEntries;
      if (historyList.length === 0) return null;

      setNavigationIndex((prev) => {
        // Snapshot current input on first navigation
        if (prev === -1) {
          navigationSnapshotRef.current = currentInput;
        }
        const next = Math.min(prev + 1, historyList.length - 1);
        return next;
      });

      // Return the command at the new index
      const nextIdx = Math.min(
        navigationIndex + 1,
        historyList.length - 1,
      );
      return historyList[nextIdx]?.command ?? null;
    },
    [filteredEntries, navigationIndex],
  );

  const navigateDown = useCallback((): string | null => {
    setNavigationIndex((prev) => {
      if (prev <= 0) return -1;
      return prev - 1;
    });

    if (navigationIndex <= 0) {
      return navigationSnapshotRef.current;
    }

    const nextIdx = navigationIndex - 1;
    return filteredEntries[nextIdx]?.command ?? navigationSnapshotRef.current;
  }, [filteredEntries, navigationIndex]);

  const resetNavigation = useCallback(() => {
    setNavigationIndex(-1);
    navigationSnapshotRef.current = "";
  }, []);

  // ── Export ──────────────────────────────────────────────────

  const exportHistory = useCallback(
    (options: HistoryExportOptions): string => {
      let exportEntries = filteredEntries;

      if (options.starredOnly) {
        exportEntries = exportEntries.filter((e) => e.starred);
      }
      if (options.dateFrom) {
        exportEntries = exportEntries.filter(
          (e) => e.lastExecutedAt >= options.dateFrom!,
        );
      }
      if (options.dateTo) {
        exportEntries = exportEntries.filter(
          (e) => e.lastExecutedAt <= options.dateTo!,
        );
      }

      switch (options.format) {
        case "json":
          return exportAsJSON(exportEntries, options);
        case "shell":
          return exportAsShell(exportEntries);
        case "csv":
          return exportAsCSV(exportEntries, options);
        default:
          return exportAsJSON(exportEntries, options);
      }
    },
    [filteredEntries],
  );

  // ── Import ──────────────────────────────────────────────────

  const importHistory = useCallback(
    (jsonString: string): HistoryImportResult => {
      const result: HistoryImportResult = {
        imported: 0,
        duplicatesSkipped: 0,
        errors: [],
      };

      try {
        const parsed = JSON.parse(jsonString);
        if (!Array.isArray(parsed)) {
          result.errors.push("Import data must be a JSON array");
          return result;
        }

        setEntries((prev) => {
          const existingCommands = new Set(prev.map((e) => e.command.trim()));
          const newEntries: SSHCommandHistoryEntry[] = [];

          for (const item of parsed) {
            if (!item.command || typeof item.command !== "string") {
              result.errors.push(
                `Skipped item: missing or invalid 'command' field`,
              );
              continue;
            }

            if (existingCommands.has(item.command.trim())) {
              result.duplicatesSkipped++;
              continue;
            }

            existingCommands.add(item.command.trim());
            newEntries.push({
              id: item.id ?? generateId(),
              command: item.command.trim(),
              createdAt: item.createdAt ?? new Date().toISOString(),
              lastExecutedAt: item.lastExecutedAt ?? new Date().toISOString(),
              executionCount: item.executionCount ?? 1,
              starred: item.starred ?? false,
              tags: Array.isArray(item.tags) ? item.tags : [],
              category: item.category ?? detectCategory(item.command),
              executions: Array.isArray(item.executions) ? item.executions : [],
              note: item.note,
            });
            result.imported++;
          }

          return enforceRetention([...prev, ...newEntries], config);
        });
      } catch (error) {
        result.errors.push(
          `Parse error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return result;
    },
    [config],
  );

  // ── Config updates ──────────────────────────────────────────

  const updateConfig = useCallback(
    (update: Partial<SSHCommandHistoryConfig>) => {
      setConfig((prev) => ({ ...prev, ...update }));
    },
    [],
  );

  // ── Filter updates ──────────────────────────────────────────

  const updateFilter = useCallback(
    (update: Partial<SSHCommandHistoryFilter>) => {
      setFilter((prev) => ({ ...prev, ...update }));
    },
    [],
  );

  const resetFilter = useCallback(() => {
    setFilter(defaultHistoryFilter);
  }, []);

  // ── Panel toggle ────────────────────────────────────────────

  const togglePanel = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const openPanel = useCallback(() => setIsOpen(true), []);
  const closePanel = useCallback(() => setIsOpen(false), []);

  // ── Re-execute (returns the command string) ─────────────────

  const getReExecuteCommand = useCallback(
    (entryId: string): string | null => {
      const entry = entries.find((e) => e.id === entryId);
      return entry?.command ?? null;
    },
    [entries],
  );

  // ── Selected entry detail ───────────────────────────────────

  const selectedEntry = useMemo(
    () => entries.find((e) => e.id === selectedEntryId) ?? null,
    [entries, selectedEntryId],
  );

  return {
    // State
    entries: filteredEntries,
    allEntries: entries,
    filter,
    config,
    stats,
    isOpen,
    selectedEntryId,
    selectedEntry,
    navigationIndex,
    availableSessions,

    // Entry operations
    addEntry,
    deleteEntry,
    toggleStar,
    updateTags,
    updateNote,
    updateCategory,
    clearHistory,
    getReExecuteCommand,

    // Navigation
    navigateUp,
    navigateDown,
    resetNavigation,

    // Filter
    updateFilter,
    resetFilter,

    // Config
    updateConfig,

    // Export/Import
    exportHistory,
    importHistory,

    // Panel
    isOpen: isOpen,
    togglePanel,
    openPanel,
    closePanel,
    setSelectedEntryId,
  };
}

export type SSHCommandHistoryMgr = ReturnType<typeof useSSHCommandHistory>;
