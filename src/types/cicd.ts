// ── src/types/cicd.ts ───────────────────────────────────────────────
// TypeScript mirrors for sorng-cicd Tauri commands.

export type CicdProvider = 'drone' | 'jenkins' | 'git_hub_actions';

export interface CicdConnectionConfig {
  provider: CicdProvider;
  baseUrl: string;
  apiToken?: string | null;
  username?: string | null;
  password?: string | null;
  tlsSkipVerify?: boolean | null;
  timeoutSecs?: number | null;
  org?: string | null;
  repo?: string | null;
}

export interface CicdConnectionSummary {
  provider: CicdProvider;
  baseUrl: string;
  version?: string | null;
  user?: string | null;
}

export type PipelineStatus = 'active' | 'inactive' | 'disabled' | 'error' | 'unknown';
export type BuildStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'failure'
  | 'cancelled'
  | 'skipped'
  | 'unknown';

export interface CicdBuild {
  id: string;
  pipelineId: string;
  number: number;
  status: BuildStatus;
  branch?: string | null;
  commit?: string | null;
  commitMessage?: string | null;
  author?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationMs?: number | null;
  url?: string | null;
  [k: string]: unknown;
}

export interface CicdPipeline {
  id: string;
  name: string;
  provider: CicdProvider;
  repo?: string | null;
  defaultBranch?: string | null;
  lastBuild?: CicdBuild | null;
  status: PipelineStatus;
  url?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface CicdArtifact {
  id: string;
  name: string;
  size?: number | null;
  url?: string | null;
  createdAt?: string | null;
  [k: string]: unknown;
}

export interface CicdSecret {
  name: string;
  visibility?: string | null;
  updatedAt?: string | null;
  [k: string]: unknown;
}

export interface CicdBuildLogs {
  buildId: string;
  lines: string[];
  truncated?: boolean;
}

// Drone-specific
export interface DroneRepo {
  id?: number | string;
  owner?: string;
  name: string;
  slug?: string;
  active?: boolean;
  [k: string]: unknown;
}

export interface DroneCronJob {
  id?: number | string;
  name: string;
  expr: string;
  branch?: string;
  [k: string]: unknown;
}

// Jenkins-specific
export interface JenkinsJob {
  name: string;
  url?: string;
  color?: string;
  [k: string]: unknown;
}

export interface JenkinsNode {
  name: string;
  offline?: boolean;
  [k: string]: unknown;
}

export interface JenkinsPlugin {
  name: string;
  version?: string;
  enabled?: boolean;
  [k: string]: unknown;
}

export interface JenkinsSystemInfo {
  version?: string;
  url?: string;
  [k: string]: unknown;
}

// GitHub Actions-specific
export interface GhaWorkflow {
  id: number;
  name: string;
  path?: string;
  state?: string;
  [k: string]: unknown;
}

export interface GhaWorkflowRun {
  id: number;
  workflowId: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  [k: string]: unknown;
}

export interface GhaJob {
  id: number;
  runId: number;
  name: string;
  status?: string;
  conclusion?: string | null;
  [k: string]: unknown;
}

export interface GhaRunner {
  id: number;
  name: string;
  status?: string;
  busy?: boolean;
  [k: string]: unknown;
}

export interface CicdDashboard {
  provider: CicdProvider;
  pipelineCount: number;
  runningBuilds: number;
  succeededLast24h: number;
  failedLast24h: number;
  [k: string]: unknown;
}
