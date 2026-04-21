// ── sorng-ansible/src/playbooks.rs ───────────────────────────────────────────
//! Playbook parsing, validation, execution (normal / check / diff), and
//! output processing.

use std::collections::HashMap;

use chrono::Utc;
use log::{debug, warn};
use regex::Regex;
use uuid::Uuid;

use crate::client::AnsibleClient;
use crate::error::{AnsibleError, AnsibleResult};
use crate::types::*;

/// Playbook management operations.
pub struct PlaybookManager;

impl PlaybookManager {
    // ── Parsing ──────────────────────────────────────────────────────

    /// Parse a playbook YAML file into structured types.
    pub async fn parse(path: &str) -> AnsibleResult<Playbook> {
        let raw = tokio::fs::read_to_string(path)
            .await
            .map_err(|e| AnsibleError::io(format!("Cannot read playbook {}: {}", path, e)))?;

        let metadata = tokio::fs::metadata(path).await.ok();
        let file_size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
        let last_modified = metadata
            .and_then(|m| m.modified().ok())
            .map(chrono::DateTime::<Utc>::from);

        let plays_raw: Vec<serde_yaml::Value> = serde_yaml::from_str(&raw)?;

        let plays: Vec<Play> = plays_raw
            .into_iter()
            .map(Self::parse_play)
            .collect::<AnsibleResult<Vec<Play>>>()?;

        let name = std::path::Path::new(path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| path.to_string());

        Ok(Playbook {
            path: path.to_string(),
            name,
            plays,
            raw_yaml: Some(raw),
            file_size,
            last_modified,
        })
    }

    /// List playbook files in a directory.
    pub async fn list_in_directory(dir: &str) -> AnsibleResult<Vec<String>> {
        let mut entries = tokio::fs::read_dir(dir)
            .await
            .map_err(|e| AnsibleError::io(format!("Cannot read directory {}: {}", dir, e)))?;

        let mut playbooks = Vec::new();
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if let Some(ext) = path.extension() {
                let ext_str = ext.to_string_lossy().to_lowercase();
                if (ext_str == "yml" || ext_str == "yaml")
                    && !path
                        .file_name()
                        .map(|n| n.to_string_lossy().starts_with('.'))
                        .unwrap_or(false)
                {
                    playbooks.push(path.to_string_lossy().to_string());
                }
            }
        }

        playbooks.sort();
        Ok(playbooks)
    }

    // ── Validation ───────────────────────────────────────────────────

    /// Syntax-check a playbook via `ansible-playbook --syntax-check`.
    pub async fn syntax_check(
        client: &AnsibleClient,
        playbook_path: &str,
    ) -> AnsibleResult<PlaybookValidation> {
        let output = client
            .run_playbook(&["--syntax-check".to_string(), playbook_path.to_string()])
            .await?;

        let valid = output.exit_code == 0;
        let mut errors = Vec::new();
        let mut warnings = Vec::new();

        for line in output.stderr.lines().chain(output.stdout.lines()) {
            let trimmed = line.trim();
            if trimmed.contains("ERROR!") || trimmed.contains("error:") {
                errors.push(PlaybookIssue {
                    line: Self::extract_line_number(trimmed),
                    column: None,
                    message: trimmed.to_string(),
                    severity: IssueSeverity::Error,
                    rule: None,
                });
            } else if trimmed.contains("WARNING") || trimmed.contains("warning:") {
                warnings.push(PlaybookIssue {
                    line: Self::extract_line_number(trimmed),
                    column: None,
                    message: trimmed.to_string(),
                    severity: IssueSeverity::Warning,
                    rule: None,
                });
            }
        }

        Ok(PlaybookValidation {
            valid,
            errors,
            warnings,
        })
    }

    /// Validate a playbook with ansible-lint if available.
    pub async fn lint(
        client: &AnsibleClient,
        playbook_path: &str,
    ) -> AnsibleResult<PlaybookValidation> {
        let lint_result = client
            .run_raw("ansible-lint", &["-p", "--nocolor", playbook_path])
            .await;

        match lint_result {
            Ok(output) => {
                let valid = output.exit_code == 0;
                let mut errors = Vec::new();
                let mut warnings = Vec::new();

                let re = Regex::new(r"^(.+):(\d+):\s+(.+)$").expect("valid regex literal");
                for line in output.stdout.lines() {
                    if let Some(caps) = re.captures(line) {
                        let line_num = caps[2].parse::<u32>().ok();
                        let msg = caps[3].to_string();
                        let severity = if output.exit_code != 0 {
                            IssueSeverity::Error
                        } else {
                            IssueSeverity::Warning
                        };

                        let issue = PlaybookIssue {
                            line: line_num,
                            column: None,
                            message: msg.clone(),
                            severity: severity.clone(),
                            rule: Self::extract_rule(&msg),
                        };

                        match severity {
                            IssueSeverity::Error => errors.push(issue),
                            _ => warnings.push(issue),
                        }
                    }
                }

                Ok(PlaybookValidation {
                    valid,
                    errors,
                    warnings,
                })
            }
            Err(_) => {
                warn!("ansible-lint not available, falling back to syntax check");
                Self::syntax_check(client, playbook_path).await
            }
        }
    }

    // ── Execution ────────────────────────────────────────────────────

    /// Run a playbook with the given options.
    pub async fn run(
        client: &AnsibleClient,
        options: &PlaybookRunOptions,
    ) -> AnsibleResult<ExecutionResult> {
        let started_at = Utc::now();
        let exec_id = Uuid::new_v4().to_string();

        let args = Self::build_playbook_args(options);
        let command_str = format!("ansible-playbook {}", args.join(" "));
        debug!("Executing: {}", command_str);

        let output = client.run_playbook(&args).await?;

        let finished_at = Utc::now();
        let duration = (finished_at - started_at).num_milliseconds() as f64 / 1000.0;

        let stats = Self::parse_play_recap(&output.stdout);
        let host_results = Self::parse_host_results(&output.stdout);

        let status = if output.exit_code == 0 {
            ExecutionStatus::Success
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

    /// Dry-run a playbook in check mode.
    pub async fn check(
        client: &AnsibleClient,
        options: &PlaybookRunOptions,
    ) -> AnsibleResult<ExecutionResult> {
        let mut check_opts = options.clone();
        check_opts.check_mode = true;
        Self::run(client, &check_opts).await
    }

    /// Run with diff mode enabled.
    pub async fn diff(
        client: &AnsibleClient,
        options: &PlaybookRunOptions,
    ) -> AnsibleResult<ExecutionResult> {
        let mut diff_opts = options.clone();
        diff_opts.diff_mode = true;
        Self::run(client, &diff_opts).await
    }

    // ── Arg building ─────────────────────────────────────────────────

    fn build_playbook_args(options: &PlaybookRunOptions) -> Vec<String> {
        let mut args = Vec::new();

        if let Some(ref inv) = options.inventory {
            args.push("-i".to_string());
            args.push(inv.clone());
        }

        if let Some(ref limit) = options.limit {
            args.push("--limit".to_string());
            args.push(limit.clone());
        }

        for tag in &options.tags {
            args.push("--tags".to_string());
            args.push(tag.clone());
        }

        for skip in &options.skip_tags {
            args.push("--skip-tags".to_string());
            args.push(skip.clone());
        }

        for (k, v) in &options.extra_vars {
            args.push("-e".to_string());
            args.push(format!("{}={}", k, v));
        }

        for f in &options.extra_vars_files {
            args.push("-e".to_string());
            args.push(format!("@{}", f));
        }

        if let Some(forks) = options.forks {
            args.push("--forks".to_string());
            args.push(forks.to_string());
        }

        if options.check_mode {
            args.push("--check".to_string());
        }

        if options.diff_mode {
            args.push("--diff".to_string());
        }

        if let Some(ref task) = options.start_at_task {
            args.push("--start-at-task".to_string());
            args.push(task.clone());
        }

        if options.step {
            args.push("--step".to_string());
        }

        if options.flush_cache {
            args.push("--flush-cache".to_string());
        }

        if options.force_handlers {
            args.push("--force-handlers".to_string());
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

        if let Some(ref ssh_args) = options.ssh_common_args {
            args.push("--ssh-common-args".to_string());
            args.push(ssh_args.clone());
        }

        if let Some(timeout) = options.timeout_secs {
            args.push("--timeout".to_string());
            args.push(timeout.to_string());
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

        args.push(options.playbook_path.clone());

        args
    }

    // ── Output parsing ───────────────────────────────────────────────

    fn parse_play_recap(output: &str) -> PlayStats {
        let mut stats = PlayStats {
            ok: 0,
            changed: 0,
            unreachable: 0,
            failed: 0,
            skipped: 0,
            rescued: 0,
            ignored: 0,
        };

        let re = Regex::new(
            r"ok=(\d+)\s+changed=(\d+)\s+unreachable=(\d+)\s+failed=(\d+)\s*(?:skipped=(\d+))?\s*(?:rescued=(\d+))?\s*(?:ignored=(\d+))?"
        ).expect("valid regex literal");

        for line in output.lines() {
            if let Some(caps) = re.captures(line) {
                stats.ok += caps[1].parse::<u32>().unwrap_or(0);
                stats.changed += caps[2].parse::<u32>().unwrap_or(0);
                stats.unreachable += caps[3].parse::<u32>().unwrap_or(0);
                stats.failed += caps[4].parse::<u32>().unwrap_or(0);
                stats.skipped += caps
                    .get(5)
                    .and_then(|m| m.as_str().parse().ok())
                    .unwrap_or(0);
                stats.rescued += caps
                    .get(6)
                    .and_then(|m| m.as_str().parse().ok())
                    .unwrap_or(0);
                stats.ignored += caps
                    .get(7)
                    .and_then(|m| m.as_str().parse().ok())
                    .unwrap_or(0);
            }
        }

        stats
    }

    fn parse_host_results(output: &str) -> Vec<HostResult> {
        let mut results: HashMap<String, HostResult> = HashMap::new();

        // Match "TASK [name]" section followed by host-level results.
        let task_re = Regex::new(r"^TASK\s+\[(.+)\]").expect("valid regex literal");
        let result_re =
            Regex::new(r"^(ok|changed|fatal|skipping|unreachable):\s+\[(.+?)\]").expect("valid regex literal");

        let mut current_task: Option<String> = None;

        for line in output.lines() {
            if let Some(caps) = task_re.captures(line) {
                current_task = Some(caps[1].to_string());
                continue;
            }

            if let Some(caps) = result_re.captures(line) {
                let status_str = &caps[1];
                let host = caps[2].to_string();
                let task_name = current_task
                    .clone()
                    .unwrap_or_else(|| "unknown".to_string());

                let (host_status, changed, failed, skipped) = match status_str {
                    "ok" => (HostStatus::Ok, false, false, false),
                    "changed" => (HostStatus::Changed, true, false, false),
                    "fatal" | "unreachable" => (HostStatus::Failed, false, true, false),
                    "skipping" => (HostStatus::Skipped, false, false, true),
                    _ => (HostStatus::Ok, false, false, false),
                };

                let task_result = TaskResult {
                    task_name: task_name.clone(),
                    module: "unknown".to_string(),
                    status: host_status.clone(),
                    changed,
                    msg: None,
                    stdout: None,
                    stderr: None,
                    rc: None,
                    start_time: None,
                    end_time: None,
                    diff: None,
                    items: Vec::new(),
                    skipped,
                    skip_reason: None,
                    failed,
                    failure_reason: None,
                };

                let entry = results.entry(host.clone()).or_insert_with(|| HostResult {
                    host: host.clone(),
                    status: HostStatus::Ok,
                    task_results: Vec::new(),
                    facts: None,
                });

                entry.task_results.push(task_result);

                // Update overall host status (worst wins)
                match host_status {
                    HostStatus::Failed | HostStatus::Unreachable => {
                        entry.status = host_status;
                    }
                    HostStatus::Changed if entry.status == HostStatus::Ok => {
                        entry.status = HostStatus::Changed;
                    }
                    _ => {}
                }
            }
        }

        results.into_values().collect()
    }

    // ── Play parsing helpers ─────────────────────────────────────────

    fn parse_play(value: serde_yaml::Value) -> AnsibleResult<Play> {
        let mapping = value
            .as_mapping()
            .ok_or_else(|| AnsibleError::playbook("Play is not a mapping"))?;

        let get_str = |key: &str| -> Option<String> {
            mapping
                .get(serde_yaml::Value::String(key.into()))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        };

        let get_bool = |key: &str| -> Option<bool> {
            mapping
                .get(serde_yaml::Value::String(key.into()))
                .and_then(|v| v.as_bool())
        };

        let hosts = get_str("hosts").unwrap_or_else(|| "all".to_string());

        Ok(Play {
            name: get_str("name"),
            hosts,
            use_become: get_bool("become"),
            become_user: get_str("become_user"),
            become_method: get_str("become_method"),
            gather_facts: get_bool("gather_facts"),
            strategy: get_str("strategy"),
            serial: mapping
                .get(serde_yaml::Value::String("serial".into()))
                .map(|v| serde_json::to_value(v).unwrap_or_default()),
            max_fail_percentage: mapping
                .get(serde_yaml::Value::String("max_fail_percentage".into()))
                .and_then(|v| v.as_f64()),
            any_errors_fatal: get_bool("any_errors_fatal"),
            connection: get_str("connection"),
            environment: HashMap::new(),
            vars: HashMap::new(),
            vars_files: Vec::new(),
            pre_tasks: Vec::new(),
            tasks: Vec::new(),
            post_tasks: Vec::new(),
            handlers: Vec::new(),
            roles: Vec::new(),
            tags: Vec::new(),
        })
    }

    fn extract_line_number(text: &str) -> Option<u32> {
        let re = Regex::new(r"line\s+(\d+)").expect("valid regex literal");
        re.captures(text).and_then(|c| c[1].parse().ok())
    }

    fn extract_rule(text: &str) -> Option<String> {
        let re = Regex::new(r"\[([a-zA-Z0-9_-]+)\]").expect("valid regex literal");
        re.captures(text).map(|c| c[1].to_string())
    }
}
