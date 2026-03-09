// ── sorng-docker-compose/src/service.rs ────────────────────────────────────────
//! Aggregate Docker Compose façade — single entry point for all compose
//! operations. Wraps CLI, parser, graph, profile, and template managers.

use std::path::Path;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::cli::ComposeCli;
use crate::error::{ComposeError, ComposeResult};
use crate::graph::DependencyResolver;
use crate::parser::ComposeParser;
use crate::profiles::ProfileManager;
use crate::templates::TemplateManager;
use crate::types::*;

/// Shared Tauri state handle.
pub type ComposeServiceState = Arc<Mutex<ComposeService>>;

/// Main compose service holding the CLI wrapper.
pub struct ComposeService {
    cli: Option<ComposeCli>,
}

impl ComposeService {
    pub fn new() -> Self {
        Self { cli: None }
    }

    /// Initialise / detect the compose CLI.
    pub fn init(&mut self) -> ComposeResult<ComposeVersionInfo> {
        let cli = ComposeCli::detect()?;
        let version = cli.version()?;
        self.cli = Some(cli);
        Ok(version)
    }

    /// Ensure the CLI is available.
    fn cli(&self) -> ComposeResult<&ComposeCli> {
        self.cli.as_ref().ok_or_else(|| {
            ComposeError::not_available("Compose CLI not initialised — call init first")
        })
    }

    // ══════════════════════════════════════════════════════════════
    //  CLI pass-through
    // ══════════════════════════════════════════════════════════════

    pub fn is_available(&self) -> bool {
        self.cli.as_ref().map(|c| c.is_available()).unwrap_or(false)
    }

    pub fn version(&self) -> ComposeResult<ComposeVersionInfo> {
        self.cli()?.version()
    }

    pub fn list_projects(
        &self,
        all: bool,
        filter: Option<&str>,
    ) -> ComposeResult<Vec<ComposeProject>> {
        self.cli()?.list_projects(all, filter)
    }

    pub fn up(&self, config: &ComposeUpConfig) -> ComposeResult<String> {
        self.cli()?.up(config)
    }

    pub fn down(&self, config: &ComposeDownConfig) -> ComposeResult<String> {
        self.cli()?.down(config)
    }

    pub fn ps(&self, config: &ComposePsConfig) -> ComposeResult<Vec<ComposePsItem>> {
        self.cli()?.ps(config)
    }

    pub fn logs(&self, config: &ComposeLogsConfig) -> ComposeResult<String> {
        self.cli()?.logs(config)
    }

    pub fn build(&self, config: &ComposeBuildConfig) -> ComposeResult<String> {
        self.cli()?.build(config)
    }

    pub fn pull(&self, config: &ComposePullConfig) -> ComposeResult<String> {
        self.cli()?.pull(config)
    }

    pub fn push(&self, config: &ComposePushConfig) -> ComposeResult<String> {
        self.cli()?.push(config)
    }

    pub fn compose_run(&self, config: &ComposeRunConfig) -> ComposeResult<String> {
        self.cli()?.compose_run(config)
    }

    pub fn exec(&self, config: &ComposeExecConfig) -> ComposeResult<String> {
        self.cli()?.exec(config)
    }

    pub fn create(&self, config: &ComposeCreateConfig) -> ComposeResult<String> {
        self.cli()?.create(config)
    }

    pub fn start(&self, config: &ComposeServiceActionConfig) -> ComposeResult<String> {
        self.cli()?.start(config)
    }

    pub fn stop(&self, config: &ComposeServiceActionConfig) -> ComposeResult<String> {
        self.cli()?.stop(config)
    }

    pub fn restart(&self, config: &ComposeServiceActionConfig) -> ComposeResult<String> {
        self.cli()?.restart(config)
    }

    pub fn pause(&self, config: &ComposeServiceActionConfig) -> ComposeResult<String> {
        self.cli()?.pause(config)
    }

    pub fn unpause(&self, config: &ComposeServiceActionConfig) -> ComposeResult<String> {
        self.cli()?.unpause(config)
    }

    pub fn kill(&self, config: &ComposeServiceActionConfig) -> ComposeResult<String> {
        self.cli()?.kill(config)
    }

    pub fn rm(&self, config: &ComposeRmConfig) -> ComposeResult<String> {
        self.cli()?.rm(config)
    }

    pub fn cp(&self, config: &ComposeCpConfig) -> ComposeResult<String> {
        self.cli()?.cp(config)
    }

    pub fn top(&self, config: &ComposeTopConfig) -> ComposeResult<String> {
        self.cli()?.top(config)
    }

    pub fn port(&self, config: &ComposePortConfig) -> ComposeResult<String> {
        self.cli()?.port(config)
    }

    pub fn images(&self, config: &ComposeImagesConfig) -> ComposeResult<String> {
        self.cli()?.images(config)
    }

    pub fn events_snapshot(&self, config: &ComposeEventsConfig) -> ComposeResult<String> {
        self.cli()?.events_snapshot(config)
    }

    pub fn config(&self, config: &ComposeConvertConfig) -> ComposeResult<String> {
        self.cli()?.config(config)
    }

    pub fn watch(&self, config: &ComposeWatchConfig) -> ComposeResult<String> {
        self.cli()?.watch(config)
    }

    pub fn scale(&self, config: &ComposeScaleConfig) -> ComposeResult<String> {
        self.cli()?.scale(config)
    }

    // ══════════════════════════════════════════════════════════════
    //  Parser
    // ══════════════════════════════════════════════════════════════

    pub fn parse_file(&self, path: &str) -> ComposeResult<ComposeFile> {
        ComposeParser::parse_file(Path::new(path))
    }

    pub fn parse_yaml(&self, content: &str) -> ComposeResult<ComposeFile> {
        ComposeParser::parse_yaml(content)
    }

    pub fn parse_json(&self, content: &str) -> ComposeResult<ComposeFile> {
        ComposeParser::parse_json(content)
    }

    pub fn discover_files(&self, dir: &str) -> Vec<String> {
        ComposeParser::discover_files(Path::new(dir))
            .into_iter()
            .map(|p| p.display().to_string())
            .collect()
    }

    pub fn merge_files(&self, paths: &[String]) -> ComposeResult<ComposeFile> {
        let files: Vec<ComposeFile> = paths
            .iter()
            .map(|p| ComposeParser::parse_file(Path::new(p)))
            .collect::<Result<Vec<_>, _>>()?;
        ComposeParser::merge(&files)
    }

    pub fn validate(&self, compose: &ComposeFile) -> ComposeValidation {
        ComposeParser::validate(compose)
    }

    pub fn interpolate(
        &self,
        content: &str,
        vars: &std::collections::HashMap<String, String>,
    ) -> ComposeResult<String> {
        ComposeParser::interpolate(content, vars)
    }

    pub fn parse_env_file(&self, path: &str) -> ComposeResult<EnvFile> {
        ComposeParser::parse_env_file(Path::new(path))
    }

    pub fn to_yaml(&self, compose: &ComposeFile) -> ComposeResult<String> {
        ComposeParser::to_yaml(compose)
    }

    pub fn to_json(&self, compose: &ComposeFile) -> ComposeResult<String> {
        ComposeParser::to_json(compose)
    }

    pub fn write_file(&self, compose: &ComposeFile, path: &str) -> ComposeResult<()> {
        ComposeParser::write_file(compose, Path::new(path))
    }

    // ══════════════════════════════════════════════════════════════
    //  Graph
    // ══════════════════════════════════════════════════════════════

    pub fn dependency_graph(&self, compose: &ComposeFile) -> ComposeResult<DependencyGraph> {
        DependencyResolver::build_graph(compose)
    }

    pub fn startup_order(
        &self,
        compose: &ComposeFile,
        services: &[String],
    ) -> ComposeResult<Vec<String>> {
        DependencyResolver::startup_order_for(compose, services)
    }

    pub fn shutdown_order(&self, compose: &ComposeFile) -> ComposeResult<Vec<String>> {
        DependencyResolver::shutdown_order(compose)
    }

    pub fn dependents(&self, compose: &ComposeFile, service: &str) -> Vec<String> {
        DependencyResolver::dependents(compose, service)
    }

    // ══════════════════════════════════════════════════════════════
    //  Profiles
    // ══════════════════════════════════════════════════════════════

    pub fn list_profiles(&self, compose: &ComposeFile) -> Vec<ComposeProfile> {
        ProfileManager::list_profiles(compose)
    }

    pub fn profile_names(&self, compose: &ComposeFile) -> Vec<String> {
        ProfileManager::profile_names(compose)
    }

    pub fn active_services(&self, compose: &ComposeFile, profiles: &[String]) -> Vec<String> {
        ProfileManager::active_services(compose, profiles)
    }

    pub fn profile_only_services(&self, compose: &ComposeFile) -> Vec<String> {
        ProfileManager::profile_only_services(compose)
    }

    pub fn validate_profile_deps(&self, compose: &ComposeFile, profiles: &[String]) -> Vec<String> {
        ProfileManager::validate_profile_deps(compose, profiles)
    }

    // ══════════════════════════════════════════════════════════════
    //  Templates
    // ══════════════════════════════════════════════════════════════

    pub fn list_templates(&self) -> Vec<ComposeTemplate> {
        TemplateManager::list_templates()
    }

    pub fn get_template(&self, name: &str) -> ComposeResult<ComposeTemplate> {
        TemplateManager::get_template(name)
    }

    pub fn template_categories(&self) -> Vec<String> {
        TemplateManager::categories()
    }

    pub fn templates_by_category(&self, category: &str) -> Vec<ComposeTemplate> {
        TemplateManager::by_category(category)
    }

    /// Scaffold a new project from a template.
    pub fn scaffold_from_template(&self, template_name: &str, dir: &str) -> ComposeResult<String> {
        let template = TemplateManager::get_template(template_name)?;
        let path = std::path::Path::new(dir).join("docker-compose.yml");
        std::fs::create_dir_all(dir)
            .map_err(|e| ComposeError::io(&format!("Cannot create directory {}: {}", dir, e)))?;
        std::fs::write(&path, &template.content)
            .map_err(|e| ComposeError::io(&format!("Cannot write {}: {}", path.display(), e)))?;
        Ok(path.display().to_string())
    }
}

impl Default for ComposeService {
    fn default() -> Self {
        Self::new()
    }
}
