// Connection Health Dashboard types

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown' | 'unreachable';

export interface ConnectionHealthEntry {
  connectionId: string;
  connectionName: string;
  protocol: string;
  hostname: string;
  status: HealthStatus;
  latencyMs: number | null;
  lastChecked: string;
  lastSeen: string | null;
  uptimePercent: number;
  errorMessage: string | null;
  checkCount: number;
  failCount: number;
}

export interface HealthSummary {
  total: number;
  healthy: number;
  degraded: number;
  unhealthy: number;
  unknown: number;
  unreachable: number;
  averageLatencyMs: number;
  overallUptimePercent: number;
}

export interface DashboardAlert {
  id: string;
  connectionId: string;
  connectionName: string;
  alertType: 'latency_high' | 'connection_down' | 'cert_expiring' | 'packet_loss' | 'status_change';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  timestamp: string;
  acknowledged: boolean;
  metadata: Record<string, unknown>;
}

export interface SparklineData {
  connectionId: string;
  points: SparklinePoint[];
  minMs: number;
  maxMs: number;
  avgMs: number;
}

export interface SparklinePoint {
  timestamp: string;
  latencyMs: number | null;
  healthy: boolean;
}

export interface QuickStats {
  totalConnections: number;
  activeSessionCount: number;
  protocolBreakdown: Record<string, number>;
  recentConnectionCount: number;
  averageLatencyMs: number;
  alertCount: number;
}

export interface HeatmapCell {
  connectionId: string;
  name: string;
  status: HealthStatus;
  latencyMs: number | null;
  group: string;
}

export interface DashboardWidget {
  id: string;
  widgetType: 'health_summary' | 'heatmap' | 'alerts' | 'sparklines' | 'quick_stats' | 'recent' | 'top_latency' | 'protocol_breakdown';
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config: Record<string, unknown>;
}

export interface DashboardLayout {
  widgets: DashboardWidget[];
  columns: number;
  rowHeight: number;
}

export interface DashboardConfig {
  enabled: boolean;
  refreshIntervalMs: number;
  healthCheckTimeoutMs: number;
  maxSparklinePoints: number;
  parallelChecks: number;
  showOnStartup: boolean;
}

export interface DashboardState {
  summary: HealthSummary;
  alerts: DashboardAlert[];
  recentConnections: Array<{ connectionId: string; connectionName: string; protocol: string; timestamp: string }>;
  monitoring: boolean;
}
