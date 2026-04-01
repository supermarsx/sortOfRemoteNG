import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useScheduler } from "../../src/hooks/scheduler/useScheduler";

const mockInvoke = vi.mocked(invoke);

const makeTask = (overrides: Record<string, unknown> = {}) => ({
  id: "t1",
  name: "Task A",
  description: "",
  kind: "script",
  scheduleType: "cron",
  cronExpression: "*/5 * * * *",
  intervalMs: null,
  scheduledAt: null,
  enabled: true,
  connectionIds: [],
  payload: {},
  tags: [],
  createdAt: "2026-03-30T00:00:00Z",
  updatedAt: "2026-03-30T00:00:00Z",
  lastRun: null,
  nextRun: null,
  runCount: 0,
  failCount: 0,
  maxRetries: 3,
  retryDelayMs: 5000,
  timeoutMs: 30000,
  ...overrides,
});

describe("useScheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue(undefined as never);
  });

  // --- initial state ---

  it("has correct initial state", () => {
    const { result } = renderHook(() => useScheduler());
    expect(result.current.tasks).toEqual([]);
    expect(result.current.history).toEqual([]);
    expect(result.current.upcoming).toEqual([]);
    expect(result.current.stats).toBeNull();
    expect(result.current.config).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  // --- fetchTasks ---

  it("fetchTasks sets tasks on success", async () => {
    const tasks = [makeTask(), makeTask({ id: "t2", name: "Task B" })];
    mockInvoke.mockResolvedValueOnce(tasks as never);

    const { result } = renderHook(() => useScheduler());
    await act(async () => { await result.current.fetchTasks(); });

    expect(mockInvoke).toHaveBeenCalledWith("sched_list_tasks");
    expect(result.current.tasks).toHaveLength(2);
    expect(result.current.tasks[0].name).toBe("Task A");
  });

  it("fetchTasks sets loading while fetching", async () => {
    let resolve!: (v: unknown) => void;
    mockInvoke.mockImplementationOnce(() => new Promise(r => { resolve = r; }));

    const { result } = renderHook(() => useScheduler());
    act(() => { result.current.fetchTasks(); });

    await waitFor(() => expect(result.current.loading).toBe(true));

    await act(async () => { resolve([]); });
    expect(result.current.loading).toBe(false);
  });

  it("fetchTasks sets error on failure", async () => {
    mockInvoke.mockRejectedValueOnce("Backend unavailable");

    const { result } = renderHook(() => useScheduler());
    await act(async () => { await result.current.fetchTasks(); });

    expect(result.current.error).toBe("Backend unavailable");
    expect(result.current.tasks).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  // --- addTask ---

  it("addTask invokes backend and refreshes tasks", async () => {
    const newTask = makeTask({ id: "new-1", name: "New Task" });
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "sched_add_task") return Promise.resolve("new-1");
      if (cmd === "sched_list_tasks") return Promise.resolve([newTask]);
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useScheduler());
    let id: string | null = null;
    await act(async () => {
      id = await result.current.addTask({
        name: "New Task", description: "", kind: "script",
        scheduleType: "cron", cronExpression: "*/5 * * * *",
        intervalMs: null, scheduledAt: null, enabled: true,
        connectionIds: [], payload: {}, tags: [],
        maxRetries: 3, retryDelayMs: 5000, timeoutMs: 30000,
      });
    });

    expect(id).toBe("new-1");
    expect(mockInvoke).toHaveBeenCalledWith("sched_add_task", expect.objectContaining({ task: expect.objectContaining({ name: "New Task" }) }));
    expect(result.current.tasks).toHaveLength(1);
  });

  it("addTask returns null on error", async () => {
    mockInvoke.mockRejectedValueOnce("Duplicate name");

    const { result } = renderHook(() => useScheduler());
    let id: string | null = null;
    await act(async () => {
      id = await result.current.addTask({
        name: "Dup", description: "", kind: "script",
        scheduleType: "once", cronExpression: null,
        intervalMs: null, scheduledAt: null, enabled: true,
        connectionIds: [], payload: {}, tags: [],
        maxRetries: 0, retryDelayMs: 0, timeoutMs: 30000,
      });
    });

    expect(id).toBeNull();
    expect(result.current.error).toBe("Duplicate name");
  });

  // --- removeTask ---

  it("removeTask filters task from state", async () => {
    const tasks = [makeTask({ id: "t1" }), makeTask({ id: "t2", name: "Task B" })];
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "sched_list_tasks") return Promise.resolve(tasks);
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useScheduler());
    await act(async () => { await result.current.fetchTasks(); });
    expect(result.current.tasks).toHaveLength(2);

    await act(async () => { await result.current.removeTask("t1"); });

    expect(mockInvoke).toHaveBeenCalledWith("sched_remove_task", { taskId: "t1" });
    expect(result.current.tasks).toHaveLength(1);
    expect(result.current.tasks[0].id).toBe("t2");
  });

  it("removeTask sets error on failure", async () => {
    mockInvoke.mockRejectedValueOnce("Not found");

    const { result } = renderHook(() => useScheduler());
    await act(async () => { await result.current.removeTask("bad-id"); });

    expect(result.current.error).toBe("Not found");
  });

  // --- updateTask ---

  it("updateTask invokes backend and refreshes", async () => {
    const updated = makeTask({ id: "t1", name: "Updated" });
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "sched_update_task") return Promise.resolve(undefined);
      if (cmd === "sched_list_tasks") return Promise.resolve([updated]);
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useScheduler());
    await act(async () => { await result.current.updateTask("t1", { name: "Updated" }); });

    expect(mockInvoke).toHaveBeenCalledWith("sched_update_task", { taskId: "t1", updates: { name: "Updated" } });
    expect(result.current.tasks[0].name).toBe("Updated");
  });

  // --- enableTask / disableTask ---

  it("enableTask sets task enabled to true optimistically", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "sched_list_tasks") return Promise.resolve([makeTask({ id: "t1", enabled: false })]);
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useScheduler());
    await act(async () => { await result.current.fetchTasks(); });
    expect(result.current.tasks[0].enabled).toBe(false);

    await act(async () => { await result.current.enableTask("t1"); });
    expect(mockInvoke).toHaveBeenCalledWith("sched_enable_task", { taskId: "t1" });
    expect(result.current.tasks[0].enabled).toBe(true);
  });

  it("disableTask sets task enabled to false optimistically", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "sched_list_tasks") return Promise.resolve([makeTask({ id: "t1", enabled: true })]);
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useScheduler());
    await act(async () => { await result.current.fetchTasks(); });
    expect(result.current.tasks[0].enabled).toBe(true);

    await act(async () => { await result.current.disableTask("t1"); });
    expect(mockInvoke).toHaveBeenCalledWith("sched_disable_task", { taskId: "t1" });
    expect(result.current.tasks[0].enabled).toBe(false);
  });

  it("enableTask sets error on failure", async () => {
    mockInvoke.mockRejectedValueOnce("Permission denied");

    const { result } = renderHook(() => useScheduler());
    await act(async () => { await result.current.enableTask("t1"); });

    expect(result.current.error).toBe("Permission denied");
  });

  // --- executeNow ---

  it("executeNow invokes backend and refreshes tasks", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "sched_list_tasks") return Promise.resolve([makeTask()]);
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useScheduler());
    await act(async () => { await result.current.executeNow("t1"); });

    expect(mockInvoke).toHaveBeenCalledWith("sched_execute_now", { taskId: "t1" });
    expect(mockInvoke).toHaveBeenCalledWith("sched_list_tasks");
  });

  // --- cancelTask ---

  it("cancelTask invokes backend and refreshes tasks", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "sched_list_tasks") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useScheduler());
    await act(async () => { await result.current.cancelTask("t1"); });

    expect(mockInvoke).toHaveBeenCalledWith("sched_cancel_task", { taskId: "t1" });
    expect(mockInvoke).toHaveBeenCalledWith("sched_list_tasks");
  });

  // --- fetchHistory ---

  it("fetchHistory with taskId passes taskId parameter", async () => {
    const entries = [{ id: "h1", taskId: "t1", taskName: "Task A", status: "completed", startedAt: "2026-03-30T00:00:00Z", completedAt: "2026-03-30T00:01:00Z", durationMs: 60000, output: "ok", errorMessage: null, retryAttempt: 0 }];
    mockInvoke.mockResolvedValueOnce(entries as never);

    const { result } = renderHook(() => useScheduler());
    let list: unknown[] = [];
    await act(async () => { list = await result.current.fetchHistory("t1"); });

    expect(mockInvoke).toHaveBeenCalledWith("sched_get_history", { taskId: "t1" });
    expect(list).toHaveLength(1);
    expect(result.current.history[0].status).toBe("completed");
  });

  it("fetchHistory without taskId passes null", async () => {
    mockInvoke.mockResolvedValueOnce([] as never);

    const { result } = renderHook(() => useScheduler());
    await act(async () => { await result.current.fetchHistory(); });

    expect(mockInvoke).toHaveBeenCalledWith("sched_get_history", { taskId: null });
  });

  // --- fetchUpcoming ---

  it("fetchUpcoming uses default limit of 20", async () => {
    const upcoming = [{ taskId: "t1", taskName: "Task A", nextRun: "2026-03-30T01:00:00Z" }];
    mockInvoke.mockResolvedValueOnce(upcoming as never);

    const { result } = renderHook(() => useScheduler());
    await act(async () => { await result.current.fetchUpcoming(); });

    expect(mockInvoke).toHaveBeenCalledWith("sched_get_upcoming", { limit: 20 });
    expect(result.current.upcoming).toHaveLength(1);
  });

  it("fetchUpcoming with custom limit", async () => {
    mockInvoke.mockResolvedValueOnce([] as never);

    const { result } = renderHook(() => useScheduler());
    await act(async () => { await result.current.fetchUpcoming(5); });

    expect(mockInvoke).toHaveBeenCalledWith("sched_get_upcoming", { limit: 5 });
  });

  // --- validateCron ---

  it("validateCron returns validation result", async () => {
    const validation = { valid: true, description: "Every 5 minutes", nextOccurrences: ["2026-03-30T00:05:00Z"], errorMessage: null };
    mockInvoke.mockResolvedValueOnce(validation as never);

    const { result } = renderHook(() => useScheduler());
    let res: unknown = null;
    await act(async () => { res = await result.current.validateCron("*/5 * * * *"); });

    expect(mockInvoke).toHaveBeenCalledWith("sched_validate_cron", { expression: "*/5 * * * *" });
    expect(res).toEqual(validation);
  });

  it("validateCron returns null on error", async () => {
    mockInvoke.mockRejectedValueOnce("Invalid expression");

    const { result } = renderHook(() => useScheduler());
    let res: unknown = "not-null";
    await act(async () => { res = await result.current.validateCron("bad cron"); });

    expect(res).toBeNull();
    expect(result.current.error).toBe("Invalid expression");
  });

  // --- getNextOccurrences ---

  it("getNextOccurrences returns dates with default count", async () => {
    const dates = ["2026-03-30T00:05:00Z", "2026-03-30T00:10:00Z"];
    mockInvoke.mockResolvedValueOnce(dates as never);

    const { result } = renderHook(() => useScheduler());
    let res: string[] = [];
    await act(async () => { res = await result.current.getNextOccurrences("*/5 * * * *"); });

    expect(mockInvoke).toHaveBeenCalledWith("sched_get_next_occurrences", { expression: "*/5 * * * *", count: 5 });
    expect(res).toEqual(dates);
  });

  it("getNextOccurrences passes custom count", async () => {
    mockInvoke.mockResolvedValueOnce([] as never);

    const { result } = renderHook(() => useScheduler());
    await act(async () => { await result.current.getNextOccurrences("0 * * * *", 10); });

    expect(mockInvoke).toHaveBeenCalledWith("sched_get_next_occurrences", { expression: "0 * * * *", count: 10 });
  });

  // --- pauseAll / resumeAll ---

  it("pauseAll invokes backend and refreshes tasks", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "sched_list_tasks") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useScheduler());
    await act(async () => { await result.current.pauseAll(); });

    expect(mockInvoke).toHaveBeenCalledWith("sched_pause_all");
    expect(mockInvoke).toHaveBeenCalledWith("sched_list_tasks");
  });

  it("resumeAll invokes backend and refreshes tasks", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "sched_list_tasks") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useScheduler());
    await act(async () => { await result.current.resumeAll(); });

    expect(mockInvoke).toHaveBeenCalledWith("sched_resume_all");
    expect(mockInvoke).toHaveBeenCalledWith("sched_list_tasks");
  });

  it("pauseAll sets error on failure", async () => {
    mockInvoke.mockRejectedValueOnce("Cannot pause");

    const { result } = renderHook(() => useScheduler());
    await act(async () => { await result.current.pauseAll(); });

    expect(result.current.error).toBe("Cannot pause");
  });

  // --- fetchStats ---

  it("fetchStats sets stats state", async () => {
    const stats = { totalTasks: 10, activeTasks: 7, totalRuns: 100, failedRuns: 3, avgDurationMs: 5000 };
    mockInvoke.mockResolvedValueOnce(stats as never);

    const { result } = renderHook(() => useScheduler());
    let res: unknown = null;
    await act(async () => { res = await result.current.fetchStats(); });

    expect(mockInvoke).toHaveBeenCalledWith("sched_get_stats");
    expect(result.current.stats).toEqual(stats);
    expect(res).toEqual(stats);
  });

  it("fetchStats returns null on error", async () => {
    mockInvoke.mockRejectedValueOnce("Stats unavailable");

    const { result } = renderHook(() => useScheduler());
    let res: unknown = "not-null";
    await act(async () => { res = await result.current.fetchStats(); });

    expect(res).toBeNull();
    expect(result.current.error).toBe("Stats unavailable");
  });

  // --- loadConfig ---

  it("loadConfig sets config state", async () => {
    const cfg = { maxConcurrent: 5, retryDefault: 3, timeoutDefault: 60000, logLevel: "info" };
    mockInvoke.mockResolvedValueOnce(cfg as never);

    const { result } = renderHook(() => useScheduler());
    await act(async () => { await result.current.loadConfig(); });

    expect(mockInvoke).toHaveBeenCalledWith("sched_get_config");
    expect(result.current.config).toEqual(cfg);
  });

  it("loadConfig sets error on failure", async () => {
    mockInvoke.mockRejectedValueOnce("Config read error");

    const { result } = renderHook(() => useScheduler());
    await act(async () => { await result.current.loadConfig(); });

    expect(result.current.error).toBe("Config read error");
  });

  // --- updateConfig ---

  it("updateConfig merges with existing config and persists", async () => {
    const initial = { enabled: true, maxConcurrentTasks: 5, defaultTimeoutMs: 60000, historyRetentionDays: 30, missedTaskPolicy: "skip" as const, notifyOnFailure: true, notifyOnSuccess: false };
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "sched_get_config") return Promise.resolve(initial);
      return Promise.resolve(undefined);
    });

    const { result } = renderHook(() => useScheduler());
    await act(async () => { await result.current.loadConfig(); });
    expect(result.current.config).toEqual(initial);

    await act(async () => { await result.current.updateConfig({ maxConcurrentTasks: 10 }); });

    expect(mockInvoke).toHaveBeenCalledWith("sched_update_config", {
      config: { ...initial, maxConcurrentTasks: 10 },
    });
    expect(result.current.config).toEqual({ ...initial, maxConcurrentTasks: 10 });
  });

  it("updateConfig sets error on failure", async () => {
    mockInvoke.mockRejectedValueOnce("Write error");

    const { result } = renderHook(() => useScheduler());
    await act(async () => { await result.current.updateConfig({ maxConcurrentTasks: 10 }); });

    expect(result.current.error).toBe("Write error");
  });
});
