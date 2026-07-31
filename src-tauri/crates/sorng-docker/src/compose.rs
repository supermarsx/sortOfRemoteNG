//! Docker Compose operations through a bounded, non-shell process boundary.

use crate::error::{DockerError, DockerResult};
use crate::types::*;

#[path = "../../sorng-compose-process.rs"]
mod compose_process_boundary;

use compose_process_boundary::{
    append_environment_passthrough, execute as execute_hardened_process,
    resolve_trusted_executable, ProcessBoundaryError, DEFAULT_OPERATION_TIMEOUT, MAX_CAPTURE_BYTES,
};

fn execute(
    program: &std::path::Path,
    args: &[String],
    environment: &[(String, String)],
    timeout: std::time::Duration,
    capture_limit: usize,
) -> Result<compose_process_boundary::ProcessOutput, ProcessBoundaryError> {
    execute_hardened_process(program, args, environment, None, timeout, capture_limit)
}

/// Stateless Docker Compose command manager.
pub struct ComposeManager;

impl ComposeManager {
    /// Returns whether a trusted Docker executable with Compose support is available.
    pub fn is_available() -> bool {
        Self::run(vec!["compose".into(), "version".into()], Vec::new()).is_ok()
    }

    /// Returns the installed Docker Compose version.
    pub fn version() -> DockerResult<String> {
        Self::run(
            vec!["compose".into(), "version".into(), "--short".into()],
            Vec::new(),
        )
        .map(|version| version.trim().to_string())
    }

    /// Lists Docker Compose projects known to Docker.
    pub fn list_projects() -> DockerResult<Vec<ComposeProject>> {
        let output = Self::run(
            vec![
                "compose".into(),
                "ls".into(),
                "--format".into(),
                "json".into(),
            ],
            Vec::new(),
        )?;
        let values: serde_json::Value = serde_json::from_str(&output)
            .map_err(|_| DockerError::parse("Invalid Compose project data"))?;
        let projects = values
            .as_array()
            .ok_or_else(|| DockerError::parse("Invalid Compose project data"))?;

        Ok(projects
            .iter()
            .map(|project| ComposeProject {
                name: json_string(project, "Name"),
                status: json_string(project, "Status"),
                config_files: json_string_list(project, "ConfigFiles"),
                services: Vec::new(),
            })
            .collect())
    }

    /// Starts services for a Compose project.
    pub fn up(config: &ComposeUpConfig) -> DockerResult<String> {
        let args = Self::up_args(config)?;
        Self::run(args, Vec::new())
    }

    /// Stops and removes a Compose project.
    pub fn down(config: &ComposeDownConfig) -> DockerResult<String> {
        let mut args = compose_prefix(&config.files, config.project_name.as_deref());
        args.push("down".into());
        push_bool_flag(&mut args, config.remove_orphans, "--remove-orphans");
        push_bool_flag(&mut args, config.volumes, "--volumes");
        push_option(&mut args, "--rmi", config.images.as_deref());
        push_timeout(&mut args, config.timeout)?;
        Self::run(args, Vec::new())
    }

    /// Lists containers belonging to a Compose project.
    pub fn ps(files: &[String], project_name: Option<&str>) -> DockerResult<Vec<ComposePsItem>> {
        let mut args = compose_prefix(files, project_name);
        args.extend(["ps".into(), "--format".into(), "json".into()]);
        let output = Self::run(args, Vec::new())?;

        Ok(output
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .map(|item| ComposePsItem {
                id: json_string(&item, "ID"),
                name: json_string(&item, "Name"),
                service: json_string(&item, "Service"),
                state: json_string(&item, "State"),
                health: json_optional_string(&item, "Health"),
                ports: json_string_list(&item, "Ports"),
                image: json_optional_string(&item, "Image"),
                command: json_optional_string(&item, "Command"),
                created_at: json_optional_string(&item, "CreatedAt"),
                exit_code: item
                    .get("ExitCode")
                    .and_then(serde_json::Value::as_i64)
                    .and_then(|value| i32::try_from(value).ok()),
            })
            .collect())
    }

    /// Retrieves a finite snapshot of Compose logs.
    pub fn logs(config: &ComposeLogsConfig) -> DockerResult<String> {
        if config.follow.unwrap_or(false) {
            return Err(DockerError::validation(
                "Streaming Compose logs is not supported by this bounded operation",
            ));
        }

        let mut args = compose_prefix(&config.files, config.project_name.as_deref());
        args.push("logs".into());
        push_bool_flag(&mut args, config.timestamps, "--timestamps");
        push_bool_flag(&mut args, config.no_color, "--no-color");
        push_option(&mut args, "--tail", config.tail.as_deref());
        push_option(&mut args, "--since", config.since.as_deref());
        push_option(&mut args, "--until", config.until.as_deref());
        push_services(&mut args, config.services.as_deref());
        Self::run(args, Vec::new())
    }

    /// Builds Compose services without placing build-argument values in argv.
    pub fn build(config: &ComposeBuildConfig) -> DockerResult<String> {
        let (args, environment) = Self::build_args(config)?;
        Self::run(args, environment)
    }

    /// Pulls images for Compose services.
    pub fn pull(config: &ComposePullConfig) -> DockerResult<String> {
        let mut args = compose_prefix(&config.files, config.project_name.as_deref());
        args.push("pull".into());
        push_bool_flag(&mut args, config.quiet, "--quiet");
        push_bool_flag(
            &mut args,
            config.ignore_pull_failures,
            "--ignore-pull-failures",
        );
        push_bool_flag(&mut args, config.include_deps, "--include-deps");
        push_services(&mut args, config.services.as_deref());
        Self::run(args, Vec::new())
    }

    /// Restarts selected or all Compose services.
    pub fn restart(
        files: &[String],
        project_name: Option<&str>,
        services: Option<&[String]>,
        timeout: Option<i32>,
    ) -> DockerResult<String> {
        let mut args = compose_prefix(files, project_name);
        args.push("restart".into());
        push_timeout(&mut args, timeout)?;
        push_services(&mut args, services);
        Self::run(args, Vec::new())
    }

    /// Stops selected or all Compose services.
    pub fn stop(
        files: &[String],
        project_name: Option<&str>,
        services: Option<&[String]>,
        timeout: Option<i32>,
    ) -> DockerResult<String> {
        let mut args = compose_prefix(files, project_name);
        args.push("stop".into());
        push_timeout(&mut args, timeout)?;
        push_services(&mut args, services);
        Self::run(args, Vec::new())
    }

    /// Starts selected or all stopped Compose services.
    pub fn start(
        files: &[String],
        project_name: Option<&str>,
        services: Option<&[String]>,
    ) -> DockerResult<String> {
        let mut args = compose_prefix(files, project_name);
        args.push("start".into());
        push_services(&mut args, services);
        Self::run(args, Vec::new())
    }

    /// Renders the resolved Compose configuration.
    pub fn config(files: &[String], project_name: Option<&str>) -> DockerResult<String> {
        let mut args = compose_prefix(files, project_name);
        args.push("config".into());
        Self::run(args, Vec::new())
    }

    fn up_args(config: &ComposeUpConfig) -> DockerResult<Vec<String>> {
        let mut args = compose_prefix(&config.files, config.project_name.as_deref());
        args.push("up".into());
        if config.detach.unwrap_or(true) {
            args.push("--detach".into());
        }
        push_bool_flag(&mut args, config.build, "--build");
        push_bool_flag(&mut args, config.force_recreate, "--force-recreate");
        push_bool_flag(&mut args, config.no_recreate, "--no-recreate");
        push_bool_flag(&mut args, config.remove_orphans, "--remove-orphans");
        push_bool_flag(&mut args, config.no_deps, "--no-deps");
        push_bool_flag(&mut args, config.wait, "--wait");
        push_bool_flag(&mut args, config.quiet_pull, "--quiet-pull");
        push_timeout(&mut args, config.timeout)?;
        push_option(&mut args, "--pull", config.pull.as_deref());

        if let Some(profiles) = config.profiles.as_deref() {
            for profile in profiles {
                args.extend(["--profile".into(), profile.clone()]);
            }
        }
        if let Some(scale) = config.scale.as_ref() {
            let mut services: Vec<(&String, &i32)> = scale.iter().collect();
            services.sort_unstable_by(|left, right| left.0.cmp(right.0));
            for (service, replicas) in services {
                if *replicas < 0 {
                    return Err(DockerError::validation("Compose scale cannot be negative"));
                }
                args.extend(["--scale".into(), format!("{service}={replicas}")]);
            }
        }
        if let Some(env_files) = config.env_file.as_deref() {
            for env_file in env_files {
                args.extend(["--env-file".into(), env_file.clone()]);
            }
        }
        push_services(&mut args, config.services.as_deref());
        Ok(args)
    }

    fn build_args(
        config: &ComposeBuildConfig,
    ) -> DockerResult<(Vec<String>, Vec<(String, String)>)> {
        let mut args = compose_prefix(&config.files, config.project_name.as_deref());
        args.push("build".into());
        push_bool_flag(&mut args, config.no_cache, "--no-cache");
        push_bool_flag(&mut args, config.pull, "--pull");
        push_bool_flag(&mut args, config.quiet, "--quiet");
        push_option(&mut args, "--progress", config.progress.as_deref());

        let environment = match config.build_args.as_ref() {
            Some(build_args) => {
                append_environment_passthrough(&mut args, build_args, "--build-arg")
                    .map_err(map_process_error)?
            }
            None => Vec::new(),
        };
        push_services(&mut args, config.services.as_deref());
        Ok((args, environment))
    }

    fn run(args: Vec<String>, environment: Vec<(String, String)>) -> DockerResult<String> {
        let docker = resolve_trusted_executable("docker").map_err(map_process_error)?;
        let output = execute(
            &docker,
            &args,
            &environment,
            DEFAULT_OPERATION_TIMEOUT,
            MAX_CAPTURE_BYTES,
        )
        .map_err(map_process_error)?;

        if !output.status.success() {
            return Err(DockerError::compose("Docker Compose command failed"));
        }
        if output.stdout.truncated {
            return Err(DockerError::compose(
                "Docker Compose output exceeded the safety limit",
            ));
        }

        String::from_utf8(output.stdout.bytes)
            .map_err(|_| DockerError::parse("Invalid Docker Compose output"))
    }
}

fn compose_prefix(files: &[String], project_name: Option<&str>) -> Vec<String> {
    let mut args = vec!["compose".into()];
    for file in files {
        args.extend(["-f".into(), file.clone()]);
    }
    if let Some(project_name) = project_name {
        args.extend(["-p".into(), project_name.to_string()]);
    }
    args
}

fn push_bool_flag(args: &mut Vec<String>, enabled: Option<bool>, flag: &str) {
    if enabled.unwrap_or(false) {
        args.push(flag.to_string());
    }
}

fn push_option(args: &mut Vec<String>, flag: &str, value: Option<&str>) {
    if let Some(value) = value {
        args.extend([flag.to_string(), value.to_string()]);
    }
}

fn push_services(args: &mut Vec<String>, services: Option<&[String]>) {
    if let Some(services) = services {
        args.extend(services.iter().cloned());
    }
}

fn push_timeout(args: &mut Vec<String>, timeout: Option<i32>) -> DockerResult<()> {
    if let Some(timeout) = timeout {
        if timeout < 0 {
            return Err(DockerError::validation(
                "Compose timeout cannot be negative",
            ));
        }
        args.extend(["--timeout".into(), timeout.to_string()]);
    }
    Ok(())
}

fn map_process_error(error: ProcessBoundaryError) -> DockerError {
    match error {
        ProcessBoundaryError::TimedOut => DockerError::timeout("Docker Compose command timed out"),
        ProcessBoundaryError::InvalidEnvironment => {
            DockerError::validation("Invalid Docker Compose environment")
        }
        ProcessBoundaryError::InvalidTimeout => {
            DockerError::validation("Invalid Docker Compose timeout")
        }
        ProcessBoundaryError::ExecutableUnavailable => {
            DockerError::compose("Docker executable is unavailable")
        }
        ProcessBoundaryError::SpawnFailed
        | ProcessBoundaryError::ProcessTreeUnavailable
        | ProcessBoundaryError::MonitorFailed
        | ProcessBoundaryError::CaptureFailed => {
            DockerError::compose("Docker Compose command could not be executed")
        }
    }
}

fn json_string(value: &serde_json::Value, name: &str) -> String {
    value
        .get(name)
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn json_optional_string(value: &serde_json::Value, name: &str) -> Option<String> {
    value
        .get(name)
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn json_string_list(value: &serde_json::Value, name: &str) -> Vec<String> {
    match value.get(name) {
        Some(serde_json::Value::Array(values)) => values
            .iter()
            .filter_map(serde_json::Value::as_str)
            .map(str::to_string)
            .collect(),
        Some(serde_json::Value::String(values)) => values
            .split(',')
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .collect(),
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::env;
    use std::io::Write;
    use std::thread;
    use std::time::{Duration, Instant};

    #[test]
    fn build_argument_values_are_absent_from_argv() {
        let secret = "compose-build-secret-that-must-not-enter-argv".to_string();
        let config = ComposeBuildConfig {
            build_args: Some(HashMap::from([("APP_TOKEN".to_string(), secret.clone())])),
            ..ComposeBuildConfig::default()
        };

        let (args, environment) = ComposeManager::build_args(&config).unwrap();
        assert!(!args.iter().any(|arg| arg.contains(&secret)));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--build-arg", "APP_TOKEN"]));
        assert_eq!(environment, vec![("APP_TOKEN".to_string(), secret)]);
    }

    #[test]
    fn compose_fake_process_helper() {
        let Some(mode) = env::var_os("SORNG_COMPOSE_PROCESS_TEST_MODE") else {
            return;
        };
        match mode.to_string_lossy().as_ref() {
            "hang" => thread::sleep(Duration::from_secs(30)),
            "flood" => {
                let payload = vec![b'x'; 32 * 1024];
                std::io::stdout().write_all(&payload).unwrap();
                std::io::stderr().write_all(&payload).unwrap();
            }
            _ => {}
        }
    }

    fn run_fake_process(
        mode: &str,
        timeout: Duration,
        capture_limit: usize,
    ) -> Result<compose_process_boundary::ProcessOutput, ProcessBoundaryError> {
        let executable = env::current_exe().unwrap();
        let args = vec![
            "compose_fake_process_helper".to_string(),
            "--nocapture".to_string(),
            "--test-threads=1".to_string(),
        ];
        let environment = vec![(
            "SORNG_COMPOSE_PROCESS_TEST_MODE".to_string(),
            mode.to_string(),
        )];
        execute(&executable, &args, &environment, timeout, capture_limit)
    }

    #[test]
    fn current_executable_hang_times_out_and_is_reaped() {
        let started = Instant::now();
        assert!(matches!(
            run_fake_process("hang", Duration::from_millis(100), 1024),
            Err(ProcessBoundaryError::TimedOut)
        ));
        assert!(started.elapsed() < Duration::from_secs(4));
    }

    #[test]
    fn fake_process_output_is_bounded() {
        let output = run_fake_process("flood", Duration::from_secs(3), 1024).unwrap();
        assert_eq!(output.stdout.bytes.len(), 1024);
        assert_eq!(output.stderr.bytes.len(), 1024);
        assert!(output.stdout.truncated);
        assert!(output.stderr.truncated);
    }
}
