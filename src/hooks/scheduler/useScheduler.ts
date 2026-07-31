import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  ScheduledTask,
  SchedulerConfig,
  SchedulerStats,
  TaskExecutionRecord,
  UpcomingTask,
} from "../../types/scheduler/scheduler";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useScheduler() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [history, setHistory] = useState<TaskExecutionRecord[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingTask[]>([]);
  const [stats, setStats] = useState<SchedulerStats | null>(null);
  const [config, setConfig] = useState<SchedulerConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const value = await invoke<ScheduledTask[]>("sched_list_tasks");
      setTasks(value);
      return value;
    } catch (caught) {
      setError(errorText(caught));
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const addTask = useCallback(
    async (task: ScheduledTask) => {
      try {
        const id = await invoke<string>("sched_add_task", { task });
        await fetchTasks();
        return id;
      } catch (caught) {
        setError(errorText(caught));
        return null;
      }
    },
    [fetchTasks],
  );

  const updateTask = useCallback(
    async (task: ScheduledTask) => {
      try {
        await invoke("sched_update_task", { task });
        await fetchTasks();
        return true;
      } catch (caught) {
        setError(errorText(caught));
        return false;
      }
    },
    [fetchTasks],
  );

  const removeTask = useCallback(async (taskId: string) => {
    try {
      await invoke("sched_remove_task", { taskId });
      setTasks((current) => current.filter((task) => task.id !== taskId));
      return true;
    } catch (caught) {
      setError(errorText(caught));
      return false;
    }
  }, []);

  const setTaskEnabled = useCallback(
    async (taskId: string, enabled: boolean) => {
      try {
        await invoke(enabled ? "sched_enable_task" : "sched_disable_task", {
          taskId,
        });
        setTasks((current) =>
          current.map((task) =>
            task.id === taskId ? { ...task, enabled } : task,
          ),
        );
        return true;
      } catch (caught) {
        setError(errorText(caught));
        return false;
      }
    },
    [],
  );

  const fetchHistory = useCallback(async (taskId?: string, limit = 100) => {
    try {
      const value = await invoke<TaskExecutionRecord[]>("sched_get_history", {
        taskId: taskId ?? null,
        limit,
      });
      setHistory(value);
      return value;
    } catch (caught) {
      setError(errorText(caught));
      return [];
    }
  }, []);

  const executeNow = useCallback(
    async (taskId: string) => {
      try {
        const record = await invoke<TaskExecutionRecord>("sched_execute_now", {
          taskId,
        });
        await Promise.all([fetchTasks(), fetchHistory()]);
        return record;
      } catch (caught) {
        setError(errorText(caught));
        return null;
      }
    },
    [fetchHistory, fetchTasks],
  );

  const cancelTask = useCallback(async (taskId: string) => {
    try {
      await invoke("sched_cancel_task", { taskId });
      return true;
    } catch (caught) {
      setError(errorText(caught));
      return false;
    }
  }, []);

  const fetchUpcoming = useCallback(async (count = 20) => {
    try {
      const value = await invoke<Array<[ScheduledTask, string]>>(
        "sched_get_upcoming",
        { count },
      );
      const mapped = value.map(([task, next_run_at]) => ({
        task,
        next_run_at,
      }));
      setUpcoming(mapped);
      return mapped;
    } catch (caught) {
      setError(errorText(caught));
      return [];
    }
  }, []);

  const validateCron = useCallback(async (expression: string) => {
    try {
      await invoke<void>("sched_validate_cron", { expression });
      return null;
    } catch (caught) {
      return errorText(caught);
    }
  }, []);

  const getNextOccurrences = useCallback(
    async (expression: string, count = 5) => {
      try {
        return await invoke<string[]>("sched_get_next_occurrences", {
          expression,
          count,
        });
      } catch (caught) {
        setError(errorText(caught));
        return [];
      }
    },
    [],
  );

  const pauseAll = useCallback(async () => {
    try {
      await invoke("sched_pause_all");
      return true;
    } catch (caught) {
      setError(errorText(caught));
      return false;
    }
  }, []);

  const resumeAll = useCallback(async () => {
    try {
      await invoke("sched_resume_all");
      return true;
    } catch (caught) {
      setError(errorText(caught));
      return false;
    }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const value = await invoke<SchedulerStats>("sched_get_stats");
      setStats(value);
      return value;
    } catch (caught) {
      setError(errorText(caught));
      return null;
    }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const value = await invoke<SchedulerConfig>("sched_get_config");
      setConfig(value);
      return value;
    } catch (caught) {
      setError(errorText(caught));
      return null;
    }
  }, []);

  const updateConfig = useCallback(async (next: SchedulerConfig) => {
    try {
      await invoke("sched_update_config", { config: next });
      setConfig(next);
      return true;
    } catch (caught) {
      setError(errorText(caught));
      return false;
    }
  }, []);

  return {
    tasks,
    history,
    upcoming,
    stats,
    config,
    loading,
    error,
    clearError,
    fetchTasks,
    addTask,
    updateTask,
    removeTask,
    setTaskEnabled,
    executeNow,
    cancelTask,
    fetchHistory,
    fetchUpcoming,
    validateCron,
    getNextOccurrences,
    pauseAll,
    resumeAll,
    fetchStats,
    loadConfig,
    updateConfig,
  };
}
