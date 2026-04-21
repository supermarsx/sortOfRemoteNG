/**
 * TypeScript mirrors for the 52 `compose_*` Tauri commands exposed by
 * the `sorng-docker-compose` backend crate (see t3-e50 wiring).
 *
 * The full Compose Specification has ~77 nested types on the Rust side
 * (`ServiceDefinition`, `BuildConfig`, `DeployConfig`, healthchecks,
 * networks, volumes, secrets, configs, …). Mirroring the entire tree in
 * hand-written TypeScript is prohibitively brittle, so deeply-nested
 * shapes are typed as `Record<string, unknown>` and opaque leaves as
 * `unknown`. The primary DTO surfaces used by UI code — version info,
 * ps items, projects, profiles, templates, validation, dependency
 * graph, env files — are modelled concretely.
 */

// ── Opaque / pass-through shapes ─────────────────────────────────────

/** Fully parsed Compose file (root document — services, networks, etc.). */
export type ComposeFile = Record<string, unknown>;

/** Per-command config envelopes — fields are preserved verbatim. */
export type ComposeUpConfig = Record<string, unknown>;
export type ComposeDownConfig = Record<string, unknown>;
export type ComposePsConfig = Record<string, unknown>;
export type ComposeLogsConfig = Record<string, unknown>;
export type ComposeBuildConfig = Record<string, unknown>;
export type ComposePullConfig = Record<string, unknown>;
export type ComposePushConfig = Record<string, unknown>;
export type ComposeRunConfig = Record<string, unknown>;
export type ComposeExecConfig = Record<string, unknown>;
export type ComposeCreateConfig = Record<string, unknown>;
export type ComposeServiceActionConfig = Record<string, unknown>;
export type ComposeRmConfig = Record<string, unknown>;
export type ComposeCpConfig = Record<string, unknown>;
export type ComposeTopConfig = Record<string, unknown>;
export type ComposePortConfig = Record<string, unknown>;
export type ComposeImagesConfig = Record<string, unknown>;
export type ComposeEventsConfig = Record<string, unknown>;
export type ComposeConvertConfig = Record<string, unknown>;
export type ComposeWatchConfig = Record<string, unknown>;
export type ComposeScaleConfig = Record<string, unknown>;

// ── Concrete DTOs (serde rename_all = "camelCase") ───────────────────

export interface ComposeVersionInfo {
  version: string;
  isV2Plugin: boolean;
  rawOutput: string;
}

export interface ComposeProject {
  name: string;
  status: string;
  configFiles: string;
}

/** serde(rename_all = "PascalCase") — keys arrive in PascalCase. */
export interface ComposePsItem {
  ID: string;
  Name: string;
  Service: string;
  State: string;
  Health?: string | null;
  Status?: string | null;
  Ports?: string | null;
  Image?: string | null;
  Command?: string | null;
  CreatedAt?: string | null;
  ExitCode?: number | null;
  Publishers?: PortPublisher[] | null;
  Labels?: string | null;
}

export interface PortPublisher {
  URL?: string | null;
  TargetPort?: number | null;
  PublishedPort?: number | null;
  Protocol?: string | null;
}

export interface ComposeProfile {
  name: string;
  services: string[];
}

export interface ComposeTemplate {
  name: string;
  description: string;
  category: string;
  tags: string[];
  content: string;
}

export interface ValidationIssue {
  service?: string | null;
  field?: string | null;
  message: string;
  severity: string;
}

export interface ComposeValidation {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface DependencyEdge {
  from: string;
  to: string;
  condition?: string | null;
}

export interface DependencyGraph {
  services: string[];
  edges: DependencyEdge[];
  startupOrder: string[];
  hasCycle: boolean;
}

export interface EnvVar {
  key: string;
  value?: string | null;
  source?: string | null;
}

export interface EnvFile {
  path: string;
  variables: EnvVar[];
  errors: string[];
}
