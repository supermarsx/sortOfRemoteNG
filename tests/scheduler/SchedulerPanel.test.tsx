import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import React from "react";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: unknown) => {
      if (opts && typeof opts === "object" && "count" in opts)
        return `${key} ${(opts as Record<string, unknown>).count}`;
      return key;
    },
  }),
}));

import { SchedulerPanel } from "../../src/components/scheduler/SchedulerPanel";

let schedulerEnabled = true;

const renderOpenScheduler = async () => {
  const view = render(<SchedulerPanel isOpen={true} onClose={vi.fn()} />);

  await waitFor(() => {
    expect(screen.getByText("scheduler.noTasks")).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledWith("sched_list_tasks");
    expect(mockInvoke).toHaveBeenCalledWith("sched_get_stats");
    expect(mockInvoke).toHaveBeenCalledWith("sched_get_upcoming", {
      count: 20,
    });
    expect(mockInvoke).toHaveBeenCalledWith("sched_get_history", {
      taskId: null,
      limit: 100,
    });
    expect(mockInvoke).toHaveBeenCalledWith("sched_get_config");
  });

  return view;
};

describe("SchedulerPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    schedulerEnabled = true;
    mockInvoke.mockImplementation(async (command: string) => {
      if (
        command === "sched_list_tasks" ||
        command === "sched_get_history" ||
        command === "sched_get_upcoming" ||
        command === "sched_get_next_occurrences"
      ) {
        return [];
      }
      if (command === "sched_get_stats") {
        return {
          total_tasks: 0,
          enabled_tasks: 0,
          total_executions: 0,
          successful: 0,
          failed: 0,
          avg_duration_ms: 0,
          next_scheduled_at: null,
          tasks_by_priority: {},
        };
      }
      if (command === "sched_get_config") {
        return {
          enabled: schedulerEnabled,
          max_concurrent_tasks: 4,
          default_timeout_ms: 60_000,
          history_retention_days: 30,
          check_interval_seconds: 30,
          catch_up_missed: false,
        };
      }
      if (command === "sched_pause_all") {
        schedulerEnabled = false;
      } else if (command === "sched_resume_all") {
        schedulerEnabled = true;
      }
      return undefined;
    });
  });

  it("renders the title", async () => {
    await renderOpenScheduler();
    expect(screen.getByText("scheduler.title")).toBeInTheDocument();
  });

  it("shows tab bar", async () => {
    await renderOpenScheduler();
    expect(
      screen.getByRole("button", { name: "scheduler.tasks" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "scheduler.upcoming" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "scheduler.history" }),
    ).toBeInTheDocument();
  });

  it("shows add task button", async () => {
    await renderOpenScheduler();
    expect(
      screen.getByRole("button", { name: "scheduler.addWakeTask" }),
    ).toBeInTheDocument();
  });

  it("shows pause control", async () => {
    await renderOpenScheduler();
    expect(
      screen.getByRole("button", { name: "scheduler.pause" }),
    ).toBeInTheDocument();
  });

  it("shows resume control when paused", async () => {
    schedulerEnabled = false;
    await renderOpenScheduler();
    expect(
      screen.getByRole("button", { name: "scheduler.resume" }),
    ).toBeInTheDocument();
  });

  it("shows empty state when no tasks", async () => {
    await renderOpenScheduler();
    expect(screen.getByText("scheduler.noTasks")).toBeInTheDocument();
  });

  it("opens add task modal when button clicked", async () => {
    const view = await renderOpenScheduler();
    const addBtn = screen.getByRole("button", {
      name: "scheduler.addWakeTask",
    });
    fireEvent.click(addBtn);
    expect(
      screen.getByRole("textbox", { name: "scheduler.name" }),
    ).toBeInTheDocument();
    await act(async () => view.unmount());
  });

  it("switches to upcoming tab", async () => {
    await renderOpenScheduler();
    const tab = screen.getByRole("button", { name: "scheduler.upcoming" });
    fireEvent.click(tab);
    expect(tab).toHaveClass("bg-[var(--color-accent)]");
  });

  it("switches to history tab", async () => {
    await renderOpenScheduler();
    const tab = screen.getByRole("button", { name: "scheduler.history" });
    fireEvent.click(tab);
    expect(tab).toHaveClass("bg-[var(--color-accent)]");
  });

  it("calls sched_list_tasks on mount", async () => {
    await renderOpenScheduler();
    expect(mockInvoke).toHaveBeenCalledWith("sched_list_tasks");
  });

  it("shows the cron schedule in the add modal", async () => {
    const view = await renderOpenScheduler();
    const addBtn = screen.getByRole("button", {
      name: "scheduler.addWakeTask",
    });
    fireEvent.click(addBtn);
    expect(screen.getByRole("textbox", { name: "scheduler.cron" })).toHaveValue(
      "0 8 * * 1-5",
    );
    await act(async () => view.unmount());
  });

  it("calls pause all when button clicked", async () => {
    await renderOpenScheduler();
    const btn = screen.getByRole("button", { name: "scheduler.pause" });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "scheduler.resume" }),
      ).toBeInTheDocument(),
    );
    expect(mockInvoke).toHaveBeenCalledWith("sched_pause_all");
  });
});
