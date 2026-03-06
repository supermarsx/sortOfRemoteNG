/**
 * TypeScript types for the native MCP (Model Context Protocol) server.
 * Mirrors the Rust types in src-tauri/crates/sorng-mcp/src/types.rs.
 */

// ── Configuration ───────────────────────────────────────────────────

export interface McpServerConfig {
  enabled: boolean;
  port: number;
  host: string;
  require_auth: boolean;
  api_key: string;
  allow_remote: boolean;
  max_sessions: number;
  session_timeout_secs: number;
  cors_enabled: boolean;
  cors_origins: string[];
  rate_limit_per_minute: number;
  logging_enabled: boolean;
  log_level: McpLogLevel;
  enabled_tools: string[];
  enabled_resources: string[];
  enabled_prompts: string[];
  expose_sensitive_data: boolean;
  server_instructions: string;
  sse_enabled: boolean;
  auto_start: boolean;
}

export const DEFAULT_MCP_CONFIG: McpServerConfig = {
  enabled: false,
  port: 3100,
  host: "127.0.0.1",
  require_auth: true,
  api_key: "",
  allow_remote: false,
  max_sessions: 10,
  session_timeout_secs: 3600,
  cors_enabled: true,
  cors_origins: [],
  rate_limit_per_minute: 120,
  logging_enabled: true,
  log_level: "info",
  enabled_tools: [],
  enabled_resources: [],
  enabled_prompts: [],
  expose_sensitive_data: false,
  server_instructions:
    "SortOfRemote NG — remote connection management application. Use the available tools to manage connections, execute SSH commands, transfer files, query databases, and perform network operations.",
  sse_enabled: true,
  auto_start: false,
};

// ── Status ──────────────────────────────────────────────────────────

export interface McpServerStatus {
  running: boolean;
  listen_address: string | null;
  port: number;
  active_sessions: number;
  total_requests: number;
  total_tool_calls: number;
  total_resource_reads: number;
  started_at: string | null;
  uptime_secs: number;
  last_error: string | null;
  version: string;
  protocol_version: string;
}

// ── Sessions ────────────────────────────────────────────────────────

export interface McpSession {
  id: string;
  client_info: ImplementationInfo | null;
  protocol_version: string;
  client_capabilities: ClientCapabilities | null;
  created_at: string;
  last_active: string;
  request_count: number;
  log_level: McpLogLevel;
  subscriptions: string[];
  initialized: boolean;
}

export interface ImplementationInfo {
  name: string;
  version: string;
}

export interface ClientCapabilities {
  roots?: { listChanged?: boolean };
  sampling?: Record<string, unknown>;
  experimental?: Record<string, unknown>;
}

// ── Tools ───────────────────────────────────────────────────────────

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
}

export interface ToolAnnotations {
  title?: string;
  destructive?: boolean;
  read_only?: boolean;
  requires_confirmation?: boolean;
  open_world?: boolean;
}

// ── Resources ───────────────────────────────────────────────────────

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  annotations?: Record<string, unknown>;
}

export interface McpResourceTemplate {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
  annotations?: Record<string, unknown>;
}

// ── Prompts ─────────────────────────────────────────────────────────

export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: PromptArgument[];
}

export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

// ── Logging ─────────────────────────────────────────────────────────

export type McpLogLevel =
  | "debug"
  | "info"
  | "notice"
  | "warning"
  | "error"
  | "critical"
  | "alert"
  | "emergency";

export const MCP_LOG_LEVELS: readonly McpLogLevel[] = [
  "debug",
  "info",
  "notice",
  "warning",
  "error",
  "critical",
  "alert",
  "emergency",
];

export interface McpLogEntry {
  id: string;
  level: McpLogLevel;
  logger: string;
  message: string;
  timestamp: string;
  data: unknown | null;
}

// ── Metrics ─────────────────────────────────────────────────────────

export interface McpMetrics {
  total_requests: number;
  total_tool_calls: number;
  total_resource_reads: number;
  active_sessions: number;
  uptime_secs: number;
  errors: number;
  avg_response_ms: number;
  peak_sessions: number;
}

// ── Events ──────────────────────────────────────────────────────────

export type McpEventType =
  | "ServerStarted"
  | "ServerStopped"
  | "SessionStarted"
  | "SessionEnded"
  | "ToolCalled"
  | "ResourceRead"
  | "PromptUsed"
  | "AuthFailed"
  | "ConfigChanged"
  | "Error";

export interface McpEvent {
  id: string;
  event_type: McpEventType;
  timestamp: string;
  details: Record<string, unknown>;
}

// ── Tool Call Log ───────────────────────────────────────────────────

export interface McpToolCallLog {
  id: string;
  tool_name: string;
  params: Record<string, unknown>;
  result?: Record<string, unknown>;
  success: boolean;
  duration_ms: number;
  timestamp: string;
  session_id?: string;
}

// ── Panel Tab keys ──────────────────────────────────────────────────

export type McpPanelTab =
  | "overview"
  | "config"
  | "tools"
  | "resources"
  | "prompts"
  | "sessions"
  | "logs"
  | "events";
