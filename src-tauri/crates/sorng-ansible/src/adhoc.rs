// ── sorng-ansible/src/adhoc.rs ───────────────────────────────────────────────
//! Ad-hoc command execution — `ansible <pattern> -m <module> -a <args>`.

use chrono::Utc;
use log::debug;
use uuid::Uuid;

use crate::client::AnsibleClient;
use crate::error::AnsibleResult;
use crate::types::*;

/// Ad-hoc command runner.
pub struct AdHocManager;

impl AdHocManager {
    /// Execute an ad-hoc command.
    pub async fn run(
        client: &AnsibleClient,
        options: &AdHocOptions,
    ) -> AnsibleResult<ExecutionResult> {
        let started_at = Utc::now();
        let exec_id = Uuid::new_v4().to_string();

        let args = Self::build_args(options);
        let command_str = format!("ansible {}", args.join(" "));
        debug!("Executing ad-hoc: {}", command_str);

        let output = client.run_ansible(&args).await?;

        let finished_at = Utc::now();
        let duration = (finished_at - started_at).num_milliseconds() as f64 / 1000.0;

        let stats = Self::parse_ad_hoc_stats(&output.stdout);
        let host_results = Self::parse_ad_hoc_results(&output.stdout);

        let status = if output.exit_code == 0 {
            ExecutionStatus::Success
        } else if output.exit_code == 3 {
            // Exit code 3 = one or more hosts unreachable
            ExecutionStatus::Unreachable
        } else if output.exit_code == 4 {
            ExecutionStatus::Unreachable
        } else {
            ExecutionStatus::Failed
        };

        Ok(ExecutionResult {
            id: exec_id,
            status,
            started_at,
            finished_at: Some(finished_at),
            duration_secs: Some(duration),
            host_results,
            stats,
            stdout: output.stdout,
            stderr: output.stderr,
            exit_code: Some(output.exit_code),
            command: command_str,
        })
    }

    /// Run a quick ping check against a pattern.
    pub async fn ping(
        client: &AnsibleClient,
        pattern: &str,
        inventory: Option<&str>,
    ) -> AnsibleResult<ExecutionResult> {
        let options = AdHocOptions {
            pattern: pattern.to_string(),
            module: "ping".to_string(),
            module_args: None,
            inventory: inventory.map(|s| s.to_string()),
            use_become: None,
            become_user: None,
            become_method: None,
            remote_user: None,
            private_key: None,
            forks: None,
            extra_vars: std::collections::HashMap::new(),
            timeout_secs: Some(10),
            poll: None,
            background: None,
            one_line: true,
            tree: None,
            vault_password_file: None,
            verbosity: None,
            env_vars: std::collections::HashMap::new(),
        };

        Self::run(client, &options).await
    }

    /// Execute a shell command on remote hosts.
    pub async fn shell(
        client: &AnsibleClient,
        pattern: &str,
        command: &str,
        inventory: Option<&str>,
        use_become: bool,
    ) -> AnsibleResult<ExecutionResult> {
        let options = AdHocOptions {
            pattern: pattern.to_string(),
            module: "shell".to_string(),
            module_args: Some(command.to_string()),
            inventory: inventory.map(|s| s.to_string()),
            use_become: Some(use_become),
            become_user: None,
            become_method: None,
            remote_user: None,
            private_key: None,
            forks: None,
            extra_vars: std::collections::HashMap::new(),
            timeout_secs: None,
            poll: None,
            background: None,
            one_line: false,
            tree: None,
            vault_password_file: None,
            verbosity: None,
            env_vars: std::collections::HashMap::new(),
        };

        Self::run(client, &options).await
    }

    /// Copy a file to remote hosts.
    pub async fn copy_file(
        client: &AnsibleClient,
        pattern: &str,
        src: &str,
        dest: &str,
        inventory: Option<&str>,
        use_become: bool,
    ) -> AnsibleResult<ExecutionResult> {
        let options = AdHocOptions {
            pattern: pattern.to_string(),
            module: "copy".to_string(),
            module_args: Some(format!("src={} dest={}", src, dest)),
            inventory: inventory.map(|s| s.to_string()),
            use_become: Some(use_become),
            become_user: None,
            become_method: None,
            remote_user: None,
            private_key: None,
            forks: None,
            extra_vars: std::collections::HashMap::new(),
            timeout_secs: None,
            poll: None,
            background: None,
            one_line: false,
            tree: None,
            vault_password_file: None,
            verbosity: None,
            env_vars: std::collections::HashMap::new(),
        };

        Self::run(client, &options).await
    }

    /// Manage a service on remote hosts.
    pub async fn service_action(
        client: &AnsibleClient,
        pattern: &str,
        service_name: &str,
        state: &str,
        inventory: Option<&str>,
    ) -> AnsibleResult<ExecutionResult> {
        let options = AdHocOptions {
            pattern: pattern.to_string(),
            module: "service".to_string(),
            module_args: Some(format!("name={} state={}", service_name, state)),
            inventory: inventory.map(|s| s.to_string()),
            use_become: Some(true),
            become_user: None,
            become_method: None,
            remote_user: None,
            private_key: None,
            forks: None,
            extra_vars: std::collections::HashMap::new(),
            timeout_secs: None,
            poll: None,
            background: None,
            one_line: false,
            tree: None,
            vault_password_file: None,
            verbosity: None,
            env_vars: std::collections::HashMap::new(),
        };

        Self::run(client, &options).await
    }

    /// Install / remove a package.
    pub async fn package_action(
        client: &AnsibleClient,
        pattern: &str,
        package_name: &str,
        state: &str,
        inventory: Option<&str>,
    ) -> AnsibleResult<ExecutionResult> {
        let options = AdHocOptions {
            pattern: pattern.to_string(),
            module: "package".to_string(),
            module_args: Some(format!("name={} state={}", package_name, state)),
            inventory: inventory.map(|s| s.to_string()),
            use_become: Some(true),
            become_user: None,
            become_method: None,
            remote_user: None,
            private_key: None,
            forks: None,
            extra_vars: std::collections::HashMap::new(),
            timeout_secs: None,
            poll: None,
            background: None,
            one_line: false,
            tree: None,
            vault_password_file: None,
            verbosity: None,
            env_vars: std::collections::HashMap::new(),
        };

        Self::run(client, &options).await
    }

    // ── Arg building ─────────────────────────────────────────────────

    fn build_args(options: &AdHocOptions) -> Vec<String> {
        let mut args = Vec::new();

        args.push(options.pattern.clone());

        args.push("-m".to_string());
        args.push(options.module.clone());

        if let Some(ref module_args) = options.module_args {
            args.push("-a".to_string());
            args.push(module_args.clone());
        }

        if let Some(ref inv) = options.inventory {
            args.push("-i".to_string());
            args.push(inv.clone());
        }

        if let Some(use_become) = options.use_become {
            if use_become {
                args.push("--become".to_string());
            }
        }

        if let Some(ref user) = options.become_user {
            args.push("--become-user".to_string());
            args.push(user.clone());
        }

        if let Some(ref method) = options.become_method {
            args.push("--become-method".to_string());
            args.push(method.clone());
        }

        if let Some(ref user) = options.remote_user {
            args.push("--user".to_string());
            args.push(user.clone());
        }

        if let Some(ref key) = options.private_key {
            args.push("--private-key".to_string());
            args.push(key.clone());
        }

        if let Some(forks) = options.forks {
            args.push("--forks".to_string());
            args.push(forks.to_string());
        }

        for (k, v) in &options.extra_vars {
            args.push("-e".to_string());
            args.push(format!("{}={}", k, v));
        }

        if let Some(timeout) = options.timeout_secs {
            args.push("--timeout".to_string());
            args.push(timeout.to_string());
        }

        if let Some(poll) = options.poll {
            args.push("--poll".to_string());
            args.push(poll.to_string());
        }

        if let Some(bg) = options.background {
            args.push("--background".to_string());
            args.push(bg.to_string());
        }

        if options.one_line {
            args.push("--one-line".to_string());
        }

        if let Some(ref tree) = options.tree {
            args.push("--tree".to_string());
            args.push(tree.clone());
        }

        if let Some(ref vf) = options.vault_password_file {
            args.push("--vault-password-file".to_string());
            args.push(vf.clone());
        }

        if let Some(verb) = options.verbosity {
            if verb > 0 {
                args.push(format!("-{}", "v".repeat(verb as usize)));
            }
        }

        args
    }

    // ── Output parsing ───────────────────────────────────────────────

    fn parse_ad_hoc_stats(output: &str) -> PlayStats {
        // Ad-hoc output may include a PLAY RECAP, reuse the same parser.
        // If no recap found, try to count statuses directly.
        let mut ok = 0u32;
        let mut changed = 0u32;
        let mut failed = 0u32;
        let mut unreachable = 0u32;

        let re = regex::Regex::new(r"^(.+?)\s*\|\s*(SUCCESS|CHANGED|FAILED|UNREACHABLE)").unwrap();
        for line in output.lines() {
            if let Some(caps) = re.captures(line) {
                match &caps[2] {
                    "SUCCESS" => ok += 1,
                    "CHANGED" => changed += 1,
                    "FAILED" => failed += 1,
                    "UNREACHABLE" => unreachable += 1,
                    _ => {}
                }
            }
        }

        PlayStats {
            ok,
            changed,
            unreachable,
            failed,
            skipped: 0,
            rescued: 0,
            ignored: 0,
        }
    }

    fn parse_ad_hoc_results(output: &str) -> Vec<HostResult> {
        let mut results: Vec<HostResult> = Vec::new();

        let re = regex::Regex::new(
            r"^(.+?)\s*\|\s*(SUCCESS|CHANGED|FAILED|UNREACHABLE)\s*(?:\|\s*rc=(\d+))?\s*>>\s*$",
        )
        .unwrap();
        let simple_re =
            regex::Regex::new(r"^(.+?)\s*\|\s*(SUCCESS|CHANGED|FAILED|UNREACHABLE)").unwrap();

        for line in output.lines() {
            let (host, status_str) = if let Some(caps) = re.captures(line) {
                (caps[1].trim().to_string(), caps[2].to_string())
            } else if let Some(caps) = simple_re.captures(line) {
                (caps[1].trim().to_string(), caps[2].to_string())
            } else {
                continue;
            };

            let (status, changed, failed) = match status_str.as_str() {
                "SUCCESS" => (HostStatus::Ok, false, false),
                "CHANGED" => (HostStatus::Changed, true, false),
                "FAILED" => (HostStatus::Failed, false, true),
                "UNREACHABLE" => (HostStatus::Unreachable, false, true),
                _ => (HostStatus::Ok, false, false),
            };

            results.push(HostResult {
                host: host.clone(),
                status,
                task_results: vec![TaskResult {
                    task_name: "ad-hoc".to_string(),
                    module: "unknown".to_string(),
                    status: if failed {
                        HostStatus::Failed
                    } else if changed {
                        HostStatus::Changed
                    } else {
                        HostStatus::Ok
                    },
                    changed,
                    msg: None,
                    stdout: None,
                    stderr: None,
                    rc: None,
                    start_time: None,
                    end_time: None,
                    diff: None,
                    items: Vec::new(),
                    skipped: false,
                    skip_reason: None,
                    failed,
                    failure_reason: None,
                }],
                facts: None,
            });
        }

        results
    }
}
