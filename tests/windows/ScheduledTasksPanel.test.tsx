import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ScheduledTasksPanel from "../../src/components/windows/panels/ScheduledTasksPanel";
import type { WinmgmtContext } from "../../src/components/windows/WinmgmtWrapper";
import type { ScheduledTask } from "../../src/types/windows/winmgmt";

const { scheduledTasksT } = vi.hoisted(() => ({
  scheduledTasksT: vi.fn(
    (
      _key: string,
      fallback: string,
      values?: Record<string, unknown>,
    ) =>
      fallback.replace(/{{(\w+)}}/g, (_match, name: string) =>
        String(values?.[name] ?? `{{${name}}}`),
      ),
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: scheduledTasksT }),
}));

const makeTask = (overrides: Partial<ScheduledTask> = {}): ScheduledTask => ({
  taskName: "Backup",
  taskPath: "\\Microsoft\\Windows",
  state: "ready",
  description: "Backup job",
  author: "SYSTEM",
  date: null,
  uri: null,
  lastRunTime: "2026-03-29T08:00:00.000Z",
  lastTaskResult: 0,
  nextRunTime: "2026-03-31T08:00:00.000Z",
  numberOfMissedRuns: 0,
  actions: [{ actionType: "Execute", execute: "backup.exe", arguments: null, workingDirectory: null }],
  triggers: [{ triggerType: "Daily", enabled: true, startBoundary: "2026-03-31T08:00:00.000Z", endBoundary: null, repetitionInterval: "PT1H", repetitionDuration: null }],
  principal: { userId: "SYSTEM", runLevel: "Highest" } as ScheduledTask["principal"],
  ...overrides,
});

const mockTasks: ScheduledTask[] = [
  makeTask({ taskName: "Backup", state: "ready" }),
  makeTask({ taskName: "Cleanup", state: "disabled", taskPath: "\\Maintenance" }),
  makeTask({ taskName: "Indexer", state: "running", taskPath: "\\Search" }),
];

const createCmd = () =>
  vi.fn((command: string) => {
    if (command === "winmgmt_list_tasks") return Promise.resolve(mockTasks);
    return Promise.resolve(null);
  });

const createCtx = (cmd: ReturnType<typeof createCmd>): WinmgmtContext => ({
  sessionId: "session-1",
  hostname: "win-host",
  cmd: cmd as WinmgmtContext["cmd"],
});

describe("ScheduledTasksPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders task list with enable/disable buttons", async () => {
    const cmd = createCmd();
    render(<ScheduledTasksPanel ctx={createCtx(cmd)} />);

    const table = await screen.findByRole("table", { name: /Scheduled tasks list/i });
    expect(table).toBeInTheDocument();

    expect(cmd).toHaveBeenCalledWith("winmgmt_list_tasks");

    // Ready task has a Disable button
    expect(await screen.findByRole("button", { name: /Disable task Backup/i })).toBeInTheDocument();

    // Disabled task has an Enable button
    expect(screen.getByRole("button", { name: /Enable task Cleanup/i })).toBeInTheDocument();
  });

  it("shows confirmation dialog when disabling a task", async () => {
    const cmd = createCmd();
    render(<ScheduledTasksPanel ctx={createCtx(cmd)} />);

    await screen.findByRole("table", { name: /Scheduled tasks list/i });

    const disableBtn = await screen.findByRole("button", { name: /Disable task Backup/i });
    fireEvent.click(disableBtn);

    // Confirmation dialog should appear
    expect(await screen.findByText(/Are you sure you want to disable "Backup"/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cancel/i })).toBeInTheDocument();
    // The dialog has a confirm button with text "Disable" — use getAllByRole and find the one inside the dialog
    const disableButtons = screen.getAllByRole("button", { name: /^Disable$/i });
    expect(disableButtons.length).toBeGreaterThanOrEqual(1);
  });

  it("calls backend to toggle task state", async () => {
    const cmd = createCmd();
    render(<ScheduledTasksPanel ctx={createCtx(cmd)} />);

    await screen.findByRole("table", { name: /Scheduled tasks list/i });

    // Enable a disabled task (no confirmation dialog needed)
    const enableBtn = screen.getByRole("button", { name: /Enable task Cleanup/i });
    fireEvent.click(enableBtn);

    await waitFor(() => {
      expect(cmd).toHaveBeenCalledWith("winmgmt_enable_task", {
        taskPath: "\\Maintenance",
        taskName: "Cleanup",
      });
    });

    // Disable via confirmation dialog
    const disableBtn = screen.getByRole("button", { name: /Disable task Backup/i });
    fireEvent.click(disableBtn);

    await screen.findByText(/Are you sure you want to disable/i);
    // Find the confirmation dialog's Disable button — it differs from the row buttons
    // by not having an aria-label (row buttons have "Disable task ...")
    const allDisableButtons = screen.getAllByRole("button").filter(
      (b) => b.textContent === "Disable" && !b.getAttribute("aria-label"),
    );
    fireEvent.click(allDisableButtons[0]);

    await waitFor(() => {
      expect(cmd).toHaveBeenCalledWith("winmgmt_disable_task", {
        taskPath: "\\Microsoft\\Windows",
        taskName: "Backup",
      });
    });
  });

  it("table has proper ARIA (aria-label, scope='col' on headers)", async () => {
    const cmd = createCmd();
    render(<ScheduledTasksPanel ctx={createCtx(cmd)} />);

    const table = await screen.findByRole("table", { name: /Scheduled tasks list/i });
    expect(table).toBeInTheDocument();

    const headers = table.querySelectorAll("th[scope='col']");
    expect(headers.length).toBe(5);

    const headerTexts = Array.from(headers).map((h) => h.textContent?.trim());
    expect(headerTexts).toEqual(["Name", "Status", "Last Run", "Next Run", "Actions"]);
  });
  it("routes every ScheduledTasksPanel manifest candidate through translation fallbacks", async () => {
    const cmd = createCmd();
    render(<ScheduledTasksPanel ctx={createCtx(cmd)} />);

    await screen.findByRole("table", { name: /Scheduled tasks list/i });
    fireEvent.click(screen.getByText("Backup"));

    const expectedCalls = [
      ["windows.scheduledTasks.searchTasks", "Search tasks…"],
      ["windows.scheduledTasks.filters.all", "All"],
      ["windows.scheduledTasks.states.ready", "Ready"],
      ["windows.scheduledTasks.states.running", "Running"],
      ["windows.scheduledTasks.states.disabled", "Disabled"],
      ["windows.scheduledTasks.refresh", "Refresh"],
      ["windows.scheduledTasks.tableLabel", "Scheduled tasks list"],
      ["windows.scheduledTasks.columns.name", "Name"],
      ["windows.scheduledTasks.columns.status", "Status"],
      ["windows.scheduledTasks.columns.lastRun", "Last Run"],
      ["windows.scheduledTasks.columns.nextRun", "Next Run"],
      ["windows.scheduledTasks.columns.actions", "Actions"],
      ["windows.scheduledTasks.actions.run", "Run"],
      ["windows.scheduledTasks.actions.stop", "Stop"],
      ["windows.scheduledTasks.actions.disable", "Disable"],
      ["windows.scheduledTasks.actions.enable", "Enable"],
      ["windows.scheduledTasks.detail.path", "Path"],
      ["windows.scheduledTasks.detail.state", "State"],
      ["windows.scheduledTasks.detail.author", "Author"],
      ["windows.scheduledTasks.detail.description", "Description"],
      ["windows.scheduledTasks.detail.lastResult", "Last Result"],
      ["windows.scheduledTasks.detail.runAs", "Run As"],
      ["windows.scheduledTasks.detail.runLevel", "Run Level"],
      ["windows.scheduledTasks.columns.actions", "Actions"],
      ["windows.scheduledTasks.detail.triggers", "Triggers"],
      ["windows.scheduledTasks.detail.start", "Start:"],
      ["windows.scheduledTasks.detail.repeat", "Repeat:"],
      ["windows.scheduledTasks.confirmDisableTitle", "Disable Task"],
    ] as const;
    expect(expectedCalls).toHaveLength(28);
    for (const [key, fallback] of expectedCalls) {
      expect(scheduledTasksT).toHaveBeenCalledWith(key, fallback);
    }
  });

});
