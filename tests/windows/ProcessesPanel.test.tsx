import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ProcessesPanel from "../../src/components/windows/panels/ProcessesPanel";
import type { WinmgmtContext } from "../../src/components/windows/WinmgmtWrapper";
import type { WindowsProcess } from "../../src/types/windows/winmgmt";

const makeProcess = (overrides: Partial<WindowsProcess>): WindowsProcess => ({
  processId: 101,
  parentProcessId: 4,
  name: "notepad.exe",
  executablePath: "C:/Windows/notepad.exe",
  commandLine: "notepad.exe",
  creationDate: "2026-03-30T12:00:00Z",
  status: "Running",
  threadCount: 8,
  handleCount: 120,
  workingSetSize: 50 * 1024 * 1024,
  virtualSize: 300 * 1024 * 1024,
  peakWorkingSetSize: 80 * 1024 * 1024,
  pageFaults: 10,
  pageFileUsage: 0,
  peakPageFileUsage: 0,
  kernelModeTime: 100,
  userModeTime: 200,
  priority: 8,
  sessionId: 1,
  owner: "Administrator",
  readOperationCount: 1,
  writeOperationCount: 1,
  readTransferCount: 1,
  writeTransferCount: 1,
  ...overrides,
});

describe("ProcessesPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders labeled process table and fetches process list on mount", async () => {
    const processes: WindowsProcess[] = [
      makeProcess({ processId: 101, name: "notepad.exe", workingSetSize: 50 * 1024 * 1024 }),
      makeProcess({ processId: 202, name: "explorer.exe", workingSetSize: 120 * 1024 * 1024 }),
    ];

    const cmd = vi.fn(async (command: string) => {
      if (command === "winmgmt_list_processes") return processes;
      return 0;
    });

    const ctx: WinmgmtContext = {
      sessionId: "session-1",
      hostname: "win-host",
      cmd: cmd as WinmgmtContext["cmd"],
    };

    render(<ProcessesPanel ctx={ctx} />);

    expect(await screen.findByRole("table", { name: /Windows processes list/i })).toBeInTheDocument();
    expect(cmd).toHaveBeenCalledWith("winmgmt_list_processes");
    expect(screen.getByRole("textbox", { name: /Search processes/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Refresh processes/i })).toBeInTheDocument();
  });

  it("updates aria-sort on sortable headers and exposes terminate busy state", async () => {
    const processes: WindowsProcess[] = [
      makeProcess({ processId: 101, name: "notepad.exe", workingSetSize: 50 * 1024 * 1024 }),
      makeProcess({ processId: 202, name: "explorer.exe", workingSetSize: 120 * 1024 * 1024 }),
      makeProcess({ processId: 4, name: "System", workingSetSize: 300 * 1024 * 1024 }),
    ];

    let resolveTerminate: () => void = () => {
      throw new Error("Expected terminate action resolver to be initialized");
    };

    const cmd = vi.fn((command: string) => {
      if (command === "winmgmt_list_processes") return Promise.resolve(processes);
      if (command === "winmgmt_terminate_process") {
        return new Promise<number>((resolve) => {
          resolveTerminate = () => resolve(0);
        });
      }
      return Promise.resolve(0);
    });

    const ctx: WinmgmtContext = {
      sessionId: "session-1",
      hostname: "win-host",
      cmd: cmd as WinmgmtContext["cmd"],
    };

    render(<ProcessesPanel ctx={ctx} />);
    await screen.findByRole("table", { name: /Windows processes list/i });

    const memoryHeader = screen.getByRole("columnheader", { name: /^Memory$/i });
    const nameHeader = screen.getByRole("columnheader", { name: /^Name$/i });

    expect(memoryHeader).toHaveAttribute("aria-sort", "descending");
    expect(nameHeader).toHaveAttribute("aria-sort", "none");

    fireEvent.click(screen.getByRole("button", { name: /Sort by Name/i }));
    expect(nameHeader).toHaveAttribute("aria-sort", "descending");

    fireEvent.click(screen.getByRole("button", { name: /Sort by Name/i }));
    expect(nameHeader).toHaveAttribute("aria-sort", "ascending");

    const terminateButton = screen.getByRole("button", {
      name: /Terminate process notepad\.exe \(101\)/i,
    });
    fireEvent.click(terminateButton);

    expect(cmd).toHaveBeenCalledWith("winmgmt_terminate_process", { pid: 101 });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Terminate process notepad\.exe \(101\)/i }),
      ).toHaveAttribute("aria-busy", "true");
    });

    resolveTerminate();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Terminate process notepad\.exe \(101\)/i }),
      ).toHaveAttribute("aria-busy", "false");
    });
  });
});
