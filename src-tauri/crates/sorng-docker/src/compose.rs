// ── sorng-docker/src/compose.rs ───────────────────────────────────────────────
//! Docker Compose CLI wrapper.

use crate::error::{DockerError, DockerResult};
use crate::types::*;
use std::process::Command;

/// Docker Compose manager – wraps `docker compose` (v2 plugin).
pub struct ComposeManager;

impl ComposeManager {
    /// Check if `docker compose` is available.
    pub fn is_available() -> bool {
        Command::new("docker")
            .args(["compose", "version"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    /// Get compose version.
    pub fn version() -> DockerResult<String> {
        let out = Command::new("docker")
            .args(["compose", "version", "--short"])
            .output()
            .map_err(|e| DockerError::compose(&format!("Failed to run docker compose: {}", e)))?;
        if !out.status.success() {
            return Err(DockerError::compose(&String::from_utf8_lossy(&out.stderr)));
        }
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    /// List compose projects.
    pub fn list_projects() -> DockerResult<Vec<ComposeProject>> {
        let out = Command::new("docker")
            .args(["compose", "ls", "--format", "json"])
            .output()
            .map_err(|e| DockerError::compose(&e.to_string()))?;
        if !out.status.success() {
            return Err(DockerError::compose(&String::from_utf8_lossy(&out.stderr)));
        }
        let text = String::from_utf8_lossy(&out.stdout);
        serde_json::from_str(&text).map_err(|e| DockerError::parse(&e.to_string()))
    }

    /// Run `docker compose up`.
    pub fn up(config: &ComposeUpConfig) -> DockerResult<String> {
        let mut args = vec!["compose".to_string()];
        for f in &config.files { args.push("-f".to_string()); args.push(f.clone()); }
        if let Some(ref pn) = config.project_name { args.push("-p".to_string()); args.push(pn.clone()); }
        args.push("up".to_string());
        if config.detach.unwrap_or(true) { args.push("-d".to_string()); }
        if config.build.unwrap_or(false) { args.push("--build".to_string()); }
        if config.force_recreate.unwrap_or(false) { args.push("--force-recreate".to_string()); }
        if config.no_recreate.unwrap_or(false) { args.push("--no-recreate".to_string()); }
        if config.remove_orphans.unwrap_or(false) { args.push("--remove-orphans".to_string()); }
        if config.no_deps.unwrap_or(false) { args.push("--no-deps".to_string()); }
        if config.wait.unwrap_or(false) { args.push("--wait".to_string()); }
        if let Some(t) = config.timeout { args.push("--timeout".to_string()); args.push(t.to_string()); }
        if let Some(ref pull) = config.pull { args.push("--pull".to_string()); args.push(pull.clone()); }
        if let Some(ref profiles) = config.profiles {
            for p in profiles { args.push("--profile".to_string()); args.push(p.clone()); }
        }
        if let Some(ref scale) = config.scale {
            for (svc, n) in scale {
                args.push("--scale".to_string());
                args.push(format!("{}={}", svc, n));
            }
        }
        if let Some(ref envfiles) = config.env_file {
            for ef in envfiles { args.push("--env-file".to_string()); args.push(ef.clone()); }
        }
        if let Some(ref svcs) = config.services {
            for s in svcs { args.push(s.clone()); }
        }
        Self::run_command(&args)
    }

    /// Run `docker compose down`.
    pub fn down(config: &ComposeDownConfig) -> DockerResult<String> {
        let mut args = vec!["compose".to_string()];
        for f in &config.files { args.push("-f".to_string()); args.push(f.clone()); }
        if let Some(ref pn) = config.project_name { args.push("-p".to_string()); args.push(pn.clone()); }
        args.push("down".to_string());
        if config.remove_orphans.unwrap_or(false) { args.push("--remove-orphans".to_string()); }
        if config.volumes.unwrap_or(false) { args.push("--volumes".to_string()); }
        if let Some(ref imgs) = config.images { args.push("--rmi".to_string()); args.push(imgs.clone()); }
        if let Some(t) = config.timeout { args.push("--timeout".to_string()); args.push(t.to_string()); }
        Self::run_command(&args)
    }

    /// Run `docker compose ps`.
    pub fn ps(files: &[String], project_name: Option<&str>) -> DockerResult<Vec<ComposePsItem>> {
        let mut args = vec!["compose".to_string()];
        for f in files { args.push("-f".to_string()); args.push(f.clone()); }
        if let Some(pn) = project_name { args.push("-p".to_string()); args.push(pn.to_string()); }
        args.push("ps".to_string());
        args.push("--format".to_string());
        args.push("json".to_string());
        let text = Self::run_command(&args)?;
        // docker compose ps --format json outputs newline-delimited JSON objects
        let items: Vec<ComposePsItem> = text
            .lines()
            .filter(|l| !l.trim().is_empty())
            .filter_map(|l| serde_json::from_str(l).ok())
            .collect();
        Ok(items)
    }

    /// Run `docker compose logs`.
    pub fn logs(config: &ComposeLogsConfig) -> DockerResult<String> {
        let mut args = vec!["compose".to_string()];
        for f in &config.files { args.push("-f".to_string()); args.push(f.clone()); }
        if let Some(ref pn) = config.project_name { args.push("-p".to_string()); args.push(pn.clone()); }
        args.push("logs".to_string());
        if config.timestamps.unwrap_or(false) { args.push("--timestamps".to_string()); }
        if config.no_color.unwrap_or(false) { args.push("--no-color".to_string()); }
        if let Some(ref tail) = config.tail { args.push("--tail".to_string()); args.push(tail.clone()); }
        if let Some(ref since) = config.since { args.push("--since".to_string()); args.push(since.clone()); }
        if let Some(ref until) = config.until { args.push("--until".to_string()); args.push(until.clone()); }
        if let Some(ref svcs) = config.services {
            for s in svcs { args.push(s.clone()); }
        }
        Self::run_command(&args)
    }

    /// Run `docker compose build`.
    pub fn build(config: &ComposeBuildConfig) -> DockerResult<String> {
        let mut args = vec!["compose".to_string()];
        for f in &config.files { args.push("-f".to_string()); args.push(f.clone()); }
        if let Some(ref pn) = config.project_name { args.push("-p".to_string()); args.push(pn.clone()); }
        args.push("build".to_string());
        if config.no_cache.unwrap_or(false) { args.push("--no-cache".to_string()); }
        if config.pull.unwrap_or(false) { args.push("--pull".to_string()); }
        if config.quiet.unwrap_or(false) { args.push("--quiet".to_string()); }
        if let Some(ref progress) = config.progress { args.push("--progress".to_string()); args.push(progress.clone()); }
        if let Some(ref ba) = config.build_args {
            for (k, v) in ba { args.push("--build-arg".to_string()); args.push(format!("{}={}", k, v)); }
        }
        if let Some(ref svcs) = config.services {
            for s in svcs { args.push(s.clone()); }
        }
        Self::run_command(&args)
    }

    /// Run `docker compose pull`.
    pub fn pull(config: &ComposePullConfig) -> DockerResult<String> {
        let mut args = vec!["compose".to_string()];
        for f in &config.files { args.push("-f".to_string()); args.push(f.clone()); }
        if let Some(ref pn) = config.project_name { args.push("-p".to_string()); args.push(pn.clone()); }
        args.push("pull".to_string());
        if config.quiet.unwrap_or(false) { args.push("--quiet".to_string()); }
        if config.ignore_pull_failures.unwrap_or(false) { args.push("--ignore-pull-failures".to_string()); }
        if config.include_deps.unwrap_or(false) { args.push("--include-deps".to_string()); }
        if let Some(ref svcs) = config.services {
            for s in svcs { args.push(s.clone()); }
        }
        Self::run_command(&args)
    }

    /// Run `docker compose restart`.
    pub fn restart(files: &[String], project_name: Option<&str>, services: Option<&[String]>, timeout: Option<i32>) -> DockerResult<String> {
        let mut args = vec!["compose".to_string()];
        for f in files { args.push("-f".to_string()); args.push(f.clone()); }
        if let Some(pn) = project_name { args.push("-p".to_string()); args.push(pn.to_string()); }
        args.push("restart".to_string());
        if let Some(t) = timeout { args.push("--timeout".to_string()); args.push(t.to_string()); }
        if let Some(svcs) = services {
            for s in svcs { args.push(s.clone()); }
        }
        Self::run_command(&args)
    }

    /// Run `docker compose stop`.
    pub fn stop(files: &[String], project_name: Option<&str>, services: Option<&[String]>, timeout: Option<i32>) -> DockerResult<String> {
        let mut args = vec!["compose".to_string()];
        for f in files { args.push("-f".to_string()); args.push(f.clone()); }
        if let Some(pn) = project_name { args.push("-p".to_string()); args.push(pn.to_string()); }
        args.push("stop".to_string());
        if let Some(t) = timeout { args.push("--timeout".to_string()); args.push(t.to_string()); }
        if let Some(svcs) = services {
            for s in svcs { args.push(s.clone()); }
        }
        Self::run_command(&args)
    }

    /// Run `docker compose start`.
    pub fn start(files: &[String], project_name: Option<&str>, services: Option<&[String]>) -> DockerResult<String> {
        let mut args = vec!["compose".to_string()];
        for f in files { args.push("-f".to_string()); args.push(f.clone()); }
        if let Some(pn) = project_name { args.push("-p".to_string()); args.push(pn.to_string()); }
        args.push("start".to_string());
        if let Some(svcs) = services {
            for s in svcs { args.push(s.clone()); }
        }
        Self::run_command(&args)
    }

    /// Run `docker compose config` — validate and render.
    pub fn config(files: &[String], project_name: Option<&str>) -> DockerResult<String> {
        let mut args = vec!["compose".to_string()];
        for f in files { args.push("-f".to_string()); args.push(f.clone()); }
        if let Some(pn) = project_name { args.push("-p".to_string()); args.push(pn.to_string()); }
        args.push("config".to_string());
        Self::run_command(&args)
    }

    // ── Private ───────────────────────────────────────────────────

    fn run_command(args: &[String]) -> DockerResult<String> {
        let str_args: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let out = Command::new("docker")
            .args(&str_args)
            .output()
            .map_err(|e| DockerError::compose(&format!("Failed to run docker: {}", e)))?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            let stdout = String::from_utf8_lossy(&out.stdout);
            return Err(DockerError::compose(&format!("{}{}", stderr, stdout)));
        }
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    }
}
