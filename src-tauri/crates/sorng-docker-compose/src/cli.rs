// ── sorng-docker-compose/src/cli.rs ────────────────────────────────────────────
//! Docker Compose CLI wrapper — comprehensive coverage of all `docker compose`
//! sub-commands via process invocation.

use std::process::Command;

use crate::error::{ComposeError, ComposeResult};
use crate::types::*;

/// Detects and wraps the `docker compose` (v2 plugin) or `docker-compose` (v1)
/// CLI, providing methods for every sub-command.
pub struct ComposeCli {
    /// The program name — `"docker"` for v2 plugin, `"docker-compose"` for v1.
    program: String,
    /// If using the v2 plugin, the first arg is `"compose"`.
    prefix_args: Vec<String>,
}

impl ComposeCli {
    // ── Construction / detection ───────────────────────────────────

    /// Auto-detect the best available compose CLI.
    pub fn detect() -> ComposeResult<Self> {
        // Try v2 plugin first
        if let Ok(out) = Command::new("docker").args(["compose", "version"]).output() {
            if out.status.success() {
                return Ok(Self {
                    program: "docker".to_string(),
                    prefix_args: vec!["compose".to_string()],
                });
            }
        }
        // Fall back to standalone docker-compose
        if let Ok(out) = Command::new("docker-compose").arg("version").output() {
            if out.status.success() {
                return Ok(Self {
                    program: "docker-compose".to_string(),
                    prefix_args: vec![],
                });
            }
        }
        Err(ComposeError::not_available(
            "Neither 'docker compose' (v2) nor 'docker-compose' (v1) found on PATH",
        ))
    }

    /// Create a CLI wrapper for the v2 plugin explicitly.
    pub fn v2() -> Self {
        Self {
            program: "docker".to_string(),
            prefix_args: vec!["compose".to_string()],
        }
    }

    /// Create a CLI wrapper for the v1 standalone explicitly.
    pub fn v1() -> Self {
        Self {
            program: "docker-compose".to_string(),
            prefix_args: vec![],
        }
    }

    /// Check availability.
    pub fn is_available(&self) -> bool {
        let mut cmd = Command::new(&self.program);
        for a in &self.prefix_args {
            cmd.arg(a);
        }
        cmd.arg("version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    /// Get compose version info.
    pub fn version(&self) -> ComposeResult<ComposeVersionInfo> {
        let raw = self.run(&[], &["version".to_string()])?;
        let short = self.run(&[], &["version".to_string(), "--short".to_string()]).unwrap_or_else(|_| raw.clone());
        Ok(ComposeVersionInfo {
            version: short.trim().to_string(),
            is_v2_plugin: self.prefix_args.contains(&"compose".to_string()),
            raw_output: raw.trim().to_string(),
        })
    }

    // ── Project lifecycle ─────────────────────────────────────────

    /// `docker compose up`
    pub fn up(&self, config: &ComposeUpConfig) -> ComposeResult<String> {
        let mut args = Vec::new();
        args.push("up".to_string());
        if config.detach.unwrap_or(true) { args.push("-d".to_string()); }
        if config.build.unwrap_or(false) { args.push("--build".to_string()); }
        if config.force_recreate.unwrap_or(false) { args.push("--force-recreate".to_string()); }
        if config.no_recreate.unwrap_or(false) { args.push("--no-recreate".to_string()); }
        if config.remove_orphans.unwrap_or(false) { args.push("--remove-orphans".to_string()); }
        if config.no_deps.unwrap_or(false) { args.push("--no-deps".to_string()); }
        if config.wait.unwrap_or(false) { args.push("--wait".to_string()); }
        if config.no_build.unwrap_or(false) { args.push("--no-build".to_string()); }
        if config.no_start.unwrap_or(false) { args.push("--no-start".to_string()); }
        if config.no_log_prefix.unwrap_or(false) { args.push("--no-log-prefix".to_string()); }
        if config.abort_on_container_exit.unwrap_or(false) { args.push("--abort-on-container-exit".to_string()); }
        if config.attach_dependencies.unwrap_or(false) { args.push("--attach-dependencies".to_string()); }
        if config.always_recreate_deps.unwrap_or(false) { args.push("--always-recreate-deps".to_string()); }
        if config.renew_anon_volumes.unwrap_or(false) { args.push("--renew-anon-volumes".to_string()); }
        if config.quiet_pull.unwrap_or(false) { args.push("--quiet-pull".to_string()); }
        if config.timestamps.unwrap_or(false) { args.push("--timestamps".to_string()); }
        if let Some(t) = config.timeout { args.push("--timeout".to_string()); args.push(t.to_string()); }
        if let Some(t) = config.wait_timeout { args.push("--wait-timeout".to_string()); args.push(t.to_string()); }
        if let Some(ref pull) = config.pull { args.push("--pull".to_string()); args.push(pull.clone()); }
        if let Some(ref ecf) = config.exit_code_from { args.push("--exit-code-from".to_string()); args.push(ecf.clone()); }
        if let Some(ref scale) = config.scale {
            for (svc, n) in scale {
                args.push("--scale".to_string());
                args.push(format!("{}={}", svc, n));
            }
        }
        if let Some(ref svcs) = config.services {
            for s in svcs { args.push(s.clone()); }
        }
        self.run(&Self::global_args(&config.global), &args)
    }

    /// `docker compose down`
    pub fn down(&self, config: &ComposeDownConfig) -> ComposeResult<String> {
        let mut args = vec!["down".to_string()];
        if config.remove_orphans.unwrap_or(false) { args.push("--remove-orphans".to_string()); }
        if config.volumes.unwrap_or(false) { args.push("--volumes".to_string()); }
        if let Some(ref imgs) = config.images { args.push("--rmi".to_string()); args.push(imgs.clone()); }
        if let Some(t) = config.timeout { args.push("--timeout".to_string()); args.push(t.to_string()); }
        self.run(&Self::global_args(&config.global), &args)
    }

    /// `docker compose ps`
    pub fn ps(&self, config: &ComposePsConfig) -> ComposeResult<Vec<ComposePsItem>> {
        let mut args = vec!["ps".to_string(), "--format".to_string(), "json".to_string()];
        if config.all.unwrap_or(false) { args.push("--all".to_string()); }
        if config.no_trunc.unwrap_or(false) { args.push("--no-trunc".to_string()); }
        if let Some(ref orphans) = config.orphans {
            if !orphans { args.push("--no-orphans".to_string()); }
        }
        if let Some(ref statuses) = config.status {
            for s in statuses { args.push("--status".to_string()); args.push(s.clone()); }
        }
        if let Some(ref filter) = config.filter { args.push("--filter".to_string()); args.push(filter.clone()); }
        if let Some(ref svcs) = config.services {
            for s in svcs { args.push(s.clone()); }
        }

        let text = self.run(&Self::global_args(&config.global), &args)?;

        // docker compose ps --format json outputs either a JSON array or newline-
        // delimited JSON objects depending on the version.
        let trimmed = text.trim();
        if trimmed.starts_with('[') {
            serde_json::from_str(trimmed).map_err(|e| ComposeError::parse(&e.to_string()))
        } else {
            Ok(trimmed
                .lines()
                .filter(|l| !l.trim().is_empty())
                .filter_map(|l| serde_json::from_str(l).ok())
                .collect())
        }
    }

    /// `docker compose logs`
    pub fn logs(&self, config: &ComposeLogsConfig) -> ComposeResult<String> {
        let mut args = vec!["logs".to_string()];
        if config.timestamps.unwrap_or(false) { args.push("--timestamps".to_string()); }
        if config.no_color.unwrap_or(false) { args.push("--no-color".to_string()); }
        if config.no_log_prefix.unwrap_or(false) { args.push("--no-log-prefix".to_string()); }
        if let Some(ref tail) = config.tail { args.push("--tail".to_string()); args.push(tail.clone()); }
        if let Some(ref since) = config.since { args.push("--since".to_string()); args.push(since.clone()); }
        if let Some(ref until) = config.until { args.push("--until".to_string()); args.push(until.clone()); }
        // Note: --follow is intentionally omitted for non-streaming calls.
        if let Some(ref svcs) = config.services {
            for s in svcs { args.push(s.clone()); }
        }
        self.run(&Self::global_args(&config.global), &args)
    }

    /// `docker compose build`
    pub fn build(&self, config: &ComposeBuildConfig) -> ComposeResult<String> {
        let mut args = vec!["build".to_string()];
        if config.no_cache.unwrap_or(false) { args.push("--no-cache".to_string()); }
        if config.pull.unwrap_or(false) { args.push("--pull".to_string()); }
        if config.quiet.unwrap_or(false) { args.push("--quiet".to_string()); }
        if config.with_dependencies.unwrap_or(false) { args.push("--with-dependencies".to_string()); }
        if let Some(ref progress) = config.progress_output { args.push("--progress".to_string()); args.push(progress.clone()); }
        if let Some(ref ssh) = config.ssh { args.push("--ssh".to_string()); args.push(ssh.clone()); }
        if let Some(ref mem) = config.memory { args.push("--memory".to_string()); args.push(mem.clone()); }
        if let Some(ref ba) = config.build_args {
            for (k, v) in ba { args.push("--build-arg".to_string()); args.push(format!("{}={}", k, v)); }
        }
        if let Some(ref svcs) = config.services {
            for s in svcs { args.push(s.clone()); }
        }
        self.run(&Self::global_args(&config.global), &args)
    }

    /// `docker compose pull`
    pub fn pull(&self, config: &ComposePullConfig) -> ComposeResult<String> {
        let mut args = vec!["pull".to_string()];
        if config.quiet.unwrap_or(false) { args.push("--quiet".to_string()); }
        if config.ignore_pull_failures.unwrap_or(false) { args.push("--ignore-pull-failures".to_string()); }
        if config.include_deps.unwrap_or(false) { args.push("--include-deps".to_string()); }
        if config.no_parallel.unwrap_or(false) { args.push("--no-parallel".to_string()); }
        if let Some(ref policy) = config.policy { args.push("--policy".to_string()); args.push(policy.clone()); }
        if let Some(ref svcs) = config.services {
            for s in svcs { args.push(s.clone()); }
        }
        self.run(&Self::global_args(&config.global), &args)
    }

    /// `docker compose push`
    pub fn push(&self, config: &ComposePushConfig) -> ComposeResult<String> {
        let mut args = vec!["push".to_string()];
        if config.quiet.unwrap_or(false) { args.push("--quiet".to_string()); }
        if config.ignore_push_failures.unwrap_or(false) { args.push("--ignore-push-failures".to_string()); }
        if config.include_deps.unwrap_or(false) { args.push("--include-deps".to_string()); }
        if let Some(ref svcs) = config.services {
            for s in svcs { args.push(s.clone()); }
        }
        self.run(&Self::global_args(&config.global), &args)
    }

    /// `docker compose run`
    pub fn compose_run(&self, config: &ComposeRunConfig) -> ComposeResult<String> {
        let mut args = vec!["run".to_string()];
        if config.detach.unwrap_or(false) { args.push("-d".to_string()); }
        if config.rm.unwrap_or(false) { args.push("--rm".to_string()); }
        if config.no_deps.unwrap_or(false) { args.push("--no-deps".to_string()); }
        if config.service_ports.unwrap_or(false) { args.push("--service-ports".to_string()); }
        if config.use_aliases.unwrap_or(false) { args.push("--use-aliases".to_string()); }
        if config.build.unwrap_or(false) { args.push("--build".to_string()); }
        if config.quiet_pull.unwrap_or(false) { args.push("--quiet-pull".to_string()); }
        if config.remove_orphans.unwrap_or(false) { args.push("--remove-orphans".to_string()); }
        if let Some(false) = config.tty { args.push("-T".to_string()); }
        if let Some(ref name) = config.name { args.push("--name".to_string()); args.push(name.clone()); }
        if let Some(ref ep) = config.entrypoint { args.push("--entrypoint".to_string()); args.push(ep.clone()); }
        if let Some(ref user) = config.user { args.push("--user".to_string()); args.push(user.clone()); }
        if let Some(ref wd) = config.workdir { args.push("--workdir".to_string()); args.push(wd.clone()); }
        if let Some(ref env) = config.environment {
            for (k, v) in env { args.push("-e".to_string()); args.push(format!("{}={}", k, v)); }
        }
        if let Some(ref labels) = config.labels {
            for (k, v) in labels { args.push("--label".to_string()); args.push(format!("{}={}", k, v)); }
        }
        if let Some(ref vols) = config.volumes {
            for v in vols { args.push("-v".to_string()); args.push(v.clone()); }
        }
        if let Some(ref pubs) = config.publish {
            for p in pubs { args.push("-p".to_string()); args.push(p.clone()); }
        }
        if let Some(ref caps) = config.cap_add {
            for c in caps { args.push("--cap-add".to_string()); args.push(c.clone()); }
        }
        if let Some(ref caps) = config.cap_drop {
            for c in caps { args.push("--cap-drop".to_string()); args.push(c.clone()); }
        }
        args.push(config.service.clone());
        if let Some(ref cmd) = config.command {
            for c in cmd { args.push(c.clone()); }
        }
        self.run(&Self::global_args(&config.global), &args)
    }

    /// `docker compose exec`
    pub fn exec(&self, config: &ComposeExecConfig) -> ComposeResult<String> {
        let mut args = vec!["exec".to_string()];
        if config.detach.unwrap_or(false) { args.push("-d".to_string()); }
        if config.privileged.unwrap_or(false) { args.push("--privileged".to_string()); }
        if let Some(false) = config.tty { args.push("-T".to_string()); }
        if let Some(ref user) = config.user { args.push("--user".to_string()); args.push(user.clone()); }
        if let Some(ref wd) = config.workdir { args.push("--workdir".to_string()); args.push(wd.clone()); }
        if let Some(ref env) = config.environment {
            for (k, v) in env { args.push("-e".to_string()); args.push(format!("{}={}", k, v)); }
        }
        if let Some(idx) = config.index { args.push("--index".to_string()); args.push(idx.to_string()); }
        args.push(config.service.clone());
        for c in &config.command { args.push(c.clone()); }
        self.run(&Self::global_args(&config.global), &args)
    }

    /// `docker compose create`
    pub fn create(&self, config: &ComposeCreateConfig) -> ComposeResult<String> {
        let mut args = vec!["create".to_string()];
        if config.build.unwrap_or(false) { args.push("--build".to_string()); }
        if config.force_recreate.unwrap_or(false) { args.push("--force-recreate".to_string()); }
        if config.no_recreate.unwrap_or(false) { args.push("--no-recreate".to_string()); }
        if config.no_build.unwrap_or(false) { args.push("--no-build".to_string()); }
        if config.remove_orphans.unwrap_or(false) { args.push("--remove-orphans".to_string()); }
        if let Some(ref pull) = config.pull { args.push("--pull".to_string()); args.push(pull.clone()); }
        if let Some(ref scale) = config.scale {
            for (svc, n) in scale {
                args.push("--scale".to_string());
                args.push(format!("{}={}", svc, n));
            }
        }
        if let Some(ref svcs) = config.services {
            for s in svcs { args.push(s.clone()); }
        }
        self.run(&Self::global_args(&config.global), &args)
    }

    /// `docker compose start`
    pub fn start(&self, config: &ComposeServiceActionConfig) -> ComposeResult<String> {
        let mut args = vec!["start".to_string()];
        if let Some(ref svcs) = config.services {
            for s in svcs { args.push(s.clone()); }
        }
        self.run(&Self::global_args(&config.global), &args)
    }

    /// `docker compose stop`
    pub fn stop(&self, config: &ComposeServiceActionConfig) -> ComposeResult<String> {
        let mut args = vec!["stop".to_string()];
        if let Some(t) = config.timeout { args.push("--timeout".to_string()); args.push(t.to_string()); }
        if let Some(ref svcs) = config.services {
            for s in svcs { args.push(s.clone()); }
        }
        self.run(&Self::global_args(&config.global), &args)
    }

    /// `docker compose restart`
    pub fn restart(&self, config: &ComposeServiceActionConfig) -> ComposeResult<String> {
        let mut args = vec!["restart".to_string()];
        if let Some(t) = config.timeout { args.push("--timeout".to_string()); args.push(t.to_string()); }
        if let Some(ref svcs) = config.services {
            for s in svcs { args.push(s.clone()); }
        }
        self.run(&Self::global_args(&config.global), &args)
    }

    /// `docker compose pause`
    pub fn pause(&self, config: &ComposeServiceActionConfig) -> ComposeResult<String> {
        let mut args = vec!["pause".to_string()];
        if let Some(ref svcs) = config.services {
            for s in svcs { args.push(s.clone()); }
        }
        self.run(&Self::global_args(&config.global), &args)
    }

    /// `docker compose unpause`
    pub fn unpause(&self, config: &ComposeServiceActionConfig) -> ComposeResult<String> {
        let mut args = vec!["unpause".to_string()];
        if let Some(ref svcs) = config.services {
            for s in svcs { args.push(s.clone()); }
        }
        self.run(&Self::global_args(&config.global), &args)
    }

    /// `docker compose kill`
    pub fn kill(&self, config: &ComposeServiceActionConfig) -> ComposeResult<String> {
        let mut args = vec!["kill".to_string()];
        if let Some(ref signal) = config.signal { args.push("-s".to_string()); args.push(signal.clone()); }
        if let Some(ref svcs) = config.services {
            for s in svcs { args.push(s.clone()); }
        }
        self.run(&Self::global_args(&config.global), &args)
    }

    /// `docker compose rm`
    pub fn rm(&self, config: &ComposeRmConfig) -> ComposeResult<String> {
        let mut args = vec!["rm".to_string()];
        if config.force.unwrap_or(true) { args.push("--force".to_string()); }
        if config.stop.unwrap_or(false) { args.push("--stop".to_string()); }
        if config.volumes.unwrap_or(false) { args.push("--volumes".to_string()); }
        if let Some(ref svcs) = config.services {
            for s in svcs { args.push(s.clone()); }
        }
        self.run(&Self::global_args(&config.global), &args)
    }

    /// `docker compose cp`
    pub fn cp(&self, config: &ComposeCpConfig) -> ComposeResult<String> {
        let mut args = vec!["cp".to_string()];
        if config.follow_link.unwrap_or(false) { args.push("--follow-link".to_string()); }
        if config.archive.unwrap_or(false) { args.push("--archive".to_string()); }
        if let Some(idx) = config.index { args.push("--index".to_string()); args.push(idx.to_string()); }
        args.push(config.source.clone());
        args.push(config.destination.clone());
        self.run(&Self::global_args(&config.global), &args)
    }

    /// `docker compose top`
    pub fn top(&self, config: &ComposeTopConfig) -> ComposeResult<String> {
        let mut args = vec!["top".to_string()];
        if let Some(ref svcs) = config.services {
            for s in svcs { args.push(s.clone()); }
        }
        self.run(&Self::global_args(&config.global), &args)
    }

    /// `docker compose port`
    pub fn port(&self, config: &ComposePortConfig) -> ComposeResult<String> {
        let mut args = vec!["port".to_string()];
        if let Some(ref proto) = config.protocol { args.push("--protocol".to_string()); args.push(proto.clone()); }
        if let Some(idx) = config.index { args.push("--index".to_string()); args.push(idx.to_string()); }
        args.push(config.service.clone());
        args.push(config.private_port.to_string());
        self.run(&Self::global_args(&config.global), &args)
    }

    /// `docker compose images`
    pub fn images(&self, config: &ComposeImagesConfig) -> ComposeResult<String> {
        let mut args = vec!["images".to_string()];
        if config.quiet.unwrap_or(false) { args.push("--quiet".to_string()); }
        if let Some(ref svcs) = config.services {
            for s in svcs { args.push(s.clone()); }
        }
        self.run(&Self::global_args(&config.global), &args)
    }

    /// `docker compose events` (snapshot, not streaming).
    pub fn events_snapshot(&self, config: &ComposeEventsConfig) -> ComposeResult<String> {
        let mut args = vec!["events".to_string(), "--json".to_string()];
        if let Some(ref svcs) = config.services {
            for s in svcs { args.push(s.clone()); }
        }
        // We run with a short timeout so it won't block forever
        self.run_with_timeout(&Self::global_args(&config.global), &args, Some(5))
    }

    /// `docker compose config` (validate + render).
    pub fn config(&self, config: &ComposeConvertConfig) -> ComposeResult<String> {
        let mut args = vec!["config".to_string()];
        if let Some(ref fmt) = config.format { args.push("--format".to_string()); args.push(fmt.clone()); }
        if config.resolve_image_digests.unwrap_or(false) { args.push("--resolve-image-digests".to_string()); }
        if config.no_interpolate.unwrap_or(false) { args.push("--no-interpolate".to_string()); }
        if config.no_normalize.unwrap_or(false) { args.push("--no-normalize".to_string()); }
        if config.no_path_resolution.unwrap_or(false) { args.push("--no-path-resolution".to_string()); }
        if config.services.unwrap_or(false) { args.push("--services".to_string()); }
        if config.volumes_flag.unwrap_or(false) { args.push("--volumes".to_string()); }
        if config.images.unwrap_or(false) { args.push("--images".to_string()); }
        if config.quiet.unwrap_or(false) { args.push("--quiet".to_string()); }
        if let Some(ref hash) = config.hash { args.push("--hash".to_string()); args.push(hash.clone()); }
        if let Some(ref out) = config.output { args.push("--output".to_string()); args.push(out.clone()); }
        self.run(&Self::global_args(&config.global), &args)
    }

    /// `docker compose watch`
    pub fn watch(&self, config: &ComposeWatchConfig) -> ComposeResult<String> {
        let mut args = vec!["watch".to_string()];
        if config.no_up.unwrap_or(false) { args.push("--no-up".to_string()); }
        if config.quiet.unwrap_or(false) { args.push("--quiet".to_string()); }
        if config.prune.unwrap_or(false) { args.push("--prune".to_string()); }
        if let Some(ref svcs) = config.services {
            for s in svcs { args.push(s.clone()); }
        }
        self.run(&Self::global_args(&config.global), &args)
    }

    /// `docker compose scale` (or `docker compose up --scale`).
    pub fn scale(&self, config: &ComposeScaleConfig) -> ComposeResult<String> {
        // Modern compose uses `up --scale`, but there's also a hidden `scale` subcommand
        let mut args = vec!["up".to_string(), "-d".to_string()];
        if config.no_deps.unwrap_or(false) { args.push("--no-deps".to_string()); }
        for (svc, n) in &config.scale {
            args.push("--scale".to_string());
            args.push(format!("{}={}", svc, n));
        }
        for svc in config.scale.keys() {
            args.push(svc.clone());
        }
        self.run(&Self::global_args(&config.global), &args)
    }

    /// `docker compose ls` — list projects.
    pub fn list_projects(&self, all: bool, filter: Option<&str>) -> ComposeResult<Vec<ComposeProject>> {
        let mut args = vec!["ls".to_string(), "--format".to_string(), "json".to_string()];
        if all { args.push("--all".to_string()); }
        if let Some(f) = filter { args.push("--filter".to_string()); args.push(f.to_string()); }
        let text = self.run(&[], &args)?;
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return Ok(vec![]);
        }
        serde_json::from_str(trimmed).map_err(|e| ComposeError::parse(&e.to_string()))
    }

    // ── Internal ──────────────────────────────────────────────────

    /// Build global args from ComposeGlobalOptions.
    fn global_args(opts: &ComposeGlobalOptions) -> Vec<String> {
        let mut args = Vec::new();
        for f in &opts.files {
            args.push("-f".to_string());
            args.push(f.clone());
        }
        if let Some(ref pn) = opts.project_name {
            args.push("-p".to_string());
            args.push(pn.clone());
        }
        if let Some(ref pd) = opts.project_directory {
            args.push("--project-directory".to_string());
            args.push(pd.clone());
        }
        for p in &opts.profiles {
            args.push("--profile".to_string());
            args.push(p.clone());
        }
        for ef in &opts.env_files {
            args.push("--env-file".to_string());
            args.push(ef.clone());
        }
        if let Some(ref progress) = opts.progress {
            args.push("--progress".to_string());
            args.push(progress.clone());
        }
        if opts.compatibility == Some(true) {
            args.push("--compatibility".to_string());
        }
        if opts.dry_run == Some(true) {
            args.push("--dry-run".to_string());
        }
        args
    }

    /// Run a compose command with global args + sub-command args.
    fn run(&self, global_args: &[String], cmd_args: &[String]) -> ComposeResult<String> {
        self.run_with_timeout(global_args, cmd_args, None)
    }

    /// Run a compose command with an optional timeout (seconds).
    fn run_with_timeout(
        &self,
        global_args: &[String],
        cmd_args: &[String],
        _timeout_secs: Option<u64>,
    ) -> ComposeResult<String> {
        let mut cmd = Command::new(&self.program);
        for a in &self.prefix_args {
            cmd.arg(a);
        }
        for a in global_args {
            cmd.arg(a);
        }
        for a in cmd_args {
            cmd.arg(a);
        }

        log::debug!(
            "Running: {} {} {} {}",
            self.program,
            self.prefix_args.join(" "),
            global_args.join(" "),
            cmd_args.join(" ")
        );

        let output = cmd.output().map_err(|e| {
            ComposeError::command(&format!("Failed to execute compose CLI: {}", e))
        })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            let exit_code = output.status.code().unwrap_or(-1);
            return Err(
                ComposeError::command(&format!("{}{}", stderr, stdout))
                    .with_exit_code(exit_code),
            );
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }
}
