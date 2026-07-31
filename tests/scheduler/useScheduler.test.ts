import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useScheduler } from "../../src/hooks/scheduler/useScheduler";
import type {
  ScheduledTask,
  SchedulerConfig,
  SchedulerStats,
  TaskExecutionRecord,
} from "../../src/types/scheduler/scheduler";

const mockInvoke = vi.mocked(invoke);

const makeTask = (overrides: Partial<ScheduledTask> = {}): ScheduledTask => ({
  id: "t1",
  name: "Task A",
  description: "",
  enabled: true,
  schedule: { type: "cron", expression: "*/5 * * * *" },
  action: {
    type: "send_wake_on_lan",
    mac_address: "00:11:22:33:44:55",
    port: 9,
  },
  conditions: [],
  retry_policy: {
    max_retries: 3,
    retry_delay_ms: 5_000,
    backoff_multiplier: 2,
    max_delay_ms: 60_000,
  },
  timeout_ms: 30_000,
  tags: [],
  priority: "Normal",
  created_at: "2026-03-30T00:00:00Z",
  updated_at: "2026-03-30T00:00:00Z",
  last_run_at: null,
  next_run_at: null,
  run_count: 0,
  fail_count: 0,
  ...overrides,
});

const makeRecord = (
  overrides: Partial<TaskExecutionRecord> = {},
): TaskExecutionRecord => ({
  id: "h1",
  task_id: "t1",
  task_name: "Task A",
  started_at: "2026-03-30T00:00:00Z",
  completed_at: "2026-03-30T00:01:00Z",
  duration_ms: 60_000,
  status: "Completed",
  result: { message: "ok" },
  error: null,
  retry_attempt: 0,
  ...overrides,
});

const makeConfig = (
  overrides: Partial<SchedulerConfig> = {},
): SchedulerConfig => ({
  enabled: true,
  max_concurrent_tasks: 5,
  default_timeout_ms: 60_000,
  history_retention_days: 30,
  check_interval_seconds: 15,
  catch_up_missed: false,
  ...overrides,
});

describe("useScheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue(undefined as never);
  });

  it("starts with empty scheduler state", () => {
    const { result } = renderHook(() => useScheduler());

    expect(result.current.tasks).toEqual([]);
    expect(result.current.history).toEqual([]);
    expect(result.current.upcoming).toEqual([]);
    expect(result.current.stats).toBeNull();
    expect(result.current.config).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("fetches Rust-wire tasks and exposes loading state", async () => {
    let resolve!: (value: ScheduledTask[]) => void;
    mockInvoke.mockImplementationOnce(
      () =>
        new Promise<ScheduledTask[]>((complete) => {
          resolve = complete;
        }),
    );

    const { result } = renderHook(() => useScheduler());
    act(() => {
      void result.current.fetchTasks();
    });
    await waitFor(() => expect(result.current.loading).toBe(true));
    await act(async () => {
      resolve([makeTask(), makeTask({ id: "t2", name: "Task B" })]);
    });

    expect(mockInvoke).toHaveBeenCalledWith("sched_list_tasks");
    expect(result.current.tasks.map((task) => task.id)).toEqual(["t1", "t2"]);
    expect(result.current.loading).toBe(false);
  });

  it("reports task-list failures without fabricating tasks", async () => {
    mockInvoke.mockRejectedValueOnce("Backend unavailable");
    const { result } = renderHook(() => useScheduler());

    await act(async () => {
      expect(await result.current.fetchTasks()).toEqual([]);
    });

    expect(result.current.error).toBe("Backend unavailable");
    expect(result.current.tasks).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("adds a complete wire task and refreshes authoritative state", async () => {
    const newTask = makeTask({ id: "new-1", name: "New Task" });
    mockInvoke.mockImplementation((command) => {
      if (command === "sched_add_task") return Promise.resolve("new-1");
      if (command === "sched_list_tasks") return Promise.resolve([newTask]);
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useScheduler());

    let id: string | null = null;
    await act(async () => {
      id = await result.current.addTask(newTask);
    });

    expect(id).toBe("new-1");
    expect(mockInvoke).toHaveBeenCalledWith("sched_add_task", {
      task: newTask,
    });
    expect(result.current.tasks).toEqual([newTask]);
  });

  it("fails closed when task creation is rejected", async () => {
    mockInvoke.mockRejectedValueOnce("Duplicate name");
    const { result } = renderHook(() => useScheduler());

    await act(async () => {
      expect(await result.current.addTask(makeTask())).toBeNull();
    });

    expect(result.current.error).toBe("Duplicate name");
  });

  it("updates a complete wire task and refreshes authoritative state", async () => {
    const updated = makeTask({ name: "Updated" });
    mockInvoke.mockImplementation((command) => {
      if (command === "sched_list_tasks") return Promise.resolve([updated]);
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useScheduler());

    await act(async () => {
      expect(await result.current.updateTask(updated)).toBe(true);
    });

    expect(mockInvoke).toHaveBeenCalledWith("sched_update_task", {
      task: updated,
    });
    expect(result.current.tasks).toEqual([updated]);
  });

  it("removes a task from local state after backend acknowledgement", async () => {
    const tasks = [makeTask(), makeTask({ id: "t2", name: "Task B" })];
    mockInvoke.mockImplementation((command) => {
      if (command === "sched_list_tasks") return Promise.resolve(tasks);
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useScheduler());

    await act(async () => {
      await result.current.fetchTasks();
      expect(await result.current.removeTask("t1")).toBe(true);
    });

    expect(mockInvoke).toHaveBeenCalledWith("sched_remove_task", {
      taskId: "t1",
    });
    expect(result.current.tasks.map((task) => task.id)).toEqual(["t2"]);
  });

  it("uses the pause/resume task contract for enabled state", async () => {
    mockInvoke.mockImplementation((command) => {
      if (command === "sched_list_tasks") {
        return Promise.resolve([makeTask({ enabled: false })]);
      }
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useScheduler());
    await act(async () => {
      await result.current.fetchTasks();
    });

    await act(async () => {
      expect(await result.current.setTaskEnabled("t1", true)).toBe(true);
    });
    expect(mockInvoke).toHaveBeenCalledWith("sched_enable_task", {
      taskId: "t1",
    });
    expect(result.current.tasks[0].enabled).toBe(true);

    await act(async () => {
      expect(await result.current.setTaskEnabled("t1", false)).toBe(true);
    });
    expect(mockInvoke).toHaveBeenCalledWith("sched_disable_task", {
      taskId: "t1",
    });
    expect(result.current.tasks[0].enabled).toBe(false);
  });

  it("does not optimistically change enabled state after rejection", async () => {
    mockInvoke.mockRejectedValueOnce("Permission denied");
    const { result } = renderHook(() => useScheduler());

    await act(async () => {
      expect(await result.current.setTaskEnabled("t1", true)).toBe(false);
    });

    expect(result.current.error).toBe("Permission denied");
    expect(result.current.tasks).toEqual([]);
  });

  it("executes a task and refreshes task and history state", async () => {
    const task = makeTask();
    const record = makeRecord();
    mockInvoke.mockImplementation((command) => {
      if (command === "sched_execute_now") return Promise.resolve(record);
      if (command === "sched_list_tasks") return Promise.resolve([task]);
      if (command === "sched_get_history") return Promise.resolve([record]);
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useScheduler());

    await act(async () => {
      expect(await result.current.executeNow("t1")).toEqual(record);
    });

    expect(mockInvoke).toHaveBeenCalledWith("sched_execute_now", {
      taskId: "t1",
    });
    expect(result.current.tasks).toEqual([task]);
    expect(result.current.history).toEqual([record]);
  });

  it("cancels a running task only after backend acknowledgement", async () => {
    const { result } = renderHook(() => useScheduler());

    await act(async () => {
      expect(await result.current.cancelTask("t1")).toBe(true);
    });

    expect(mockInvoke).toHaveBeenCalledWith("sched_cancel_task", {
      taskId: "t1",
    });
  });

  it("fetches bounded history with snake_case records", async () => {
    const record = makeRecord();
    mockInvoke.mockResolvedValueOnce([record] as never);
    const { result } = renderHook(() => useScheduler());

    await act(async () => {
      expect(await result.current.fetchHistory("t1", 25)).toEqual([record]);
    });

    expect(mockInvoke).toHaveBeenCalledWith("sched_get_history", {
      taskId: "t1",
      limit: 25,
    });
    expect(result.current.history[0].status).toBe("Completed");
  });

  it("maps upcoming task tuples returned by Rust", async () => {
    const task = makeTask();
    const nextRun = "2026-03-30T01:00:00Z";
    mockInvoke.mockResolvedValueOnce([[task, nextRun]] as never);
    const { result } = renderHook(() => useScheduler());

    await act(async () => {
      await result.current.fetchUpcoming();
    });

    expect(mockInvoke).toHaveBeenCalledWith("sched_get_upcoming", {
      count: 20,
    });
    expect(result.current.upcoming).toEqual([{ task, next_run_at: nextRun }]);
  });

  it("treats cron validation as success-or-error text", async () => {
    const { result } = renderHook(() => useScheduler());

    await act(async () => {
      expect(await result.current.validateCron("*/5 * * * *")).toBeNull();
    });
    expect(mockInvoke).toHaveBeenCalledWith("sched_validate_cron", {
      expression: "*/5 * * * *",
    });

    mockInvoke.mockRejectedValueOnce("Invalid expression");
    await act(async () => {
      expect(await result.current.validateCron("bad cron")).toBe(
        "Invalid expression",
      );
    });
  });

  it("fetches the requested number of cron occurrences", async () => {
    const dates = ["2026-03-30T00:05:00Z", "2026-03-30T00:10:00Z"];
    mockInvoke.mockResolvedValueOnce(dates as never);
    const { result } = renderHook(() => useScheduler());

    await act(async () => {
      expect(await result.current.getNextOccurrences("*/5 * * * *", 2)).toEqual(
        dates,
      );
    });

    expect(mockInvoke).toHaveBeenCalledWith("sched_get_next_occurrences", {
      expression: "*/5 * * * *",
      count: 2,
    });
  });

  it("pauses and resumes the scheduler through explicit commands", async () => {
    const { result } = renderHook(() => useScheduler());

    await act(async () => {
      expect(await result.current.pauseAll()).toBe(true);
      expect(await result.current.resumeAll()).toBe(true);
    });

    expect(mockInvoke).toHaveBeenCalledWith("sched_pause_all");
    expect(mockInvoke).toHaveBeenCalledWith("sched_resume_all");
  });

  it("loads snake_case statistics and configuration", async () => {
    const stats: SchedulerStats = {
      total_tasks: 10,
      enabled_tasks: 7,
      total_executions: 100,
      successful: 97,
      failed: 3,
      avg_duration_ms: 5_000,
      next_scheduled_at: "2026-03-30T01:00:00Z",
      tasks_by_priority: { Normal: 10 },
    };
    const config = makeConfig();
    mockInvoke.mockImplementation((command) => {
      if (command === "sched_get_stats") return Promise.resolve(stats);
      if (command === "sched_get_config") return Promise.resolve(config);
      return Promise.resolve(undefined);
    });
    const { result } = renderHook(() => useScheduler());

    await act(async () => {
      expect(await result.current.fetchStats()).toEqual(stats);
      expect(await result.current.loadConfig()).toEqual(config);
    });

    expect(result.current.stats).toEqual(stats);
    expect(result.current.config).toEqual(config);
  });

  it("persists a complete replacement scheduler config", async () => {
    const next = makeConfig({ max_concurrent_tasks: 10 });
    const { result } = renderHook(() => useScheduler());

    await act(async () => {
      expect(await result.current.updateConfig(next)).toBe(true);
    });

    expect(mockInvoke).toHaveBeenCalledWith("sched_update_config", {
      config: next,
    });
    expect(result.current.config).toEqual(next);
  });

  it("retains the last known config when persistence fails", async () => {
    const initial = makeConfig();
    mockInvoke.mockResolvedValueOnce(initial as never);
    const { result } = renderHook(() => useScheduler());
    await act(async () => {
      await result.current.loadConfig();
    });

    mockInvoke.mockRejectedValueOnce("Write error");
    await act(async () => {
      expect(
        await result.current.updateConfig(
          makeConfig({ max_concurrent_tasks: 10 }),
        ),
      ).toBe(false);
    });

    expect(result.current.error).toBe("Write error");
    expect(result.current.config).toEqual(initial);
  });
});
