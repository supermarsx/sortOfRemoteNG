import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { generateId } from "../../utils/core/id";
import {
  SSHCommandHistoryEntry,
  SSHCommandHistoryFilter,
  SSHCommandHistoryStats,
  SSHCommandHistoryConfig,
  SSHCommandCategory,
  CommandExecution,
  HistoryExportOptions,
  HistoryImportResult,
  defaultHistoryFilter,
  defaultHistoryConfig,
} from "../../types/ssh/sshCommandHistory";
import { commandExecutionDisplayStatus } from "../../utils/ssh/sshCommandEvidence";
import {
  SSH_COMMAND_HISTORY_SYNC_EVENT,
  MAX_SSH_HISTORY_COMMAND_CHARS,
  MAX_SSH_HISTORY_ENTRIES,
  MAX_SSH_HISTORY_OUTPUT_CHARS,
  redactSSHCommandHistorySecrets,
  sanitizeSSHCommandHistory,
  sanitizeSSHCommandHistoryEntry,
} from "../../utils/ssh/sshCommandHistorySanitizer";
import { SecureStorage } from "../../utils/storage/storage";

// ─── Constants ─────────────────────────────────────────────────

const HISTORY_STORAGE_KEY = "sshCommandHistory";
const CONFIG_STORAGE_KEY = "sshCommandHistoryConfig";
const HISTORY_VAULT_SERVICE = "sortofremoteng.ssh-command-history";
const HISTORY_VAULT_ACCOUNT = "history-v1";
const MAX_HISTORY_VAULT_BYTES = 512 * 1024;

let memoryHistory: SSHCommandHistoryEntry[] = [];

function purgeLegacyHistoryStorage(): void {
  try {
    localStorage.removeItem(HISTORY_STORAGE_KEY);
  } catch {
    // Browser storage is optional. History remains memory-only.
  }
}

function publishMemoryHistory(entries: SSHCommandHistoryEntry[]): void {
  memoryHistory = entries;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SSH_COMMAND_HISTORY_SYNC_EVENT));
  }
}

export function resetSSHCommandHistoryMemoryForTests(
  entries: SSHCommandHistoryEntry[] = [],
): void {
  memoryHistory = sanitizeSSHCommandHistory(entries);
  purgeLegacyHistoryStorage();
}

export function getSSHCommandHistoryMemorySnapshot(): SSHCommandHistoryEntry[] {
  return redactSSHCommandHistorySecrets(memoryHistory);
}

// ─── Category auto-detection ───────────────────────────────────

const CATEGORY_PATTERNS: Array<{
  pattern: RegExp;
  category: SSHCommandCategory;
}> = [
  { pattern: /\b(docker|podman|container|compose)\b/i, category: "docker" },
  { pattern: /\b(kubectl|k8s|helm|minikube|kube)\b/i, category: "kubernetes" },
  { pattern: /\b(git|svn|hg)\b/i, category: "git" },
  {
    pattern: /\b(mysql|psql|mongo|redis-cli|sqlite|pg_dump|mysqldump)\b/i,
    category: "database",
  },
  {
    pattern: /\b(systemctl|service|journalctl|supervisorctl)\b/i,
    category: "service",
  },
  {
    pattern: /\b(apt|yum|dnf|pacman|brew|pip|npm|gem|cargo)\b/i,
    category: "package",
  },
  {
    pattern:
      /\b(netstat|ss|ifconfig|ip\s|ping|traceroute|nslookup|dig|curl|wget|nmap|tcpdump|iptables|firewall)\b/i,
    category: "network",
  },
  {
    pattern: /\b(ps|top|htop|kill|killall|pkill|pgrep|nice|renice|nohup)\b/i,
    category: "process",
  },
  {
    pattern:
      /\b(ls|cat|cp|mv|rm|mkdir|chmod|chown|find|grep|awk|sed|tar|zip|unzip|rsync|scp|ln|stat|du|head|tail|wc|sort|diff)\b/i,
    category: "file",
  },
  {
    pattern: /\b(df|fdisk|mount|umount|lsblk|blkid|mkfs|fsck|swap)\b/i,
    category: "disk",
  },
  {
    pattern:
      /\b(useradd|userdel|usermod|passwd|groupadd|su\s|sudo|who|w\s|last|id\s)\b/i,
    category: "user",
  },
  {
    pattern:
      /\b(ssh-keygen|openssl|gpg|fail2ban|selinux|apparmor|ufw|audit)\b/i,
    category: "security",
  },
  {
    pattern:
      /\b(uname|hostname|uptime|date|cal|free|lscpu|lsmod|dmesg|sysctl|vmstat|iostat|sar)\b/i,
    category: "system",
  },
];

function detectCategory(command: string): SSHCommandCategory {
  for (const { pattern, category } of CATEGORY_PATTERNS) {
    if (pattern.test(command)) return category;
  }
  return "unknown";
}

// ─── Helpers ───────────────────────────────────────────────────

function loadHistory(): SSHCommandHistoryEntry[] {
  purgeLegacyHistoryStorage();
  return memoryHistory;
}

function saveHistory(entries: SSHCommandHistoryEntry[]): void {
  publishMemoryHistory(entries);
}

function loadConfig(): SSHCommandHistoryConfig {
  const defaults = { ...defaultHistoryConfig, persistEnabled: false };
  try {
    const stored = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!stored) return defaults;
    const parsed = JSON.parse(stored) as Partial<SSHCommandHistoryConfig>;
    return {
      ...defaults,
      ...parsed,
      persistEnabled: parsed.persistEnabled === true,
    };
  } catch {
    return defaults;
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
    result = result.filter((e) => e.starred || e.lastExecutedAt >= cutoffStr);
  }

  const configuredMax = Number.isFinite(config.maxEntries)
    ? Math.max(0, Math.floor(config.maxEntries))
    : 0;
  const maxEntries = Math.min(configuredMax, MAX_SSH_HISTORY_ENTRIES);
  if (result.length > maxEntries) {
    // Keep starred entries, then most recent
    const starred = result.filter((e) => e.starred);
    const unstarred = result
      .filter((e) => !e.starred)
      .sort((a, b) => b.lastExecutedAt.localeCompare(a.lastExecutedAt));
    const boundedStarred = starred.slice(0, maxEntries);
    const keep = maxEntries - boundedStarred.length;
    result = [...boundedStarred, ...unstarred.slice(0, Math.max(0, keep))];
  }

  return result;
}

function serializeHistoryForVault(
  entries: SSHCommandHistoryEntry[],
  config: SSHCommandHistoryConfig,
): string {
  let safe = enforceRetention(
    redactSSHCommandHistorySecrets(entries, config.maxOutputSize),
    config,
  );
  while (safe.length > 0) {
    const serialized = JSON.stringify(safe);
    if (
      new TextEncoder().encode(serialized).byteLength <= MAX_HISTORY_VAULT_BYTES
    ) {
      return serialized;
    }
    safe = safe.slice(0, -1);
  }
  return "[]";
}

async function loadHistoryFromVault(
  config: SSHCommandHistoryConfig,
): Promise<SSHCommandHistoryEntry[]> {
  const serialized = await SecureStorage.vaultReadSecret(
    HISTORY_VAULT_SERVICE,
    HISTORY_VAULT_ACCOUNT,
  );
  if (
    new TextEncoder().encode(serialized).byteLength > MAX_HISTORY_VAULT_BYTES
  ) {
    throw new Error("SSH history vault payload exceeds the safety limit");
  }
  return enforceRetention(
    redactSSHCommandHistorySecrets(
      sanitizeSSHCommandHistory(JSON.parse(serialized), {
        mode: "storage",
        maxOutputSize: Math.min(
          config.maxOutputSize,
          MAX_SSH_HISTORY_OUTPUT_CHARS,
        ),
        fallbackCategory: detectCategory,
      }),
      config.maxOutputSize,
    ),
    config,
  );
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
  const headers = [
    "command",
    "lastExecutedAt",
    "executionCount",
    "category",
    "starred",
    "tags",
  ];
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
      row.push(`"${(e.note ?? "").replace(/"/g, '""')}"`, e.createdAt, e.id);
    }
    return row.join(",");
  });
  return [headers.join(","), ...rows].join("\n");
}

// ─── Hook ──────────────────────────────────────────────────────

export function useSSHCommandHistory(sessionId?: string) {
  const [entries, setEntries] = useState<SSHCommandHistoryEntry[]>(() =>
    loadHistory(),
  );
  const [config, setConfig] = useState<SSHCommandHistoryConfig>(() =>
    loadConfig(),
  );
  const [filter, setFilter] =
    useState<SSHCommandHistoryFilter>(defaultHistoryFilter);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);

  // Arrow-key navigation index (-1 = not navigating, 0 = most recent)
  const [navigationIndex, setNavigationIndex] = useState(-1);
  const navigationSnapshotRef = useRef<string>("");
  const vaultLoadPendingRef = useRef(config.persistEnabled);
  const vaultGenerationRef = useRef(0);
  const [vaultRevision, setVaultRevision] = useState(0);
  const commitEntries = useCallback(
    (
      update:
        | SSHCommandHistoryEntry[]
        | ((current: SSHCommandHistoryEntry[]) => SSHCommandHistoryEntry[]),
    ) => {
      const next =
        typeof update === "function" ? update(loadHistory()) : update;
      saveHistory(next);
      setEntries(next);
    },
    [],
  );

  // ── Secure persistence ──────────────────────────────────────

  useEffect(() => {
    const enforced = enforceRetention(entries, config);
    if (enforced.length !== entries.length) {
      commitEntries(enforced);
    }
  }, [entries, config, commitEntries]);

  useEffect(() => {
    const syncHistory = () => setEntries(loadHistory());
    window.addEventListener(SSH_COMMAND_HISTORY_SYNC_EVENT, syncHistory);
    return () => {
      window.removeEventListener(SSH_COMMAND_HISTORY_SYNC_EVENT, syncHistory);
    };
  }, []);

  useEffect(() => {
    const generation = ++vaultGenerationRef.current;
    if (!config.persistEnabled) {
      vaultLoadPendingRef.current = false;
      void SecureStorage.vaultDeleteSecret(
        HISTORY_VAULT_SERVICE,
        HISTORY_VAULT_ACCOUNT,
      ).catch(() => undefined);
      return;
    }

    let cancelled = false;
    vaultLoadPendingRef.current = true;
    void loadHistoryFromVault(config)
      .then((loaded) => {
        if (cancelled || generation !== vaultGenerationRef.current) return;
        commitEntries((current) => {
          const commands = new Set(
            current.map((entry) => entry.command.trim()),
          );
          return enforceRetention(
            [
              ...current,
              ...loaded.filter((entry) => !commands.has(entry.command.trim())),
            ],
            config,
          );
        });
      })
      .catch(() => undefined)
      .finally(() => {
        if (cancelled || generation !== vaultGenerationRef.current) return;
        vaultLoadPendingRef.current = false;
        setVaultRevision((revision) => revision + 1);
      });
    return () => {
      cancelled = true;
    };
  }, [config, commitEntries]);

  useEffect(() => {
    if (!config.persistEnabled || vaultLoadPendingRef.current) return;
    const serialized = serializeHistoryForVault(entries, config);
    void SecureStorage.vaultStoreSecret(
      HISTORY_VAULT_SERVICE,
      HISTORY_VAULT_ACCOUNT,
      serialized,
    ).catch(() => undefined);
  }, [entries, config, vaultRevision]);

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
        return (
          last !== undefined &&
          commandExecutionDisplayStatus(last) === filter.statusFilter
        );
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
    const totalExecutions = entries.reduce(
      (sum, e) => sum + e.executionCount,
      0,
    );
    const allSessions = new Set<string>();
    let successCount = 0;
    let totalWithStatus = 0;

    const categoryBreakdown = {} as Record<SSHCommandCategory, number>;

    for (const entry of entries) {
      categoryBreakdown[entry.category] =
        (categoryBreakdown[entry.category] ?? 0) + 1;
      for (const ex of entry.executions) {
        allSessions.add(ex.sessionId);
        const displayStatus = commandExecutionDisplayStatus(ex);
        if (displayStatus === "success" || displayStatus === "error") {
          totalWithStatus++;
          if (displayStatus === "success") successCount++;
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
      const boundedCommand = command
        .slice(0, MAX_SSH_HISTORY_COMMAND_CHARS)
        .trim();
      if (!boundedCommand) return;
      const recordedAt = new Date().toISOString();
      const maxOutputSize = Math.min(
        MAX_SSH_HISTORY_OUTPUT_CHARS,
        Math.max(0, Math.floor(config.maxOutputSize)),
      );
      const stampedExecutions = executions.slice(-20).map((execution) => ({
        ...execution,
        executedAt: execution.executedAt ?? recordedAt,
        output:
          config.trackOutput && execution.output !== undefined
            ? truncateOutput(execution.output, maxOutputSize)
            : undefined,
        stderr:
          config.trackOutput && execution.stderr !== undefined
            ? truncateOutput(execution.stderr, maxOutputSize)
            : undefined,
        errorMessage:
          execution.errorMessage === undefined
            ? undefined
            : truncateOutput(execution.errorMessage, maxOutputSize),
      }));
      const updateEntries = (prev: SSHCommandHistoryEntry[]) => {
        // Check for duplicate
        const existing = prev.find((e) => e.command.trim() === boundedCommand);

        if (existing) {
          // Update existing entry
          const updated = prev.map((e) =>
            e.id === existing.id
              ? {
                  ...e,
                  lastExecutedAt: recordedAt,
                  executionCount: e.executionCount + 1,
                  executions: [...e.executions, ...stampedExecutions].slice(
                    -20,
                  ),
                }
              : e,
          );
          return enforceRetention(updated, config);
        }

        // New entry
        const category = config.autoCategorize
          ? detectCategory(boundedCommand)
          : "unknown";
        const newEntry: SSHCommandHistoryEntry = {
          id: generateId(),
          command: boundedCommand,
          createdAt: recordedAt,
          lastExecutedAt: recordedAt,
          executionCount: 1,
          starred: false,
          tags: [],
          category,
          executions: stampedExecutions,
        };

        return enforceRetention([newEntry, ...prev], config);
      };
      commitEntries(updateEntries);
    },
    [config, commitEntries],
  );

  // ── Toggle star ─────────────────────────────────────────────

  const toggleStar = useCallback(
    (entryId: string) => {
      commitEntries((prev) =>
        prev.map((e) => (e.id === entryId ? { ...e, starred: !e.starred } : e)),
      );
    },
    [commitEntries],
  );

  // ── Update tags ─────────────────────────────────────────────

  const updateTags = useCallback(
    (entryId: string, tags: string[]) => {
      commitEntries((prev) =>
        prev.map((e) => (e.id === entryId ? { ...e, tags } : e)),
      );
    },
    [commitEntries],
  );

  // ── Update note ─────────────────────────────────────────────

  const updateNote = useCallback(
    (entryId: string, note: string) => {
      commitEntries((prev) =>
        prev.map((e) => (e.id === entryId ? { ...e, note } : e)),
      );
    },
    [commitEntries],
  );

  // ── Update category ─────────────────────────────────────────

  const updateCategory = useCallback(
    (entryId: string, category: SSHCommandCategory) => {
      commitEntries((prev) =>
        prev.map((e) => (e.id === entryId ? { ...e, category } : e)),
      );
    },
    [commitEntries],
  );

  // ── Delete entry ────────────────────────────────────────────

  const deleteEntry = useCallback(
    (entryId: string) => {
      commitEntries((prev) => prev.filter((e) => e.id !== entryId));
      setSelectedEntryId((prev) => (prev === entryId ? null : prev));
    },
    [commitEntries],
  );

  // ── Delete all (with optional filter) ───────────────────────

  const clearHistory = useCallback(
    (keepStarred = true) => {
      if (keepStarred) {
        commitEntries((prev) => prev.filter((e) => e.starred));
      } else {
        commitEntries([]);
      }
      setSelectedEntryId(null);
    },
    [commitEntries],
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
      const nextIdx = Math.min(navigationIndex + 1, historyList.length - 1);
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

      const safeExportEntries = redactSSHCommandHistorySecrets(
        exportEntries,
        config.maxOutputSize,
      );
      switch (options.format) {
        case "json":
          return exportAsJSON(safeExportEntries, options);
        case "shell":
          return exportAsShell(safeExportEntries);
        case "csv":
          return exportAsCSV(safeExportEntries, options);
        default:
          return exportAsJSON(safeExportEntries, options);
      }
    },
    [filteredEntries, config.maxOutputSize],
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
        const parsed: unknown = JSON.parse(jsonString);
        if (!Array.isArray(parsed)) {
          result.errors.push("Import data must be a JSON array");
          return result;
        }

        commitEntries((prev) => {
          const existingCommands = new Set(prev.map((e) => e.command.trim()));
          const usedIds = new Set(prev.map((entry) => entry.id));
          const newEntries: SSHCommandHistoryEntry[] = [];

          for (const item of parsed) {
            const sanitized = sanitizeSSHCommandHistoryEntry(item, {
              mode: "import",
              maxOutputSize: config.maxOutputSize,
              fallbackCategory: detectCategory,
            });
            if (!sanitized) {
              result.errors.push(
                `Skipped item: missing or invalid 'command' field`,
              );
              continue;
            }

            if (existingCommands.has(sanitized.command)) {
              result.duplicatesSkipped++;
              continue;
            }

            existingCommands.add(sanitized.command);
            let id = sanitized.id;
            let collisionIndex = 1;
            while (usedIds.has(id)) {
              id = `${generateId()}-${collisionIndex}`;
              collisionIndex++;
            }
            usedIds.add(id);
            newEntries.push({
              ...sanitized,
              id,
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
    [config, commitEntries],
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
    togglePanel,
    openPanel,
    closePanel,
    setSelectedEntryId,
  };
}

export type SSHCommandHistoryMgr = ReturnType<typeof useSSHCommandHistory>;
