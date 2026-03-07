// Scheduled Tasks / Cron-like Automation types

export type TaskKind = 'connect' | 'disconnect' | 'script' | 'health_check' | 'backup' | 'wake_on_lan' | 'notification' | 'custom' | 'connection_test';
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped';
export type ScheduleType = 'cron' | 'interval' | 'once' | 'daily' | 'weekly' | 'monthly';

export interface ScheduledTask {
  id: string;
  name: string;
  description: string;
  kind: TaskKind;
  scheduleType: ScheduleType;
  cronExpression: string | null;
  intervalMs: number | null;
  scheduledAt: string | null;
  enabled: boolean;
  connectionIds: string[];
  payload: Record<string, unknown>;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  lastRun: string | null;
  nextRun: string | null;
  runCount: number;
  failCount: number;
  maxRetries: number;
  retryDelayMs: number;
  timeoutMs: number;
}

export interface TaskHistoryEntry {
  id: string;
  taskId: string;
  taskName: string;
  status: TaskStatus;
  startedAt: string;
  completedAt: string | null;
  durationMs: number;
  output: string | null;
  errorMessage: string | null;
  retryAttempt: number;
}

export interface UpcomingTask {
  taskId: string;
  taskName: string;
  kind: TaskKind;
  nextRunAt: string;
  connectionIds: string[];
}

export interface CronValidation {
  valid: boolean;
  description: string;
  nextOccurrences: string[];
  errorMessage: string | null;
}

export interface SchedulerStats {
  totalTasks: number;
  enabledTasks: number;
  runningTasks: number;
  completedToday: number;
  failedToday: number;
  upcomingCount: number;
  avgDurationMs: number;
}

export interface SchedulerConfig {
  enabled: boolean;
  maxConcurrentTasks: number;
  defaultTimeoutMs: number;
  historyRetentionDays: number;
  missedTaskPolicy: 'run_immediately' | 'skip' | 'queue';
  notifyOnFailure: boolean;
  notifyOnSuccess: boolean;
}
