import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Mock generateId
let idCounter = 0;
vi.mock("../../src/utils/core/id", () => ({
  generateId: () => `test-id-${++idCounter}`,
}));

import { useSSHCommandHistory } from "../../src/hooks/ssh/useSSHCommandHistory";
import type { CommandExecution } from "../../src/types/ssh/sshCommandHistory";

function makeExecution(overrides: Partial<CommandExecution> = {}): CommandExecution {
  return {
    sessionId: "sess-1",
    sessionName: "My Server",
    hostname: "10.0.0.1",
    status: "success",
    ...overrides,
  };
}

describe("useSSHCommandHistory", () => {
  beforeEach(() => {
    idCounter = 0;
    localStorage.clear();
  });

  it("returns empty initial state", () => {
    const { result } = renderHook(() => useSSHCommandHistory());
    expect(result.current.entries).toEqual([]);
    expect(result.current.stats.totalCommands).toBe(0);
    expect(result.current.isOpen).toBe(false);
  });

  describe("addEntry", () => {
    it("adds a new command entry", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("ls -la", [makeExecution()]);
      });

      expect(result.current.allEntries).toHaveLength(1);
      expect(result.current.allEntries[0].command).toBe("ls -la");
      expect(result.current.allEntries[0].executionCount).toBe(1);
    });

    it("increments count for duplicate commands", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("ls -la", [makeExecution()]);
      });
      act(() => {
        result.current.addEntry("ls -la", [makeExecution()]);
      });

      expect(result.current.allEntries).toHaveLength(1);
      expect(result.current.allEntries[0].executionCount).toBe(2);
    });

    it("auto-categorizes docker commands", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("docker ps -a", [makeExecution()]);
      });

      expect(result.current.allEntries[0].category).toBe("docker");
    });

    it("auto-categorizes git commands", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("git status", [makeExecution()]);
      });

      expect(result.current.allEntries[0].category).toBe("git");
    });

    it("auto-categorizes network commands", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("ping 8.8.8.8", [makeExecution()]);
      });

      expect(result.current.allEntries[0].category).toBe("network");
    });

    it("assigns unknown category for unrecognized commands", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("my-custom-script --flag", [makeExecution()]);
      });

      expect(result.current.allEntries[0].category).toBe("unknown");
    });
  });

  describe("entry operations", () => {
    it("toggleStar flips starred state", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("ls", [makeExecution()]);
      });
      const id = result.current.allEntries[0].id;

      expect(result.current.allEntries[0].starred).toBe(false);
      act(() => {
        result.current.toggleStar(id);
      });
      expect(result.current.allEntries[0].starred).toBe(true);
      act(() => {
        result.current.toggleStar(id);
      });
      expect(result.current.allEntries[0].starred).toBe(false);
    });

    it("updateTags sets tags on entry", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("ls", [makeExecution()]);
      });
      const id = result.current.allEntries[0].id;

      act(() => {
        result.current.updateTags(id, ["important", "deploy"]);
      });

      expect(result.current.allEntries[0].tags).toEqual(["important", "deploy"]);
    });

    it("updateNote sets note on entry", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("ls", [makeExecution()]);
      });
      const id = result.current.allEntries[0].id;

      act(() => {
        result.current.updateNote(id, "my note");
      });

      expect(result.current.allEntries[0].note).toBe("my note");
    });

    it("updateCategory changes category", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("my-cmd", [makeExecution()]);
      });
      const id = result.current.allEntries[0].id;

      act(() => {
        result.current.updateCategory(id, "docker");
      });

      expect(result.current.allEntries[0].category).toBe("docker");
    });

    it("deleteEntry removes an entry", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("ls", [makeExecution()]);
        result.current.addEntry("pwd", [makeExecution()]);
      });
      expect(result.current.allEntries).toHaveLength(2);

      const id = result.current.allEntries[0].id;
      act(() => {
        result.current.deleteEntry(id);
      });

      expect(result.current.allEntries).toHaveLength(1);
    });
  });

  describe("clearHistory", () => {
    it("clears all history by default but keeps starred", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("ls", [makeExecution()]);
        result.current.addEntry("pwd", [makeExecution()]);
      });

      // Star the first entry
      act(() => {
        result.current.toggleStar(result.current.allEntries[0].id);
      });

      act(() => {
        result.current.clearHistory(true);
      });

      expect(result.current.allEntries).toHaveLength(1);
      expect(result.current.allEntries[0].starred).toBe(true);
    });

    it("clears all including starred when keepStarred is false", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("ls", [makeExecution()]);
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

  describe("filtering", () => {
    it("filters by search query", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("docker ps", [makeExecution()]);
        result.current.addEntry("ls -la", [makeExecution()]);
        result.current.addEntry("docker build .", [makeExecution()]);
      });

      act(() => {
        result.current.updateFilter({ searchQuery: "docker" });
      });

      expect(result.current.entries).toHaveLength(2);
    });

    it("filters by category", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("docker ps", [makeExecution()]);
        result.current.addEntry("git status", [makeExecution()]);
      });

      act(() => {
        result.current.updateFilter({ category: "docker" });
      });

      expect(result.current.entries).toHaveLength(1);
      expect(result.current.entries[0].command).toBe("docker ps");
    });

    it("filters starred only", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("ls", [makeExecution()]);
        result.current.addEntry("pwd", [makeExecution()]);
      });
      act(() => {
        result.current.toggleStar(result.current.allEntries[0].id);
      });

      act(() => {
        result.current.updateFilter({ starredOnly: true });
      });

      expect(result.current.entries).toHaveLength(1);
    });

    it("resetFilter restores defaults", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.updateFilter({ searchQuery: "docker", starredOnly: true });
      });

      act(() => {
        result.current.resetFilter();
      });

      expect(result.current.filter.searchQuery).toBe("");
      expect(result.current.filter.starredOnly).toBe(false);
    });
  });

  describe("stats", () => {
    it("computes statistics from entries", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("docker ps", [
          makeExecution({ status: "success" }),
        ]);
        result.current.addEntry("git status", [
          makeExecution({ status: "success" }),
        ]);
        result.current.addEntry("ls", [
          makeExecution({ status: "error" }),
        ]);
      });

      const { stats } = result.current;
      expect(stats.totalCommands).toBe(3);
      expect(stats.totalExecutions).toBe(3);
      expect(stats.starredCount).toBe(0);
      expect(stats.successRate).toBeCloseTo(2 / 3);
    });
  });

  describe("panel", () => {
    it("togglePanel flips isOpen", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      expect(result.current.isOpen).toBe(false);
      act(() => {
        result.current.togglePanel();
      });
      expect(result.current.isOpen).toBe(true);
    });
  });

  describe("export", () => {
    it("exports as JSON", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("ls", [makeExecution()]);
      });

      const exported = result.current.exportHistory({
        format: "json",
        includeOutput: false,
        includeMetadata: false,
        starredOnly: false,
      });

      const parsed = JSON.parse(exported);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].command).toBe("ls");
    });

    it("exports as CSV", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("ls -la", [makeExecution()]);
      });

      const csv = result.current.exportHistory({
        format: "csv",
        includeOutput: false,
        includeMetadata: false,
        starredOnly: false,
      });

      expect(csv).toContain("command,lastExecutedAt");
      expect(csv).toContain("ls -la");
    });

    it("exports as shell script", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("echo hello", [makeExecution()]);
      });

      const shell = result.current.exportHistory({
        format: "shell",
        includeOutput: false,
        includeMetadata: false,
        starredOnly: false,
      });

      expect(shell).toContain("#!/usr/bin/env bash");
      expect(shell).toContain("echo hello");
    });
  });

  describe("import", () => {
    it("imports valid JSON entries", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      const data = JSON.stringify([
        { command: "whoami" },
        { command: "uptime" },
      ]);

      let importResult: ReturnType<typeof result.current.importHistory>;
      act(() => {
        importResult = result.current.importHistory(data);
      });

      expect(importResult!.imported).toBe(2);
      expect(importResult!.errors).toHaveLength(0);
      expect(result.current.allEntries).toHaveLength(2);
    });

    it("skips duplicates on import", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("ls", [makeExecution()]);
      });

      let importResult: ReturnType<typeof result.current.importHistory>;
      act(() => {
        importResult = result.current.importHistory(
          JSON.stringify([{ command: "ls" }, { command: "pwd" }]),
        );
      });

      expect(importResult!.imported).toBe(1);
      expect(importResult!.duplicatesSkipped).toBe(1);
    });

    it("handles invalid JSON gracefully", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      let importResult: ReturnType<typeof result.current.importHistory>;
      act(() => {
        importResult = result.current.importHistory("not valid json{{{");
      });

      expect(importResult!.errors).toHaveLength(1);
      expect(importResult!.imported).toBe(0);
    });
  });

  describe("config", () => {
    it("updateConfig merges with existing config", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.updateConfig({ maxEntries: 500 });
      });

      expect(result.current.config.maxEntries).toBe(500);
      // Other defaults untouched
      expect(result.current.config.persistEnabled).toBe(true);
    });
  });

  describe("getReExecuteCommand", () => {
    it("returns command string for valid entry", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("pwd", [makeExecution()]);
      });
      const id = result.current.allEntries[0].id;

      expect(result.current.getReExecuteCommand(id)).toBe("pwd");
    });

    it("returns null for unknown entry", () => {
      const { result } = renderHook(() => useSSHCommandHistory());
      expect(result.current.getReExecuteCommand("nonexistent")).toBeNull();
    });
  });
});
