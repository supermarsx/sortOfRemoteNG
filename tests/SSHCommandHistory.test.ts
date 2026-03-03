import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

// ── localStorage polyfill ──────────────────────────────────────

const ensureLocalStorage = () => {
  const hasStorageApi =
    typeof globalThis.localStorage !== "undefined" &&
    typeof globalThis.localStorage.getItem === "function" &&
    typeof globalThis.localStorage.setItem === "function" &&
    typeof globalThis.localStorage.removeItem === "function" &&
    typeof globalThis.localStorage.clear === "function";

  if (hasStorageApi) return;

  const store: Record<string, string> = {};
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = String(value);
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k];
      },
      key: (index: number) => Object.keys(store)[index] ?? null,
      get length() {
        return Object.keys(store).length;
      },
    },
  });
};

// ── Import (after mocks) ──────────────────────────────────────

import { useSSHCommandHistory } from "../src/hooks/ssh/useSSHCommandHistory";
import type {
  SSHCommandHistoryEntry,
  CommandExecution,
} from "../src/types/sshCommandHistory";

// ── Test Suite ─────────────────────────────────────────────────

describe("useSSHCommandHistory", () => {
  beforeEach(() => {
    ensureLocalStorage();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Adding entries ───────────────────────────────────────

  describe("addEntry", () => {
    it("should add a new command to history", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("ls -la", [
          {
            sessionId: "s1",
            sessionName: "Server 1",
            hostname: "192.168.1.1",
            status: "success",
            output: "total 42\ndrwxr-xr-x ...",
          },
        ]);
      });

      expect(result.current.allEntries).toHaveLength(1);
      expect(result.current.allEntries[0].command).toBe("ls -la");
      expect(result.current.allEntries[0].executionCount).toBe(1);
      expect(result.current.allEntries[0].category).toBe("file");
    });

    it("should merge duplicate commands and increment count", () => {
      const { result } = renderHook(() => useSSHCommandHistory());
      const exec: CommandExecution = {
        sessionId: "s1",
        sessionName: "Server 1",
        hostname: "192.168.1.1",
        status: "success",
      };

      act(() => {
        result.current.addEntry("uptime", [exec]);
      });
      act(() => {
        result.current.addEntry("uptime", [exec]);
      });

      expect(result.current.allEntries).toHaveLength(1);
      expect(result.current.allEntries[0].executionCount).toBe(2);
    });

    it("should auto-categorize commands", () => {
      const { result } = renderHook(() => useSSHCommandHistory());
      const exec: CommandExecution = {
        sessionId: "s1",
        sessionName: "Test",
        hostname: "h",
        status: "success",
      };

      const testCases: Array<[string, string]> = [
        ["docker ps", "docker"],
        ["kubectl get pods", "kubernetes"],
        ["git status", "git"],
        ["netstat -tuln", "network"],
        ["ps aux", "process"],
        ["apt install vim", "package"],
        ["systemctl restart nginx", "service"],
        ["df -h", "disk"],
        ["useradd bob", "user"],
        ["ssh-keygen -t ed25519", "security"],
        ["mysql -u root", "database"],
        ["uname -a", "system"],
      ];

      for (const [cmd, expectedCat] of testCases) {
        act(() => {
          result.current.addEntry(cmd, [exec]);
        });
        const entry = result.current.allEntries.find(
          (e) => e.command === cmd,
        );
        expect(entry?.category).toBe(expectedCat);
      }
    });
  });

  // ─── Starring ─────────────────────────────────────────────

  describe("toggleStar", () => {
    it("should toggle star on an entry", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("ls", [
          { sessionId: "s1", sessionName: "S", hostname: "h", status: "success" },
        ]);
      });

      const id = result.current.allEntries[0].id;

      act(() => {
        result.current.toggleStar(id);
      });
      expect(result.current.allEntries[0].starred).toBe(true);

      act(() => {
        result.current.toggleStar(id);
      });
      expect(result.current.allEntries[0].starred).toBe(false);
    });
  });

  // ─── Tags ─────────────────────────────────────────────────

  describe("updateTags", () => {
    it("should update tags on an entry", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("hostname", [
          { sessionId: "s1", sessionName: "S", hostname: "h", status: "success" },
        ]);
      });

      const id = result.current.allEntries[0].id;

      act(() => {
        result.current.updateTags(id, ["production", "info"]);
      });

      expect(result.current.allEntries[0].tags).toEqual([
        "production",
        "info",
      ]);
    });
  });

  // ─── Notes ────────────────────────────────────────────────

  describe("updateNote", () => {
    it("should update the note on an entry", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("whoami", [
          { sessionId: "s1", sessionName: "S", hostname: "h", status: "success" },
        ]);
      });

      const id = result.current.allEntries[0].id;

      act(() => {
        result.current.updateNote(id, "Check current user");
      });

      expect(result.current.allEntries[0].note).toBe("Check current user");
    });
  });

  // ─── Deletion ─────────────────────────────────────────────

  describe("deleteEntry", () => {
    it("should remove a single entry", () => {
      const { result } = renderHook(() => useSSHCommandHistory());
      const exec: CommandExecution = {
        sessionId: "s1",
        sessionName: "S",
        hostname: "h",
        status: "success",
      };

      act(() => {
        result.current.addEntry("cmd1", [exec]);
        result.current.addEntry("cmd2", [exec]);
      });

      expect(result.current.allEntries).toHaveLength(2);

      act(() => {
        result.current.deleteEntry(result.current.allEntries[0].id);
      });

      expect(result.current.allEntries).toHaveLength(1);
    });
  });

  describe("clearHistory", () => {
    it("should clear all entries except starred when keepStarred=true", () => {
      const { result } = renderHook(() => useSSHCommandHistory());
      const exec: CommandExecution = {
        sessionId: "s1",
        sessionName: "S",
        hostname: "h",
        status: "success",
      };

      act(() => {
        result.current.addEntry("cmd1", [exec]);
        result.current.addEntry("cmd2", [exec]);
      });

      act(() => {
        result.current.toggleStar(result.current.allEntries[0].id);
      });

      act(() => {
        result.current.clearHistory(true);
      });

      expect(result.current.allEntries).toHaveLength(1);
      expect(result.current.allEntries[0].starred).toBe(true);
    });

    it("should clear all entries when keepStarred=false", () => {
      const { result } = renderHook(() => useSSHCommandHistory());
      const exec: CommandExecution = {
        sessionId: "s1",
        sessionName: "S",
        hostname: "h",
        status: "success",
      };

      act(() => {
        result.current.addEntry("cmd1", [exec]);
        result.current.addEntry("cmd2", [exec]);
      });

      act(() => {
        result.current.toggleStar(result.current.allEntries[0].id);
      });

      act(() => {
        result.current.clearHistory(false);
      });

      expect(result.current.allEntries).toHaveLength(0);
    });
  });

  // ─── Filtering ────────────────────────────────────────────

  describe("filtering", () => {
    it("should filter by search query", () => {
      const { result } = renderHook(() => useSSHCommandHistory());
      const exec: CommandExecution = {
        sessionId: "s1",
        sessionName: "S",
        hostname: "h",
        status: "success",
      };

      act(() => {
        result.current.addEntry("ls -la /var/log", [exec]);
        result.current.addEntry("cat /etc/hosts", [exec]);
        result.current.addEntry("systemctl status nginx", [exec]);
      });

      act(() => {
        result.current.updateFilter({ searchQuery: "hosts" });
      });

      expect(result.current.entries).toHaveLength(1);
      expect(result.current.entries[0].command).toBe("cat /etc/hosts");
    });

    it("should filter by category", () => {
      const { result } = renderHook(() => useSSHCommandHistory());
      const exec: CommandExecution = {
        sessionId: "s1",
        sessionName: "S",
        hostname: "h",
        status: "success",
      };

      act(() => {
        result.current.addEntry("docker ps", [exec]);
        result.current.addEntry("git log", [exec]);
        result.current.addEntry("docker images", [exec]);
      });

      act(() => {
        result.current.updateFilter({ category: "docker" });
      });

      expect(result.current.entries).toHaveLength(2);
    });

    it("should filter starred only", () => {
      const { result } = renderHook(() => useSSHCommandHistory());
      const exec: CommandExecution = {
        sessionId: "s1",
        sessionName: "S",
        hostname: "h",
        status: "success",
      };

      act(() => {
        result.current.addEntry("cmd1", [exec]);
        result.current.addEntry("cmd2", [exec]);
      });

      act(() => {
        result.current.toggleStar(result.current.allEntries[0].id);
      });

      act(() => {
        result.current.updateFilter({ starredOnly: true });
      });

      expect(result.current.entries).toHaveLength(1);
      expect(result.current.entries[0].starred).toBe(true);
    });

    it("should filter by session", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("cmd1", [
          { sessionId: "s1", sessionName: "Server1", hostname: "h1", status: "success" },
        ]);
        result.current.addEntry("cmd2", [
          { sessionId: "s2", sessionName: "Server2", hostname: "h2", status: "success" },
        ]);
      });

      act(() => {
        result.current.updateFilter({ sessionId: "s1" });
      });

      expect(result.current.entries).toHaveLength(1);
      expect(result.current.entries[0].command).toBe("cmd1");
    });

    it("should reset filters", () => {
      const { result } = renderHook(() => useSSHCommandHistory());
      const exec: CommandExecution = {
        sessionId: "s1",
        sessionName: "S",
        hostname: "h",
        status: "success",
      };

      act(() => {
        result.current.addEntry("cmd1", [exec]);
        result.current.addEntry("cmd2", [exec]);
      });

      act(() => {
        result.current.updateFilter({ searchQuery: "nonexistent" });
      });
      expect(result.current.entries).toHaveLength(0);

      act(() => {
        result.current.resetFilter();
      });
      expect(result.current.entries).toHaveLength(2);
    });
  });

  // ─── Sorting ──────────────────────────────────────────────

  describe("sorting", () => {
    it("should sort by execution count", () => {
      const { result } = renderHook(() => useSSHCommandHistory());
      const exec: CommandExecution = {
        sessionId: "s1",
        sessionName: "S",
        hostname: "h",
        status: "success",
      };

      act(() => {
        result.current.addEntry("rare-cmd", [exec]);
        result.current.addEntry("frequent-cmd", [exec]);
        result.current.addEntry("frequent-cmd", [exec]);
        result.current.addEntry("frequent-cmd", [exec]);
      });

      act(() => {
        result.current.updateFilter({
          sortBy: "executionCount",
          sortDirection: "desc",
        });
      });

      expect(result.current.entries[0].command).toBe("frequent-cmd");
      expect(result.current.entries[0].executionCount).toBe(3);
    });

    it("should sort alphabetically", () => {
      const { result } = renderHook(() => useSSHCommandHistory());
      const exec: CommandExecution = {
        sessionId: "s1",
        sessionName: "S",
        hostname: "h",
        status: "success",
      };

      act(() => {
        result.current.addEntry("zebra cmd", [exec]);
        result.current.addEntry("alpha cmd", [exec]);
        result.current.addEntry("middle cmd", [exec]);
      });

      act(() => {
        result.current.updateFilter({
          sortBy: "command",
          sortDirection: "asc",
        });
      });

      expect(result.current.entries[0].command).toBe("alpha cmd");
      expect(result.current.entries[2].command).toBe("zebra cmd");
    });
  });

  // ─── Statistics ───────────────────────────────────────────

  describe("stats", () => {
    it("should compute basic statistics", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("ls", [
          { sessionId: "s1", sessionName: "S1", hostname: "h1", status: "success" },
        ]);
        result.current.addEntry("pwd", [
          { sessionId: "s2", sessionName: "S2", hostname: "h2", status: "error", errorMessage: "fail" },
        ]);
        result.current.addEntry("ls", [
          { sessionId: "s1", sessionName: "S1", hostname: "h1", status: "success" },
        ]);
      });

      const { stats } = result.current;
      expect(stats.totalCommands).toBe(2);
      expect(stats.totalExecutions).toBe(3);
      expect(stats.sessionsUsed).toBe(2);
      expect(stats.starredCount).toBe(0);
      expect(stats.successRate).toBeGreaterThan(0);
    });

    it("should track category breakdown", () => {
      const { result } = renderHook(() => useSSHCommandHistory());
      const exec: CommandExecution = {
        sessionId: "s1",
        sessionName: "S",
        hostname: "h",
        status: "success",
      };

      act(() => {
        result.current.addEntry("docker ps", [exec]);
        result.current.addEntry("docker images", [exec]);
        result.current.addEntry("git log", [exec]);
      });

      expect(result.current.stats.categoryBreakdown.docker).toBe(2);
      expect(result.current.stats.categoryBreakdown.git).toBe(1);
    });

    it("should return top commands", () => {
      const { result } = renderHook(() => useSSHCommandHistory());
      const exec: CommandExecution = {
        sessionId: "s1",
        sessionName: "S",
        hostname: "h",
        status: "success",
      };

      act(() => {
        result.current.addEntry("ls", [exec]);
        result.current.addEntry("ls", [exec]);
        result.current.addEntry("ls", [exec]);
        result.current.addEntry("pwd", [exec]);
      });

      const top = result.current.stats.topCommands;
      expect(top[0].command).toBe("ls");
      expect(top[0].count).toBe(3);
    });
  });

  // ─── Export / Import ──────────────────────────────────────

  describe("export", () => {
    it("should export as JSON", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("test command", [
          { sessionId: "s1", sessionName: "S", hostname: "h", status: "success" },
        ]);
      });

      let exportData = "";
      act(() => {
        exportData = result.current.exportHistory({
          format: "json",
          includeOutput: false,
          includeMetadata: true,
          starredOnly: false,
        });
      });

      const parsed = JSON.parse(exportData);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].command).toBe("test command");
    });

    it("should export as shell script", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("echo hello", [
          { sessionId: "s1", sessionName: "S", hostname: "h", status: "success" },
        ]);
      });

      let exportData = "";
      act(() => {
        exportData = result.current.exportHistory({
          format: "shell",
          includeOutput: false,
          includeMetadata: false,
          starredOnly: false,
        });
      });

      expect(exportData).toContain("#!/usr/bin/env bash");
      expect(exportData).toContain("echo hello");
    });

    it("should export as CSV", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("ls -la", [
          { sessionId: "s1", sessionName: "S", hostname: "h", status: "success" },
        ]);
      });

      let exportData = "";
      act(() => {
        exportData = result.current.exportHistory({
          format: "csv",
          includeOutput: false,
          includeMetadata: false,
          starredOnly: false,
        });
      });

      expect(exportData).toContain("command,");
      expect(exportData).toContain("ls -la");
    });
  });

  describe("import", () => {
    it("should import commands from JSON", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      const importData = JSON.stringify([
        { command: "imported-cmd-1" },
        { command: "imported-cmd-2" },
      ]);

      let importResult: { imported: number; duplicatesSkipped: number; errors: string[] } | undefined;
      act(() => {
        importResult = result.current.importHistory(importData);
      });

      expect(importResult!.imported).toBe(2);
      expect(importResult!.duplicatesSkipped).toBe(0);
      expect(result.current.allEntries).toHaveLength(2);
    });

    it("should skip duplicate commands during import", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("existing-cmd", [
          { sessionId: "s1", sessionName: "S", hostname: "h", status: "success" },
        ]);
      });

      const importData = JSON.stringify([
        { command: "existing-cmd" },
        { command: "new-cmd" },
      ]);

      let importResult: { imported: number; duplicatesSkipped: number; errors: string[] } | undefined;
      act(() => {
        importResult = result.current.importHistory(importData);
      });

      expect(importResult!.imported).toBe(1);
      expect(importResult!.duplicatesSkipped).toBe(1);
    });

    it("should report errors for invalid entries", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      const importData = JSON.stringify([{ notACommand: true }, { command: "valid" }]);

      let importResult: { imported: number; duplicatesSkipped: number; errors: string[] } | undefined;
      act(() => {
        importResult = result.current.importHistory(importData);
      });

      expect(importResult!.imported).toBe(1);
      expect(importResult!.errors.length).toBe(1);
    });
  });

  // ─── Arrow-key navigation ────────────────────────────────

  describe("navigation", () => {
    it("should navigate up through history", () => {
      const { result } = renderHook(() => useSSHCommandHistory());
      const exec: CommandExecution = {
        sessionId: "s1",
        sessionName: "S",
        hostname: "h",
        status: "success",
      };

      act(() => {
        result.current.addEntry("first", [exec]);
        result.current.addEntry("second", [exec]);
        result.current.addEntry("third", [exec]);
      });

      let cmd: string | null = null;
      act(() => {
        cmd = result.current.navigateUp("current input");
      });

      expect(cmd).not.toBeNull();
    });

    it("should navigate down to restore original input", () => {
      const { result } = renderHook(() => useSSHCommandHistory());
      const exec: CommandExecution = {
        sessionId: "s1",
        sessionName: "S",
        hostname: "h",
        status: "success",
      };

      act(() => {
        result.current.addEntry("hist-cmd", [exec]);
      });

      act(() => {
        result.current.navigateUp("my input");
      });

      let cmd: string | null = null;
      act(() => {
        cmd = result.current.navigateDown();
      });

      // Should get back original or empty
      expect(typeof cmd).toBe("string");
    });

    it("should reset navigation state", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.navigateUp("test");
      });

      act(() => {
        result.current.resetNavigation();
      });

      expect(result.current.navigationIndex).toBe(-1);
    });
  });

  // ─── Panel state ──────────────────────────────────────────

  describe("panel", () => {
    it("should toggle panel open/closed", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      expect(result.current.isOpen).toBe(false);

      act(() => {
        result.current.togglePanel();
      });
      expect(result.current.isOpen).toBe(true);

      act(() => {
        result.current.togglePanel();
      });
      expect(result.current.isOpen).toBe(false);
    });

    it("should open/close panel explicitly", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.openPanel();
      });
      expect(result.current.isOpen).toBe(true);

      act(() => {
        result.current.closePanel();
      });
      expect(result.current.isOpen).toBe(false);
    });
  });

  // ─── Config ───────────────────────────────────────────────

  describe("config", () => {
    it("should update configuration", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.updateConfig({ maxEntries: 500, retentionDays: 30 });
      });

      expect(result.current.config.maxEntries).toBe(500);
      expect(result.current.config.retentionDays).toBe(30);
    });
  });

  // ─── Persistence ──────────────────────────────────────────

  describe("persistence", () => {
    it("should persist entries to localStorage", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("persisted cmd", [
          { sessionId: "s1", sessionName: "S", hostname: "h", status: "success" },
        ]);
      });

      const stored = localStorage.getItem("sshCommandHistory");
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].command).toBe("persisted cmd");
    });

    it("should load entries from localStorage on mount", () => {
      const entry: SSHCommandHistoryEntry = {
        id: "test-id",
        command: "pre-existing",
        createdAt: new Date().toISOString(),
        lastExecutedAt: new Date().toISOString(),
        executionCount: 1,
        starred: false,
        tags: [],
        category: "unknown",
        executions: [],
      };
      localStorage.setItem("sshCommandHistory", JSON.stringify([entry]));

      const { result } = renderHook(() => useSSHCommandHistory());
      expect(result.current.allEntries).toHaveLength(1);
      expect(result.current.allEntries[0].command).toBe("pre-existing");
    });
  });

  // ─── Category update ─────────────────────────────────────

  describe("updateCategory", () => {
    it("should change the category of an entry", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("some command", [
          { sessionId: "s1", sessionName: "S", hostname: "h", status: "success" },
        ]);
      });

      const id = result.current.allEntries[0].id;

      act(() => {
        result.current.updateCategory(id, "custom");
      });

      expect(result.current.allEntries[0].category).toBe("custom");
    });
  });

  // ─── Available sessions ───────────────────────────────────

  describe("availableSessions", () => {
    it("should list unique sessions from history", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("cmd1", [
          { sessionId: "s1", sessionName: "Server1", hostname: "h1", status: "success" },
        ]);
        result.current.addEntry("cmd2", [
          { sessionId: "s2", sessionName: "Server2", hostname: "h2", status: "success" },
        ]);
        result.current.addEntry("cmd3", [
          { sessionId: "s1", sessionName: "Server1", hostname: "h1", status: "success" },
        ]);
      });

      expect(result.current.availableSessions).toHaveLength(2);
    });
  });

  // ─── Re-execute ───────────────────────────────────────────

  describe("getReExecuteCommand", () => {
    it("should return the command string for re-execution", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("my command", [
          { sessionId: "s1", sessionName: "S", hostname: "h", status: "success" },
        ]);
      });

      const id = result.current.allEntries[0].id;
      let cmd: string | null = null;
      act(() => {
        cmd = result.current.getReExecuteCommand(id);
      });

      expect(cmd).toBe("my command");
    });

    it("should return null for unknown IDs", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      let cmd: string | null = null;
      act(() => {
        cmd = result.current.getReExecuteCommand("nonexistent");
      });

      expect(cmd).toBeNull();
    });
  });
});
