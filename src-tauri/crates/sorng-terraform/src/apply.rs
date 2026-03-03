// ── sorng-terraform/src/apply.rs ──────────────────────────────────────────────
//! `terraform apply` and `terraform destroy` operations.

use std::collections::HashMap;

use crate::client::TerraformClient;
use crate::error::{TerraformError, TerraformResult};
use crate::types::{ApplyOptions, ApplyResult, OutputValue};

pub struct ApplyManager;

impl ApplyManager {
    /// Run `terraform apply`.
    pub async fn apply(
        client: &TerraformClient,
        options: &ApplyOptions,
    ) -> TerraformResult<ApplyResult> {
        let mut args: Vec<String> = vec!["apply".to_string(), "-input=false".to_string()];
        Self::append_common_args(&mut args, options);

        if let Some(ref plan_file) = options.plan_file {
            // When applying a plan file, it must be the last positional arg.
            // Remove -auto-approve if present — not needed with plan files.
            args.retain(|a| a != "-auto-approve");
            args.push(plan_file.clone());
        }

        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output = client.run_raw(&arg_refs).await?;

        let (added, changed, destroyed) = Self::parse_apply_summary(&output.stdout);
        let outputs = Self::parse_outputs_from_apply(&output.stdout);

        let success = output.exit_code == 0;
        if !success && options.plan_file.is_none() {
            return Err(TerraformError::apply_failed(&output.stderr)
                .with_detail(output.stdout.clone()));
        }

        Ok(ApplyResult {
            success,
            stdout: output.stdout,
            stderr: output.stderr,
            exit_code: output.exit_code,
            resources_added: added,
            resources_changed: changed,
            resources_destroyed: destroyed,
            outputs,
            duration_ms: output.duration_ms,
        })
    }

    /// Run `terraform destroy`.
    pub async fn destroy(
        client: &TerraformClient,
        options: &ApplyOptions,
    ) -> TerraformResult<ApplyResult> {
        let mut args: Vec<String> = vec!["destroy".to_string(), "-input=false".to_string()];
        Self::append_common_args(&mut args, options);

        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output = client.run_raw(&arg_refs).await?;

        let (added, changed, destroyed) = Self::parse_apply_summary(&output.stdout);

        let success = output.exit_code == 0;
        if !success {
            return Err(TerraformError::destroy_failed(&output.stderr)
                .with_detail(output.stdout.clone()));
        }

        Ok(ApplyResult {
            success,
            stdout: output.stdout,
            stderr: output.stderr,
            exit_code: output.exit_code,
            resources_added: added,
            resources_changed: changed,
            resources_destroyed: destroyed,
            outputs: HashMap::new(),
            duration_ms: output.duration_ms,
        })
    }

    /// Run `terraform apply -refresh-only` (refresh state without planning).
    pub async fn refresh(
        client: &TerraformClient,
        options: &ApplyOptions,
    ) -> TerraformResult<ApplyResult> {
        let mut args: Vec<String> = vec![
            "apply".to_string(),
            "-refresh-only".to_string(),
            "-input=false".to_string(),
        ];
        Self::append_common_args(&mut args, options);

        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output = client.run_raw(&arg_refs).await?;

        Ok(ApplyResult {
            success: output.exit_code == 0,
            stdout: output.stdout,
            stderr: output.stderr,
            exit_code: output.exit_code,
            resources_added: 0,
            resources_changed: 0,
            resources_destroyed: 0,
            outputs: HashMap::new(),
            duration_ms: output.duration_ms,
        })
    }

    /// Append shared flags to args.
    fn append_common_args(args: &mut Vec<String>, options: &ApplyOptions) {
        if options.auto_approve {
            args.push("-auto-approve".to_string());
        }
        if options.compact_warnings {
            args.push("-compact-warnings".to_string());
        }
        if let Some(lock) = options.lock {
            args.push(format!("-lock={}", lock));
        }
        if let Some(ref lt) = options.lock_timeout {
            args.push(format!("-lock-timeout={}", lt));
        }
        if let Some(par) = options.parallelism {
            args.push(format!("-parallelism={}", par));
        }
        for target in &options.targets {
            args.push(format!("-target={}", target));
        }
        for replace in &options.replace {
            args.push(format!("-replace={}", replace));
        }
        for vf in &options.var_files {
            args.push(format!("-var-file={}", vf));
        }
        for (k, v) in &options.vars {
            args.push(format!("-var={}={}", k, v));
        }
        for extra in &options.extra_args {
            args.push(extra.clone());
        }
        args.push("-no-color".to_string());
    }

    /// Parse "Apply complete! Resources: X added, Y changed, Z destroyed."
    fn parse_apply_summary(stdout: &str) -> (usize, usize, usize) {
        let re = regex::Regex::new(
            r"(\d+) added, (\d+) changed, (\d+) destroyed"
        );
        match re {
            Ok(re) => {
                if let Some(caps) = re.captures(stdout) {
                    let a = caps[1].parse().unwrap_or(0);
                    let c = caps[2].parse().unwrap_or(0);
                    let d = caps[3].parse().unwrap_or(0);
                    return (a, c, d);
                }
            }
            Err(_) => {}
        }
        (0, 0, 0)
    }

    /// Attempt to extract output values from apply stdout.
    fn parse_outputs_from_apply(stdout: &str) -> HashMap<String, OutputValue> {
        let mut outputs = HashMap::new();
        let re = regex::Regex::new(r#"(\w+)\s*=\s*"?([^"\n]*)"?"#);
        let in_outputs = stdout.contains("Outputs:");

        if in_outputs {
            if let Some(section) = stdout.split("Outputs:").nth(1) {
                if let Ok(re) = re {
                    for cap in re.captures_iter(section.split("\n\n").next().unwrap_or(section)) {
                        outputs.insert(
                            cap[1].to_string(),
                            OutputValue {
                                value: serde_json::Value::String(cap[2].trim().to_string()),
                                output_type: None,
                                sensitive: false,
                            },
                        );
                    }
                }
            }
        }
        outputs
    }
}
