/**
 * React hook wrapping the 52 `compose_*` Tauri commands exposed by the
 * `sorng-docker-compose` backend crate (see t3-e50 wiring).
 *
 * The backend is registered behind the `ops` cargo feature; calls on a
 * non-ops build will fail with an unknown-command error at runtime.
 *
 * Argument names use camelCase to match Tauri's automatic kebab/snake →
 * camel conversion for invoke payload keys.
 */

import { invoke } from "@tauri-apps/api/core";
import { useMemo } from "react";
import type {
  ComposeFile,
  ComposeUpConfig,
  ComposeDownConfig,
  ComposePsConfig,
  ComposeLogsConfig,
  ComposeBuildConfig,
  ComposePullConfig,
  ComposePushConfig,
  ComposeRunConfig,
  ComposeExecConfig,
  ComposeCreateConfig,
  ComposeServiceActionConfig,
  ComposeRmConfig,
  ComposeCpConfig,
  ComposeTopConfig,
  ComposePortConfig,
  ComposeImagesConfig,
  ComposeEventsConfig,
  ComposeConvertConfig,
  ComposeWatchConfig,
  ComposeScaleConfig,
  ComposeVersionInfo,
  ComposeProject,
  ComposePsItem,
  ComposeProfile,
  ComposeTemplate,
  ComposeValidation,
  DependencyGraph,
  EnvFile,
} from "../../types/dockerCompose";

// ────────────────────────────────────────────────────────────────────
//  Command bindings — one function per `#[tauri::command]`
// ────────────────────────────────────────────────────────────────────

export const dockerComposeApi = {
  // ── Init / Detection (3) ───────────────────────────────────────
  init: (): Promise<ComposeVersionInfo> => invoke("compose_init"),
  isAvailable: (): Promise<boolean> => invoke("compose_is_available"),
  version: (): Promise<ComposeVersionInfo> => invoke("compose_version"),

  // ── Project lifecycle (26) ─────────────────────────────────────
  listProjects: (all?: boolean, filter?: string): Promise<ComposeProject[]> =>
    invoke("compose_list_projects", { all, filter }),
  up: (config: ComposeUpConfig): Promise<string> =>
    invoke("compose_up", { config }),
  down: (config: ComposeDownConfig): Promise<string> =>
    invoke("compose_down", { config }),
  ps: (config: ComposePsConfig): Promise<ComposePsItem[]> =>
    invoke("compose_ps", { config }),
  logs: (config: ComposeLogsConfig): Promise<string> =>
    invoke("compose_logs", { config }),
  build: (config: ComposeBuildConfig): Promise<string> =>
    invoke("compose_build", { config }),
  pull: (config: ComposePullConfig): Promise<string> =>
    invoke("compose_pull", { config }),
  push: (config: ComposePushConfig): Promise<string> =>
    invoke("compose_push", { config }),
  run: (config: ComposeRunConfig): Promise<string> =>
    invoke("compose_run", { config }),
  exec: (config: ComposeExecConfig): Promise<string> =>
    invoke("compose_exec", { config }),
  create: (config: ComposeCreateConfig): Promise<string> =>
    invoke("compose_create", { config }),
  start: (config: ComposeServiceActionConfig): Promise<string> =>
    invoke("compose_start", { config }),
  stop: (config: ComposeServiceActionConfig): Promise<string> =>
    invoke("compose_stop", { config }),
  restart: (config: ComposeServiceActionConfig): Promise<string> =>
    invoke("compose_restart", { config }),
  pause: (config: ComposeServiceActionConfig): Promise<string> =>
    invoke("compose_pause", { config }),
  unpause: (config: ComposeServiceActionConfig): Promise<string> =>
    invoke("compose_unpause", { config }),
  kill: (config: ComposeServiceActionConfig): Promise<string> =>
    invoke("compose_kill", { config }),
  rm: (config: ComposeRmConfig): Promise<string> =>
    invoke("compose_rm", { config }),
  cp: (config: ComposeCpConfig): Promise<string> =>
    invoke("compose_cp", { config }),
  top: (config: ComposeTopConfig): Promise<string> =>
    invoke("compose_top", { config }),
  port: (config: ComposePortConfig): Promise<string> =>
    invoke("compose_port", { config }),
  images: (config: ComposeImagesConfig): Promise<string> =>
    invoke("compose_images", { config }),
  events: (config: ComposeEventsConfig): Promise<string> =>
    invoke("compose_events", { config }),
  config: (config: ComposeConvertConfig): Promise<string> =>
    invoke("compose_config", { config }),
  watch: (config: ComposeWatchConfig): Promise<string> =>
    invoke("compose_watch", { config }),
  scale: (config: ComposeScaleConfig): Promise<string> =>
    invoke("compose_scale", { config }),

  // ── Parser / File operations (10) ──────────────────────────────
  parseFile: (path: string): Promise<ComposeFile> =>
    invoke("compose_parse_file", { path }),
  parseYaml: (content: string): Promise<ComposeFile> =>
    invoke("compose_parse_yaml", { content }),
  discoverFiles: (dir: string): Promise<string[]> =>
    invoke("compose_discover_files", { dir }),
  mergeFiles: (paths: string[]): Promise<ComposeFile> =>
    invoke("compose_merge_files", { paths }),
  validate: (compose: ComposeFile): Promise<ComposeValidation> =>
    invoke("compose_validate", { compose }),
  interpolate: (
    content: string,
    vars: Record<string, string>,
  ): Promise<string> => invoke("compose_interpolate", { content, vars }),
  parseEnvFile: (path: string): Promise<EnvFile> =>
    invoke("compose_parse_env_file", { path }),
  toYaml: (compose: ComposeFile): Promise<string> =>
    invoke("compose_to_yaml", { compose }),
  toJson: (compose: ComposeFile): Promise<string> =>
    invoke("compose_to_json", { compose }),
  writeFile: (compose: ComposeFile, path: string): Promise<void> =>
    invoke("compose_write_file", { compose, path }),

  // ── Dependency graph (4) ───────────────────────────────────────
  dependencyGraph: (compose: ComposeFile): Promise<DependencyGraph> =>
    invoke("compose_dependency_graph", { compose }),
  startupOrder: (
    compose: ComposeFile,
    services: string[],
  ): Promise<string[]> =>
    invoke("compose_startup_order", { compose, services }),
  shutdownOrder: (compose: ComposeFile): Promise<string[]> =>
    invoke("compose_shutdown_order", { compose }),
  dependents: (compose: ComposeFile, service: string): Promise<string[]> =>
    invoke("compose_dependents", { compose, service }),

  // ── Profiles (4) ───────────────────────────────────────────────
  listProfiles: (compose: ComposeFile): Promise<ComposeProfile[]> =>
    invoke("compose_list_profiles", { compose }),
  profileNames: (compose: ComposeFile): Promise<string[]> =>
    invoke("compose_profile_names", { compose }),
  activeServices: (
    compose: ComposeFile,
    profiles: string[],
  ): Promise<string[]> =>
    invoke("compose_active_services", { compose, profiles }),
  validateProfileDeps: (
    compose: ComposeFile,
    profiles: string[],
  ): Promise<string[]> =>
    invoke("compose_validate_profile_deps", { compose, profiles }),

  // ── Templates (5) ──────────────────────────────────────────────
  listTemplates: (): Promise<ComposeTemplate[]> =>
    invoke("compose_list_templates"),
  getTemplate: (name: string): Promise<ComposeTemplate> =>
    invoke("compose_get_template", { name }),
  templateCategories: (): Promise<string[]> =>
    invoke("compose_template_categories"),
  templatesByCategory: (category: string): Promise<ComposeTemplate[]> =>
    invoke("compose_templates_by_category", { category }),
  scaffold: (templateName: string, dir: string): Promise<string> =>
    invoke("compose_scaffold", { templateName, dir }),
};

export type DockerComposeApi = typeof dockerComposeApi;

export function useDockerCompose(): DockerComposeApi {
  return useMemo(() => dockerComposeApi, []);
}

export default useDockerCompose;
