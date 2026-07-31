// Scheduler wire types. Field names intentionally match Rust serde exactly.

export type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
export type TaskPriority = "Low" | "Normal" | "High" | "Critical";
export type ExecutionStatus =
  | "Running"
  | "Completed"
  | "Failed"
  | "TimedOut"
  | "Skipped"
  | "Cancelled";

export type TaskSchedule =
  | { type: "once"; at: string }
  | { type: "cron"; expression: string }
  | { type: "interval"; every_seconds: number }
  | { type: "daily"; time: string; timezone: string | null }
  | { type: "weekly"; day: Weekday; time: string }
  | { type: "monthly"; day: number; time: string }
  | { type: "on_event"; event_type: string };

export type ReportType =
  | "ConnectionHealth"
  | "CredentialAudit"
  | "ActivitySummary"
  | "PerformanceReport";

export interface PipelineStep {
  action: TaskAction;
  continue_on_error: boolean;
  delay_ms: number | null;
}

export type TaskAction =
  | { type: "connect_connection"; connection_id: string }
  | { type: "disconnect_connection"; connection_id: string }
  | {
      type: "execute_script";
      script_id: string;
      args: Record<string, string> | null;
    }
  | { type: "run_diagnostics"; connection_ids: string[] }
  | {
      type: "send_wake_on_lan";
      mac_address: string;
      port: number | null;
    }
  | { type: "backup_collection"; collection_id: string | null }
  | { type: "sync_cloud" }
  | { type: "run_health_check"; connection_ids: string[] }
  | {
      type: "http_request";
      url: string;
      method: string;
      headers: Record<string, string> | null;
      body: string | null;
    }
  | {
      type: "execute_command";
      command: string;
      connection_id: string | null;
    }
  | { type: "generate_report"; report_type: ReportType }
  | { type: "pipeline"; steps: PipelineStep[] }
  | { type: "notify"; channel: string; message: string };

export type TaskCondition =
  | { type: "connection_online"; connection_id: string }
  | { type: "connection_offline"; connection_id: string }
  | { type: "time_window"; start: string; end: string }
  | { type: "day_of_week"; days: Weekday[] }
  | { type: "custom"; expression: string };

export interface RetryPolicy {
  max_retries: number;
  retry_delay_ms: number;
  backoff_multiplier: number;
  max_delay_ms: number;
}

export interface ScheduledTask {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  schedule: TaskSchedule;
  action: TaskAction;
  conditions: TaskCondition[];
  retry_policy: RetryPolicy | null;
  timeout_ms: number | null;
  tags: string[];
  priority: TaskPriority;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  next_run_at: string | null;
  run_count: number;
  fail_count: number;
}

export interface TaskExecutionRecord {
  id: string;
  task_id: string;
  task_name: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  status: ExecutionStatus;
  result: unknown | null;
  error: string | null;
  retry_attempt: number;
}

export interface UpcomingTask {
  task: ScheduledTask;
  next_run_at: string;
}

export interface SchedulerStats {
  total_tasks: number;
  enabled_tasks: number;
  total_executions: number;
  successful: number;
  failed: number;
  avg_duration_ms: number;
  next_scheduled_at: string | null;
  tasks_by_priority: Record<string, number>;
}

export interface SchedulerConfig {
  enabled: boolean;
  max_concurrent_tasks: number;
  default_timeout_ms: number;
  history_retention_days: number;
  check_interval_seconds: number;
  catch_up_missed: boolean;
}
