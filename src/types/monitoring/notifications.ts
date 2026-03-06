// Notification Rules Engine types

export type NotifChannelKind = 'webhook' | 'slack' | 'discord' | 'teams' | 'telegram' | 'email' | 'desktop' | 'in_app';
export type NotifTrigger = 'connection_down' | 'connection_up' | 'latency_high' | 'cert_expiring' | 'cred_expired' | 'backup_failed' | 'script_error' | 'session_idle' | 'health_check_failed' | 'custom';
export type NotifSeverity = 'info' | 'warning' | 'critical';

export interface NotificationRule {
  id: string;
  name: string;
  trigger: NotifTrigger;
  severity: NotifSeverity;
  channelKind: NotifChannelKind;
  channelConfig: Record<string, unknown>;
  conditions: NotifCondition[];
  conditionLogic: 'and' | 'or';
  enabled: boolean;
  throttleMs: number;
  templateId: string | null;
  escalationDelayMs: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotifCondition {
  field: string;
  operator: string;
  value: unknown;
}

export interface NotificationTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  variables: string[];
  format: 'text' | 'html' | 'markdown';
}

export interface NotificationHistoryEntry {
  id: string;
  ruleId: string;
  ruleName: string;
  trigger: NotifTrigger;
  severity: NotifSeverity;
  channelKind: NotifChannelKind;
  message: string;
  sentAt: string;
  delivered: boolean;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
}

export interface NotificationStats {
  totalRules: number;
  enabledRules: number;
  totalSent: number;
  deliveredCount: number;
  failedCount: number;
  byChannel: Record<NotifChannelKind, number>;
  byTrigger: Record<NotifTrigger, number>;
  lastSentAt: string | null;
}

export interface NotificationConfig {
  enabled: boolean;
  globalThrottleMs: number;
  maxHistoryEntries: number;
  retryCount: number;
  retryDelayMs: number;
  batchDelivery: boolean;
  batchIntervalMs: number;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
}
