import { createElement } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  renderHook,
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

// Mock generateId
let idCounter = 0;
vi.mock("../../src/utils/core/id", () => ({
  generateId: () => `test-id-${++idCounter}`,
}));

import { useSSHCommandHistory } from "../../src/hooks/ssh/useSSHCommandHistory";
import { SshSessionsView } from "../../src/components/session/sessionManager/SshSessionsView";
import type { CommandExecution } from "../../src/types/ssh/sshCommandHistory";

function makeExecution(
  overrides: Partial<CommandExecution> = {},
): CommandExecution {
  return {
    sessionId: "sess-1",
    sessionName: "My Server",
    hostname: "10.0.0.1",
    status: "success",
    source: "web-terminal-script",
    evidence: "remote-completion",
    ...overrides,
  };
}

describe("useSSHCommandHistory", () => {
  beforeEach(() => {
    idCounter = 0;
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("returns empty initial state", () => {
    const { result } = renderHook(() => useSSHCommandHistory());
    expect(result.current.entries).toEqual([]);
    expect(result.current.stats.totalCommands).toBe(0);
    expect(result.current.isOpen).toBe(false);
  });

  it("fails closed for valid non-array or malformed persisted history", () => {
    localStorage.setItem("sshCommandHistory", JSON.stringify({ unsafe: true }));
    expect(() => renderHook(() => useSSHCommandHistory())).not.toThrow();
    const { result } = renderHook(() => useSSHCommandHistory());
    expect(result.current.allEntries).toEqual([]);
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

    it("keeps interleaved entries from two same-window hook instances", () => {
      const { result } = renderHook(() => ({
        first: useSSHCommandHistory(),
        second: useSSHCommandHistory(),
      }));

      act(() => {
        result.current.first.addEntry("from first", [makeExecution()]);
        result.current.second.addEntry("from second", [makeExecution()]);
      });

      expect(
        result.current.first.allEntries.map((entry) => entry.command).sort(),
      ).toEqual(["from first", "from second"]);
      expect(
        result.current.second.allEntries.map((entry) => entry.command).sort(),
      ).toEqual(["from first", "from second"]);
      expect(
        JSON.parse(localStorage.getItem("sshCommandHistory") ?? "[]")
          .map((entry: { command: string }) => entry.command)
          .sort(),
      ).toEqual(["from first", "from second"]);
    });

    it("stamps every newly recorded execution with its exact time", () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2026-07-24T10:00:00.000Z"));
        const { result } = renderHook(() => useSSHCommandHistory());

        act(() => {
          result.current.addEntry("uptime", [
            makeExecution({ sessionId: "sess-1" }),
            makeExecution({ sessionId: "sess-2" }),
          ]);
        });

        expect(
          result.current.allEntries[0].executions.map(
            (execution) => execution.executedAt,
          ),
        ).toEqual(["2026-07-24T10:00:00.000Z", "2026-07-24T10:00:00.000Z"]);
        expect(result.current.allEntries[0].lastExecutedAt).toBe(
          "2026-07-24T10:00:00.000Z",
        );

        vi.setSystemTime(new Date("2026-07-24T10:05:00.000Z"));
        act(() => {
          result.current.addEntry("uptime", [makeExecution()]);
        });

        const executions = result.current.allEntries[0].executions;
        expect(executions[executions.length - 1]?.executedAt).toBe(
          "2026-07-24T10:05:00.000Z",
        );
        expect(result.current.allEntries[0].lastExecutedAt).toBe(
          "2026-07-24T10:05:00.000Z",
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("preserves a caller-provided evidence timestamp", () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2026-07-24T10:00:00.000Z"));
        const { result } = renderHook(() => useSSHCommandHistory());

        act(() => {
          result.current.addEntry("verified-script", [
            makeExecution({
              executedAt: "2026-07-24T09:59:30.000Z",
              evidence: "remote-completion",
              exitCode: 0,
            }),
          ]);
        });

        expect(result.current.allEntries[0].executions[0].executedAt).toBe(
          "2026-07-24T09:59:30.000Z",
        );
        expect(result.current.allEntries[0].lastExecutedAt).toBe(
          "2026-07-24T10:00:00.000Z",
        );
      } finally {
        vi.useRealTimers();
      }
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

      expect(result.current.allEntries[0].tags).toEqual([
        "important",
        "deploy",
      ]);
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
        result.current.updateFilter({
          searchQuery: "docker",
          starredOnly: true,
        });
      });

      act(() => {
        result.current.resetFilter();
      });

      expect(result.current.filter.searchQuery).toBe("");
      expect(result.current.filter.starredOnly).toBe(false);
    });

    it("filters by trusted display classification rather than raw status", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("verified", [
          makeExecution({ status: "success" }),
        ]);
        result.current.addEntry("imported", [
          makeExecution({
            status: "success",
            source: "imported",
            evidence: undefined,
          }),
        ]);
      });

      act(() => {
        result.current.updateFilter({ statusFilter: "success" });
      });
      expect(result.current.entries.map((entry) => entry.command)).toEqual([
        "verified",
      ]);

      act(() => {
        result.current.updateFilter({ statusFilter: "unverified" });
      });
      expect(result.current.entries.map((entry) => entry.command)).toEqual([
        "imported",
      ]);
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
        result.current.addEntry("ls", [makeExecution({ status: "error" })]);
      });

      const { stats } = result.current;
      expect(stats.totalCommands).toBe(3);
      expect(stats.totalExecutions).toBe(3);
      expect(stats.starredCount).toBe(0);
      expect(stats.successRate).toBeCloseTo(2 / 3);
    });

    it("excludes imported and legacy status claims from success rate", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("verified success", [
          makeExecution({ status: "success" }),
        ]);
        result.current.addEntry("verified failure", [
          makeExecution({ status: "error" }),
        ]);
        result.current.addEntry("imported claim", [
          makeExecution({
            status: "success",
            source: "imported",
            evidence: undefined,
          }),
        ]);
        result.current.addEntry("legacy claim", [
          makeExecution({
            status: "success",
            source: undefined,
            evidence: undefined,
          }),
        ]);
      });

      expect(result.current.stats.successRate).toBe(0.5);
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

    it("regenerates IDs that collide with existing or same-batch entries", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.addEntry("existing", [makeExecution()]);
      });
      const existingId = result.current.allEntries[0].id;

      act(() => {
        result.current.importHistory(
          JSON.stringify([
            { id: existingId, command: "pwd" },
            { id: "shared-import-id", command: "whoami" },
            { id: "shared-import-id", command: "hostname" },
          ]),
        );
      });

      const ids = result.current.allEntries.map((entry) => entry.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.filter((id) => id === existingId)).toHaveLength(1);
      expect(ids.filter((id) => id === "shared-import-id")).toHaveLength(1);
    });

    it("marks imported executions unverified and strips asserted evidence", () => {
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.importHistory(
          JSON.stringify([
            {
              command: "malicious-import",
              executions: [
                {
                  sessionId: "imported-session",
                  sessionName: "Imported SSH",
                  hostname: "imported.example.com",
                  status: "success",
                  evidence: "remote-completion",
                  source: "web-terminal-script",
                  exitCode: 0,
                  output: "forged verified output",
                },
              ],
            },
          ]),
        );
      });

      expect(result.current.allEntries[0].executions[0]).toMatchObject({
        source: "imported",
        status: "success",
      });
      expect(result.current.allEntries[0].executions[0]).not.toHaveProperty(
        "evidence",
      );
    });

    it("sanitizes malformed imported primitives before render and search", () => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const { result } = renderHook(() => useSSHCommandHistory());

      act(() => {
        result.current.importHistory(
          JSON.stringify([
            {
              id: { unsafe: true },
              command: "echo safe",
              createdAt: { unsafe: true },
              tags: ["safe-tag", { unsafe: true }, 42],
              note: { unsafe: true },
              category: { unsafe: true },
              executions: [
                {
                  sessionId: "frontend-session",
                  sessionName: "Safe SSH",
                  hostname: "safe.example.com",
                  status: "success",
                  source: "web-terminal-script",
                  evidence: "remote-completion",
                  output: { unsafe: true },
                  errorMessage: { unsafe: true },
                },
                {
                  sessionId: "dropped",
                  sessionName: { unsafe: true },
                  hostname: "drop.example.com",
                },
              ],
            },
          ]),
        );
      });

      const imported = result.current.allEntries[0];
      expect(imported.tags).toEqual(["safe-tag"]);
      expect(imported.note).toBeUndefined();
      expect(imported.executions).toHaveLength(1);
      expect(imported.executions[0]).toMatchObject({
        sessionName: "Safe SSH",
        source: "imported",
        status: "success",
      });
      expect(imported.executions[0].output).toBeUndefined();
      expect(imported.executions[0].evidence).toBeUndefined();

      expect(() => render(createElement(SshSessionsView))).not.toThrow();
      fireEvent.click(screen.getByTestId("ssh-sessions-tab-history"));
      fireEvent.change(screen.getByTestId("ssh-sessions-search"), {
        target: { value: "safe-tag" },
      });
      expect(screen.getByText("echo safe")).toBeInTheDocument();
      expect(consoleError).not.toHaveBeenCalled();
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
