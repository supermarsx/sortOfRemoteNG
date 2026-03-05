import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  ScheduledTask,
  TaskHistoryEntry,
  UpcomingTask,
  CronValidation,
  SchedulerStats,
  SchedulerConfig,
} from "../../types/scheduler";

export function useScheduler() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [history, setHistory] = useState<TaskHistoryEntry[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingTask[]>([]);
  const [stats, setStats] = useState<SchedulerStats | null>(null);
  const [config, setConfig] = useState<SchedulerConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const list = await invoke<ScheduledTask[]>("sched_list_tasks");
      setTasks(list);
      return list;
    } catch (e) { setError(String(e)); return []; }
    finally { setLoading(false); }
  }, []);

  const addTask = useCallback(async (task: Omit<ScheduledTask, 'id' | 'createdAt' | 'updatedAt' | 'lastRun' | 'nextRun' | 'runCount' | 'failCount'>) => {
    try {
      const id = await invoke<string>("sched_add_task", { task });
      await fetchTasks();
      return id;
    } catch (e) { setError(String(e)); return null; }
  }, [fetchTasks]);

  const removeTask = useCallback(async (taskId: string) => {
    try {
      await invoke("sched_remove_task", { taskId });
      setTasks(prev => prev.filter(t => t.id !== taskId));
    } catch (e) { setError(String(e)); }
  }, []);

  const updateTask = useCallback(async (taskId: string, updates: Partial<ScheduledTask>) => {
    try {
      await invoke("sched_update_task", { taskId, updates });
      await fetchTasks();
    } catch (e) { setError(String(e)); }
  }, [fetchTasks]);

  const enableTask = useCallback(async (taskId: string) => {
    try {
      await invoke("sched_enable_task", { taskId });
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, enabled: true } : t));
    } catch (e) { setError(String(e)); }
  }, []);

  const disableTask = useCallback(async (taskId: string) => {
    try {
      await invoke("sched_disable_task", { taskId });
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, enabled: false } : t));
    } catch (e) { setError(String(e)); }
  }, []);

  const executeNow = useCallback(async (taskId: string) => {
    try {
      await invoke("sched_execute_now", { taskId });
      await fetchTasks();
    } catch (e) { setError(String(e)); }
  }, [fetchTasks]);

  const cancelTask = useCallback(async (taskId: string) => {
    try {
      await invoke("sched_cancel_task", { taskId });
      await fetchTasks();
    } catch (e) { setError(String(e)); }
  }, [fetchTasks]);

  const fetchHistory = useCallback(async (taskId?: string) => {
    try {
      const list = await invoke<TaskHistoryEntry[]>("sched_get_history", { taskId: taskId ?? null });
      setHistory(list);
      return list;
    } catch (e) { setError(String(e)); return []; }
  }, []);

  const fetchUpcoming = useCallback(async (limit?: number) => {
    try {
      const list = await invoke<UpcomingTask[]>("sched_get_upcoming", { limit: limit ?? 20 });
      setUpcoming(list);
      return list;
    } catch (e) { setError(String(e)); return []; }
  }, []);

  const validateCron = useCallback(async (expression: string) => {
    try {
      return await invoke<CronValidation>("sched_validate_cron", { expression });
    } catch (e) { setError(String(e)); return null; }
  }, []);

  const getNextOccurrences = useCallback(async (expression: string, count?: number) => {
    try {
      return await invoke<string[]>("sched_get_next_occurrences", { expression, count: count ?? 5 });
    } catch (e) { setError(String(e)); return []; }
  }, []);

  const pauseAll = useCallback(async () => {
    try {
      await invoke("sched_pause_all");
      await fetchTasks();
    } catch (e) { setError(String(e)); }
  }, [fetchTasks]);

  const resumeAll = useCallback(async () => {
    try {
      await invoke("sched_resume_all");
      await fetchTasks();
    } catch (e) { setError(String(e)); }
  }, [fetchTasks]);

  const fetchStats = useCallback(async () => {
    try {
      const s = await invoke<SchedulerStats>("sched_get_stats");
      setStats(s);
      return s;
    } catch (e) { setError(String(e)); return null; }
  }, []);

  const loadConfig = useCallback(async () => {
    try {
      const c = await invoke<SchedulerConfig>("sched_get_config");
      setConfig(c);
    } catch (e) { setError(String(e)); }
  }, []);

  const updateConfig = useCallback(async (cfg: Partial<SchedulerConfig>) => {
    try {
      const merged = { ...config, ...cfg } as SchedulerConfig;
      await invoke("sched_update_config", { config: merged });
      setConfig(merged);
    } catch (e) { setError(String(e)); }
  }, [config]);

  return {
    tasks, history, upcoming, stats, config, loading, error,
    fetchTasks, addTask, removeTask, updateTask, enableTask, disableTask,
    executeNow, cancelTask, fetchHistory, fetchUpcoming,
    validateCron, getNextOccurrences, pauseAll, resumeAll,
    fetchStats, loadConfig, updateConfig,
  };
}
