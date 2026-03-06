// Smart Filters & Dynamic Groups types

export type FilterOperator =
  | 'equals' | 'not_equals'
  | 'contains' | 'not_contains'
  | 'starts_with' | 'ends_with'
  | 'greater_than' | 'less_than'
  | 'in' | 'not_in'
  | 'is_empty' | 'is_not_empty'
  | 'regex_match'
  | 'before' | 'after' | 'within_days';

export type FilterField =
  | 'protocol' | 'hostname' | 'name' | 'username'
  | 'port' | 'tags' | 'colorTag' | 'favorite'
  | 'lastConnected' | 'connectionCount' | 'createdAt' | 'updatedAt'
  | 'parentId' | 'description' | 'authType'
  | 'healthStatus' | 'latencyMs' | 'uptimePercent';

export type FilterLogic = 'and' | 'or';

export interface FilterCondition {
  field: FilterField;
  operator: FilterOperator;
  value: unknown;
}

export interface FilterRule {
  id: string;
  name: string;
  conditions: FilterCondition[];
  logic: FilterLogic;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SmartGroup {
  id: string;
  name: string;
  icon: string;
  color: string;
  filterId: string;
  autoRefresh: boolean;
  refreshIntervalMs: number;
  memberCount: number;
  lastEvaluated: string | null;
  pinned: boolean;
}

export interface FilterPreset {
  id: string;
  name: string;
  description: string;
  category: string;
  rule: Omit<FilterRule, 'id' | 'createdAt' | 'updatedAt'>;
}

export interface FilterEvaluationResult {
  filterId: string;
  matchingConnectionIds: string[];
  totalEvaluated: number;
  matchCount: number;
  evaluationTimeMs: number;
}

export interface FilterConfig {
  cacheEnabled: boolean;
  cacheTtlMs: number;
  maxSmartGroups: number;
  autoRefreshEnabled: boolean;
  defaultRefreshIntervalMs: number;
}

export interface FilterStats {
  totalFilters: number;
  totalSmartGroups: number;
  cacheHitRate: number;
  lastEvaluationTimeMs: number;
}
