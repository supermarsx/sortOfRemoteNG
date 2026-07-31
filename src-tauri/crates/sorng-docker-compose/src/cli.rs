//! Hardened Docker Compose CLI integration.

use crate::error::{ComposeError, ComposeErrorKind, ComposeResult};
use crate::types::*;
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

#[path = "../../sorng-compose-process.rs"]
mod process_boundary;

use process_boundary::{
    append_environment_passthrough, execute, resolve_trusted_executable,
    unavailable_executable_path, ProcessBoundaryError, DEFAULT_OPERATION_TIMEOUT,
    MAX_CAPTURE_BYTES,
};

const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const EVENTS_TIMEOUT_SECONDS: u64 = 5;
const WATCH_TIMEOUT_SECONDS: u64 = 30;
const MAX_OPERATION_TIMEOUT: Duration = Duration::from_secs(3600);

/// A resolved Docker Compose command surface.
///
/// The program is either a canonical executable under a trusted installation
/// root or a deterministic unavailable sentinel. No shell lookup is performed
/// when a command is executed.
#[derive(Clone)]
pub struct ComposeCli {
    program: PathBuf,
    prefix_args: Vec<String>,
}

impl ComposeCli {
    /// Detect the Compose v2 Docker plugin, then the standalone v1 executable.
    pub fn detect() -> ComposeResult<Self> {
        let v2 = Self::v2();
        if v2.is_available() {
            return Ok(v2);
        }

        let v1 = Self::v1();
        if v1.is_available() {
            return Ok(v1);
        }

        Err(ComposeError::not_available(
            "Docker Compose is not available from a trusted installation path",
        ))
    }

    /// Construct a Docker Compose v2 plugin invocation.
    pub fn v2() -> Self {
        Self {
            program: resolve_trusted_executable("docker")
                .unwrap_or_else(|_| unavailable_executable_path("docker")),
            prefix_args: vec!["compose".to_string()],
        }
    }

    /// Construct a standalone Docker Compose v1 invocation.
    pub fn v1() -> Self {
        Self {
            program: resolve_trusted_executable("docker-compose")
                .unwrap_or_else(|_| unavailable_executable_path("docker-compose")),
            prefix_args: Vec::new(),
        }
    }

    /// Check availability with a bounded version probe.
    pub fn is_available(&self) -> bool {
        self.run_with_timeout(
            vec!["version".to_string(), "--short".to_string()],
            Vec::new(),
            PROBE_TIMEOUT,
        )
        .is_ok()
    }

    /// Return Docker Compose version information.
    pub fn version(&self) -> ComposeResult<ComposeVersionInfo> {
        let raw_output = self.run_with_timeout(
            vec!["version".to_string(), "--short".to_string()],
            Vec::new(),
            PROBE_TIMEOUT,
        )?;
        Ok(ComposeVersionInfo {
            version: raw_output.trim().to_string(),
            is_v2_plugin: !self.prefix_args.is_empty(),
            raw_output,
        })
    }

    pub fn up(&self, config: &ComposeUpConfig) -> ComposeResult<String> {
        let mut args = global_args(&config.global);
        args.push("up".to_string());
        if config.detach.unwrap_or(true) {
            args.push("--detach".to_string());
        }
        add_bool(&mut args, config.build, "--build");
        add_bool(&mut args, config.force_recreate, "--force-recreate");
        add_bool(&mut args, config.no_recreate, "--no-recreate");
        add_bool(&mut args, config.remove_orphans, "--remove-orphans");
        add_value(&mut args, config.timeout.as_ref(), "--timeout");
        add_scale_values(&mut args, config.scale.as_ref());
        add_bool(&mut args, config.no_deps, "--no-deps");
        add_value(&mut args, config.pull.as_ref(), "--pull");
        add_bool(&mut args, config.quiet_pull, "--quiet-pull");
        add_bool(&mut args, config.wait, "--wait");
        add_value(&mut args, config.wait_timeout.as_ref(), "--wait-timeout");
        add_bool(&mut args, config.no_build, "--no-build");
        add_bool(&mut args, config.no_start, "--no-start");
        add_bool(&mut args, config.no_log_prefix, "--no-log-prefix");
        add_bool(
            &mut args,
            config.abort_on_container_exit,
            "--abort-on-container-exit",
        );
        add_bool(
            &mut args,
            config.attach_dependencies,
            "--attach-dependencies",
        );
        add_bool(
            &mut args,
            config.always_recreate_deps,
            "--always-recreate-deps",
        );
        add_bool(&mut args, config.renew_anon_volumes, "--renew-anon-volumes");
        add_bool(&mut args, config.timestamps, "--timestamps");
        add_value(
            &mut args,
            config.exit_code_from.as_ref(),
            "--exit-code-from",
        );
        add_positional_values(&mut args, config.services.as_ref());
        self.run(args, Vec::new())
    }

    pub fn down(&self, config: &ComposeDownConfig) -> ComposeResult<String> {
        let mut args = global_args(&config.global);
        args.push("down".to_string());
        add_bool(&mut args, config.remove_orphans, "--remove-orphans");
        add_bool(&mut args, config.volumes, "--volumes");
        add_value(&mut args, config.images.as_ref(), "--rmi");
        add_value(&mut args, config.timeout.as_ref(), "--timeout");
        self.run(args, Vec::new())
    }

    pub fn ps(&self, config: &ComposePsConfig) -> ComposeResult<Vec<ComposePsItem>> {
        let mut args = global_args(&config.global);
        args.extend(["ps".to_string(), "--format".to_string(), "json".to_string()]);
        add_bool(&mut args, config.all, "--all");
        if let Some(statuses) = config.status.as_ref() {
            for status in statuses {
                args.extend(["--status".to_string(), status.clone()]);
            }
        }
        add_value(&mut args, config.filter.as_ref(), "--filter");
        add_bool(&mut args, config.orphans, "--orphans");
        add_bool(&mut args, config.no_trunc, "--no-trunc");
        add_positional_values(&mut args, config.services.as_ref());
        let output = self.run(args, Vec::new())?;
        parse_ps_output(&output)
    }

    pub fn logs(&self, config: &ComposeLogsConfig) -> ComposeResult<String> {
        let mut args = global_args(&config.global);
        args.push("logs".to_string());
        // This API returns a finite snapshot. `follow` is deliberately ignored
        // so a caller cannot create an unbounded process or response.
        add_value(&mut args, config.tail.as_ref(), "--tail");
        add_bool(&mut args, config.timestamps, "--timestamps");
        add_value(&mut args, config.since.as_ref(), "--since");
        add_value(&mut args, config.until.as_ref(), "--until");
        add_bool(&mut args, config.no_color, "--no-color");
        add_bool(&mut args, config.no_log_prefix, "--no-log-prefix");
        add_positional_values(&mut args, config.services.as_ref());
        self.run(args, Vec::new())
    }

    pub fn build(&self, config: &ComposeBuildConfig) -> ComposeResult<String> {
        let (args, environment) = build_invocation(config)?;
        self.run(args, environment)
    }

    pub fn pull(&self, config: &ComposePullConfig) -> ComposeResult<String> {
        let mut args = global_args(&config.global);
        args.push("pull".to_string());
        add_bool(&mut args, config.quiet, "--quiet");
        add_bool(
            &mut args,
            config.ignore_pull_failures,
            "--ignore-pull-failures",
        );
        add_bool(&mut args, config.include_deps, "--include-deps");
        add_bool(&mut args, config.no_parallel, "--no-parallel");
        add_value(&mut args, config.policy.as_ref(), "--policy");
        add_positional_values(&mut args, config.services.as_ref());
        self.run(args, Vec::new())
    }

    pub fn push(&self, config: &ComposePushConfig) -> ComposeResult<String> {
        let mut args = global_args(&config.global);
        args.push("push".to_string());
        add_bool(
            &mut args,
            config.ignore_push_failures,
            "--ignore-push-failures",
        );
        add_bool(&mut args, config.include_deps, "--include-deps");
        add_bool(&mut args, config.quiet, "--quiet");
        add_positional_values(&mut args, config.services.as_ref());
        self.run(args, Vec::new())
    }

    pub fn compose_run(&self, config: &ComposeRunConfig) -> ComposeResult<String> {
        let (args, environment) = compose_run_invocation(config)?;
        self.run(args, environment)
    }

    pub fn exec(&self, config: &ComposeExecConfig) -> ComposeResult<String> {
        let mut args = global_args(&config.global);
        args.push("exec".to_string());
        add_bool(&mut args, config.detach, "--detach");
        add_bool(&mut args, config.privileged, "--privileged");
        add_value(&mut args, config.user.as_ref(), "--user");
        add_value(&mut args, config.workdir.as_ref(), "--workdir");
        let environment = append_secret_environment(&mut args, config.environment.as_ref(), "-e")?;
        add_value(&mut args, config.index.as_ref(), "--index");
        add_interactive(&mut args, config.interactive);
        add_tty(&mut args, config.tty);
        args.push(config.service.clone());
        args.extend(config.command.iter().cloned());
        self.run(args, environment)
    }

    pub fn create(&self, config: &ComposeCreateConfig) -> ComposeResult<String> {
        let mut args = global_args(&config.global);
        args.push("create".to_string());
        add_bool(&mut args, config.build, "--build");
        add_bool(&mut args, config.force_recreate, "--force-recreate");
        add_bool(&mut args, config.no_recreate, "--no-recreate");
        add_bool(&mut args, config.no_build, "--no-build");
        add_value(&mut args, config.pull.as_ref(), "--pull");
        add_bool(&mut args, config.remove_orphans, "--remove-orphans");
        add_scale_values(&mut args, config.scale.as_ref());
        add_positional_values(&mut args, config.services.as_ref());
        self.run(args, Vec::new())
    }

    pub fn start(&self, config: &ComposeServiceActionConfig) -> ComposeResult<String> {
        let mut args = service_action_args(config, "start");
        add_positional_values(&mut args, config.services.as_ref());
        self.run(args, Vec::new())
    }

    pub fn stop(&self, config: &ComposeServiceActionConfig) -> ComposeResult<String> {
        let mut args = service_action_args(config, "stop");
        add_value(&mut args, config.timeout.as_ref(), "--timeout");
        add_positional_values(&mut args, config.services.as_ref());
        self.run(args, Vec::new())
    }

    pub fn restart(&self, config: &ComposeServiceActionConfig) -> ComposeResult<String> {
        let mut args = service_action_args(config, "restart");
        add_value(&mut args, config.timeout.as_ref(), "--timeout");
        add_positional_values(&mut args, config.services.as_ref());
        self.run(args, Vec::new())
    }

    pub fn pause(&self, config: &ComposeServiceActionConfig) -> ComposeResult<String> {
        let mut args = service_action_args(config, "pause");
        add_positional_values(&mut args, config.services.as_ref());
        self.run(args, Vec::new())
    }

    pub fn unpause(&self, config: &ComposeServiceActionConfig) -> ComposeResult<String> {
        let mut args = service_action_args(config, "unpause");
        add_positional_values(&mut args, config.services.as_ref());
        self.run(args, Vec::new())
    }

    pub fn kill(&self, config: &ComposeServiceActionConfig) -> ComposeResult<String> {
        let mut args = service_action_args(config, "kill");
        add_value(&mut args, config.signal.as_ref(), "--signal");
        add_positional_values(&mut args, config.services.as_ref());
        self.run(args, Vec::new())
    }

    pub fn rm(&self, config: &ComposeRmConfig) -> ComposeResult<String> {
        self.run(rm_args(config), Vec::new())
    }

    pub fn cp(&self, config: &ComposeCpConfig) -> ComposeResult<String> {
        let mut args = global_args(&config.global);
        args.push("cp".to_string());
        add_value(&mut args, config.index.as_ref(), "--index");
        add_bool(&mut args, config.follow_link, "--follow-link");
        add_bool(&mut args, config.archive, "--archive");
        args.push(format!("{}:{}", config.service, config.source));
        args.push(config.destination.clone());
        self.run(args, Vec::new())
    }

    pub fn top(&self, config: &ComposeTopConfig) -> ComposeResult<String> {
        let mut args = global_args(&config.global);
        args.push("top".to_string());
        add_positional_values(&mut args, config.services.as_ref());
        self.run(args, Vec::new())
    }

    pub fn port(&self, config: &ComposePortConfig) -> ComposeResult<String> {
        let mut args = global_args(&config.global);
        args.push("port".to_string());
        add_value(&mut args, config.protocol.as_ref(), "--protocol");
        add_value(&mut args, config.index.as_ref(), "--index");
        args.push(config.service.clone());
        args.push(config.private_port.to_string());
        self.run(args, Vec::new())
    }

    pub fn images(&self, config: &ComposeImagesConfig) -> ComposeResult<String> {
        let mut args = global_args(&config.global);
        args.push("images".to_string());
        add_bool(&mut args, config.quiet, "--quiet");
        add_positional_values(&mut args, config.services.as_ref());
        self.run(args, Vec::new())
    }

    pub fn events_snapshot(&self, config: &ComposeEventsConfig) -> ComposeResult<String> {
        let mut args = global_args(&config.global);
        args.push("events".to_string());
        add_bool(&mut args, config.json, "--json");
        add_positional_values(&mut args, config.services.as_ref());
        let timeout = bounded_timeout(config.timeout_seconds, EVENTS_TIMEOUT_SECONDS)?;
        self.run_with_timeout(args, Vec::new(), timeout)
    }

    pub fn config(&self, config: &ComposeConvertConfig) -> ComposeResult<String> {
        let mut args = global_args(&config.global);
        args.push("config".to_string());
        add_value(&mut args, config.format.as_ref(), "--format");
        add_bool(
            &mut args,
            config.resolve_image_digests,
            "--resolve-image-digests",
        );
        add_bool(&mut args, config.no_interpolate, "--no-interpolate");
        add_bool(&mut args, config.no_normalize, "--no-normalize");
        add_bool(&mut args, config.no_path_resolution, "--no-path-resolution");
        add_bool(&mut args, config.services, "--services");
        add_bool(&mut args, config.volumes_flag, "--volumes");
        add_value(&mut args, config.hash.as_ref(), "--hash");
        add_bool(&mut args, config.images, "--images");
        add_bool(&mut args, config.quiet, "--quiet");
        add_value(&mut args, config.output.as_ref(), "--output");
        self.run(args, Vec::new())
    }

    pub fn watch(&self, config: &ComposeWatchConfig) -> ComposeResult<String> {
        let mut args = global_args(&config.global);
        args.push("watch".to_string());
        add_bool(&mut args, config.no_up, "--no-up");
        add_bool(&mut args, config.quiet, "--quiet");
        add_bool(&mut args, config.prune, "--prune");
        add_positional_values(&mut args, config.services.as_ref());
        let timeout = bounded_timeout(config.timeout_seconds, WATCH_TIMEOUT_SECONDS)?;
        self.run_with_timeout(args, Vec::new(), timeout)
    }

    pub fn scale(&self, config: &ComposeScaleConfig) -> ComposeResult<String> {
        let mut args = global_args(&config.global);
        args.push("scale".to_string());
        add_bool(&mut args, config.no_deps, "--no-deps");
        let mut services: Vec<_> = config.scale.iter().collect();
        services.sort_unstable_by(|left, right| left.0.cmp(right.0));
        args.extend(
            services
                .into_iter()
                .map(|(service, replicas)| format!("{}={}", service, replicas)),
        );
        self.run(args, Vec::new())
    }

    pub fn list_projects(
        &self,
        all: bool,
        filter: Option<&str>,
    ) -> ComposeResult<Vec<ComposeProject>> {
        let mut args = vec!["ls".to_string(), "--format".to_string(), "json".to_string()];
        if all {
            args.push("--all".to_string());
        }
        if let Some(filter) = filter {
            args.extend(["--filter".to_string(), filter.to_string()]);
        }
        let output = self.run(args, Vec::new())?;
        parse_project_output(&output)
    }

    fn run(
        &self,
        args: impl Into<ComposeArgs>,
        environment: Vec<(String, String)>,
    ) -> ComposeResult<String> {
        self.run_with_timeout(args, environment, DEFAULT_OPERATION_TIMEOUT)
    }

    fn run_with_timeout(
        &self,
        args: impl Into<ComposeArgs>,
        environment: Vec<(String, String)>,
        timeout: Duration,
    ) -> ComposeResult<String> {
        if timeout.is_zero() || timeout > MAX_OPERATION_TIMEOUT {
            return Err(ComposeError::validation(
                "Docker Compose timeout must be between 1 millisecond and 3600 seconds",
            ));
        }

        let ComposeArgs {
            arguments,
            working_directory,
        } = args.into();
        let mut invocation = self.prefix_args.clone();
        invocation.extend(arguments);
        self.run_invocation(invocation, environment, working_directory, timeout)
    }

    fn run_invocation(
        &self,
        invocation: Vec<String>,
        environment: Vec<(String, String)>,
        working_directory: Option<std::path::PathBuf>,
        timeout: Duration,
    ) -> ComposeResult<String> {
        let output = execute(
            &self.program,
            &invocation,
            &environment,
            working_directory.as_deref(),
            timeout,
            MAX_CAPTURE_BYTES,
        )
        .map_err(map_process_error)?;

        let output_details = format!(
            "stdout_bytes={}, stderr_bytes={}, stdout_truncated={}, stderr_truncated={}",
            output.stdout.bytes.len(),
            output.stderr.bytes.len(),
            output.stdout.truncated,
            output.stderr.truncated,
        );

        if !output.status.success() {
            let mut error = ComposeError::with_details(
                ComposeErrorKind::CommandFailed,
                "Docker Compose command failed",
                output_details,
            );
            error.exit_code = output.status.code();
            return Err(error);
        }

        if output.stdout.truncated {
            return Err(ComposeError::with_details(
                ComposeErrorKind::CommandFailed,
                "Docker Compose output exceeded the safety limit",
                output_details,
            ));
        }

        Ok(String::from_utf8_lossy(&output.stdout.bytes).into_owned())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ComposeArgs {
    arguments: Vec<String>,
    working_directory: Option<std::path::PathBuf>,
}

impl From<Vec<String>> for ComposeArgs {
    fn from(arguments: Vec<String>) -> Self {
        Self {
            arguments,
            working_directory: None,
        }
    }
}

impl std::ops::Deref for ComposeArgs {
    type Target = Vec<String>;

    fn deref(&self) -> &Self::Target {
        &self.arguments
    }
}

impl std::ops::DerefMut for ComposeArgs {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.arguments
    }
}

impl PartialEq<Vec<String>> for ComposeArgs {
    fn eq(&self, other: &Vec<String>) -> bool {
        self.arguments == *other
    }
}

fn global_args(global: &ComposeGlobalOptions) -> ComposeArgs {
    let mut args = ComposeArgs {
        arguments: Vec::new(),
        working_directory: global
            .working_directory
            .as_deref()
            .map(std::path::PathBuf::from),
    };
    for file in &global.files {
        args.extend(["-f".to_string(), file.clone()]);
    }
    add_value(&mut args, global.project_name.as_ref(), "-p");
    add_value(
        &mut args,
        global.project_directory.as_ref(),
        "--project-directory",
    );
    for profile in &global.profiles {
        args.extend(["--profile".to_string(), profile.clone()]);
    }
    for env_file in &global.env_files {
        args.extend(["--env-file".to_string(), env_file.clone()]);
    }
    add_value(&mut args, global.progress.as_ref(), "--progress");
    add_bool(&mut args, global.compatibility, "--compatibility");
    add_bool(&mut args, global.dry_run, "--dry-run");
    args
}

fn build_invocation(
    config: &ComposeBuildConfig,
) -> ComposeResult<(ComposeArgs, Vec<(String, String)>)> {
    let mut args = global_args(&config.global);
    args.push("build".to_string());
    add_bool(&mut args, config.no_cache, "--no-cache");
    add_bool(&mut args, config.pull, "--pull");
    let environment =
        append_secret_environment(&mut args, config.build_args.as_ref(), "--build-arg")?;
    add_value(&mut args, config.progress_output.as_ref(), "--progress");
    add_bool(&mut args, config.quiet, "--quiet");
    add_value(&mut args, config.ssh.as_ref(), "--ssh");
    add_bool(&mut args, config.with_dependencies, "--with-dependencies");
    add_value(&mut args, config.memory.as_ref(), "--memory");
    add_positional_values(&mut args, config.services.as_ref());
    Ok((args, environment))
}

fn compose_run_invocation(
    config: &ComposeRunConfig,
) -> ComposeResult<(ComposeArgs, Vec<(String, String)>)> {
    let mut args = global_args(&config.global);
    args.push("run".to_string());
    add_bool(&mut args, config.detach, "--detach");
    add_value(&mut args, config.name.as_ref(), "--name");
    add_value(&mut args, config.entrypoint.as_ref(), "--entrypoint");
    let environment = append_secret_environment(&mut args, config.environment.as_ref(), "-e")?;
    add_key_value_flags(&mut args, config.labels.as_ref(), "--label");
    add_value(&mut args, config.user.as_ref(), "--user");
    add_value(&mut args, config.workdir.as_ref(), "--workdir");
    add_repeated_values(&mut args, config.volumes.as_ref(), "--volume");
    add_repeated_values(&mut args, config.publish.as_ref(), "--publish");
    add_bool(&mut args, config.no_deps, "--no-deps");
    add_bool(&mut args, config.rm, "--rm");
    add_bool(&mut args, config.service_ports, "--service-ports");
    add_bool(&mut args, config.use_aliases, "--use-aliases");
    add_interactive(&mut args, config.interactive);
    add_tty(&mut args, config.tty);
    add_bool(&mut args, config.build, "--build");
    add_bool(&mut args, config.quiet_pull, "--quiet-pull");
    add_bool(&mut args, config.remove_orphans, "--remove-orphans");
    add_repeated_values(&mut args, config.cap_add.as_ref(), "--cap-add");
    add_repeated_values(&mut args, config.cap_drop.as_ref(), "--cap-drop");
    args.push(config.service.clone());
    if let Some(command) = config.command.as_ref() {
        args.extend(command.iter().cloned());
    }
    Ok((args, environment))
}

fn service_action_args(config: &ComposeServiceActionConfig, command: &str) -> ComposeArgs {
    let mut args = global_args(&config.global);
    args.push(command.to_string());
    args
}

fn rm_args(config: &ComposeRmConfig) -> ComposeArgs {
    let mut args = global_args(&config.global);
    args.push("rm".to_string());
    if config.force == Some(true) {
        args.push("--force".to_string());
    }
    add_bool(&mut args, config.stop, "--stop");
    add_bool(&mut args, config.volumes, "--volumes");
    add_positional_values(&mut args, config.services.as_ref());
    args
}

fn append_secret_environment(
    args: &mut Vec<String>,
    values: Option<&HashMap<String, String>>,
    flag: &str,
) -> ComposeResult<Vec<(String, String)>> {
    let Some(values) = values else {
        return Ok(Vec::new());
    };
    append_environment_passthrough(args, values, flag).map_err(map_process_error)
}

fn add_bool(args: &mut Vec<String>, enabled: Option<bool>, flag: &str) {
    if enabled == Some(true) {
        args.push(flag.to_string());
    }
}

fn add_value<T: ToString>(args: &mut Vec<String>, value: Option<&T>, flag: &str) {
    if let Some(value) = value {
        args.extend([flag.to_string(), value.to_string()]);
    }
}

fn add_repeated_values(args: &mut Vec<String>, values: Option<&Vec<String>>, flag: &str) {
    if let Some(values) = values {
        for value in values {
            args.extend([flag.to_string(), value.clone()]);
        }
    }
}

fn add_positional_values(args: &mut Vec<String>, values: Option<&Vec<String>>) {
    if let Some(values) = values {
        args.extend(values.iter().cloned());
    }
}

fn add_key_value_flags(
    args: &mut Vec<String>,
    values: Option<&HashMap<String, String>>,
    flag: &str,
) {
    let Some(values) = values else {
        return;
    };
    let mut values: Vec<_> = values.iter().collect();
    values.sort_unstable_by(|left, right| left.0.cmp(right.0));
    for (key, value) in values {
        args.extend([flag.to_string(), format!("{}={}", key, value)]);
    }
}

fn add_scale_values(args: &mut Vec<String>, values: Option<&HashMap<String, i32>>) {
    let Some(values) = values else {
        return;
    };
    let mut values: Vec<_> = values.iter().collect();
    values.sort_unstable_by(|left, right| left.0.cmp(right.0));
    for (service, replicas) in values {
        args.extend(["--scale".to_string(), format!("{}={}", service, replicas)]);
    }
}

fn add_interactive(args: &mut Vec<String>, interactive: Option<bool>) {
    match interactive {
        Some(true) => args.push("--interactive".to_string()),
        Some(false) => args.push("--interactive=false".to_string()),
        None => {}
    }
}

fn add_tty(args: &mut Vec<String>, tty: Option<bool>) {
    if tty == Some(false) {
        args.push("--no-TTY".to_string());
    }
}

fn bounded_timeout(value: Option<u64>, default_seconds: u64) -> ComposeResult<Duration> {
    let seconds = value.unwrap_or(default_seconds);
    if !(1..=3600).contains(&seconds) {
        return Err(ComposeError::validation(
            "Docker Compose timeout must be between 1 and 3600 seconds",
        ));
    }
    Ok(Duration::from_secs(seconds))
}

fn map_process_error(error: ProcessBoundaryError) -> ComposeError {
    match error {
        ProcessBoundaryError::ExecutableUnavailable | ProcessBoundaryError::SpawnFailed => {
            ComposeError::not_available("Docker Compose executable is unavailable")
        }
        ProcessBoundaryError::InvalidEnvironment => ComposeError::validation(
            "Docker Compose environment was rejected by the process safety boundary",
        ),
        ProcessBoundaryError::InvalidTimeout => {
            ComposeError::validation("Docker Compose timeout is invalid")
        }
        ProcessBoundaryError::TimedOut => {
            ComposeError::timeout("Docker Compose command exceeded its execution deadline")
        }
        ProcessBoundaryError::ProcessTreeUnavailable
        | ProcessBoundaryError::MonitorFailed
        | ProcessBoundaryError::CaptureFailed => ComposeError::command(
            "Docker Compose command could not be executed through the process safety boundary",
        ),
    }
}

fn parse_ps_output(output: &str) -> ComposeResult<Vec<ComposePsItem>> {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    if let Ok(items) = serde_json::from_str::<Vec<ComposePsItem>>(trimmed) {
        return Ok(items);
    }

    trimmed
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            serde_json::from_str::<ComposePsItem>(line).map_err(|_| {
                ComposeError::parse("Docker Compose process output was not valid JSON")
            })
        })
        .collect()
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "PascalCase")]
struct RawComposeProject {
    #[serde(alias = "name")]
    name: String,
    #[serde(alias = "status")]
    status: String,
    #[serde(alias = "configFiles", default)]
    config_files: String,
}

impl From<RawComposeProject> for ComposeProject {
    fn from(project: RawComposeProject) -> Self {
        Self {
            name: project.name,
            status: project.status,
            config_files: project.config_files,
        }
    }
}

fn parse_project_output(output: &str) -> ComposeResult<Vec<ComposeProject>> {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    if let Ok(projects) = serde_json::from_str::<Vec<RawComposeProject>>(trimmed) {
        return Ok(projects.into_iter().map(ComposeProject::from).collect());
    }

    trimmed
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            serde_json::from_str::<RawComposeProject>(line)
                .map(ComposeProject::from)
                .map_err(|_| {
                    ComposeError::parse("Docker Compose project output was not valid JSON")
                })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;
    use std::io::Write;
    use std::thread;

    #[test]
    fn rm_without_force_does_not_add_force() {
        let args = rm_args(&ComposeRmConfig::default());
        assert!(!args.iter().any(|arg| arg == "--force"));
    }

    #[test]
    fn rm_with_explicit_false_does_not_add_force() {
        let config = ComposeRmConfig {
            force: Some(false),
            ..ComposeRmConfig::default()
        };
        let args = rm_args(&config);
        assert!(!args.iter().any(|arg| arg == "--force"));
    }

    #[test]
    fn rm_with_explicit_true_adds_force() {
        let config = ComposeRmConfig {
            force: Some(true),
            ..ComposeRmConfig::default()
        };
        let args = rm_args(&config);
        assert!(args.iter().any(|arg| arg == "--force"));
    }

    #[test]
    fn run_environment_value_is_not_exposed_in_arguments() {
        let secret = "secret-not-in-argv".to_string();
        let config = ComposeRunConfig {
            service: "worker".to_string(),
            environment: Some(HashMap::from([("APP_TOKEN".to_string(), secret.clone())])),
            ..ComposeRunConfig::default()
        };
        let (args, environment) = compose_run_invocation(&config).unwrap();
        assert!(!args.iter().any(|arg| arg.contains(&secret)));
        assert!(args.windows(2).any(|pair| pair == ["-e", "APP_TOKEN"]));
        assert_eq!(environment, vec![("APP_TOKEN".to_string(), secret)]);
    }

    #[test]
    fn invalid_environment_name_is_rejected() {
        let config = ComposeRunConfig {
            service: "worker".to_string(),
            environment: Some(HashMap::from([(
                "BAD-NAME".to_string(),
                "secret".to_string(),
            )])),
            ..ComposeRunConfig::default()
        };
        assert!(compose_run_invocation(&config).is_err());
    }

    #[test]
    fn compose_cli_process_helper() {
        let Some(mode) = env::var_os("SORNG_COMPOSE_CLI_TEST_MODE") else {
            return;
        };
        match mode.to_string_lossy().as_ref() {
            "hang" => thread::sleep(Duration::from_secs(30)),
            "flood" => {
                let payload = vec![b'x'; MAX_CAPTURE_BYTES + 1024];
                std::io::stdout().write_all(&payload).unwrap();
                std::io::stderr().write_all(&payload).unwrap();
            }
            _ => {}
        }
    }

    fn fake_cli() -> ComposeCli {
        ComposeCli {
            program: env::current_exe().unwrap(),
            prefix_args: vec![
                "compose_cli_process_helper".to_string(),
                "--exact".to_string(),
                "--nocapture".to_string(),
                "--test-threads=1".to_string(),
            ],
        }
    }

    #[test]
    fn hung_process_is_terminated_at_deadline() {
        let result = fake_cli().run_with_timeout(
            Vec::new(),
            vec![(
                "SORNG_COMPOSE_CLI_TEST_MODE".to_string(),
                "hang".to_string(),
            )],
            Duration::from_millis(100),
        );
        assert!(matches!(
            result,
            Err(ComposeError {
                kind: ComposeErrorKind::Timeout,
                ..
            })
        ));
    }

    #[test]
    fn flooded_output_returns_a_bounded_error() {
        let result = fake_cli().run_with_timeout(
            Vec::new(),
            vec![(
                "SORNG_COMPOSE_CLI_TEST_MODE".to_string(),
                "flood".to_string(),
            )],
            PROBE_TIMEOUT,
        );
        assert!(matches!(
            result,
            Err(ComposeError {
                kind: ComposeErrorKind::CommandFailed,
                ..
            })
        ));
    }
}
