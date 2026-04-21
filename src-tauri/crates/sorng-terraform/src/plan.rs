// ── sorng-terraform/src/plan.rs ───────────────────────────────────────────────
//! `terraform plan` operations — create, show, parse plans.

use crate::client::TerraformClient;
use crate::error::{TerraformError, TerraformResult};
use crate::types::*;

pub struct PlanManager;

impl PlanManager {
    /// Run `terraform plan` and optionally save to a plan file.
    pub async fn plan(
        client: &TerraformClient,
        options: &PlanOptions,
    ) -> TerraformResult<PlanResult> {
        let mut args: Vec<String> = vec!["plan".to_string(), "-input=false".to_string()];

        if let Some(ref out) = options.out {
            args.push(format!("-out={}", out));
        }
        if options.destroy {
            args.push("-destroy".to_string());
        }
        if options.refresh_only {
            args.push("-refresh-only".to_string());
        }
        if options.compact_warnings {
            args.push("-compact-warnings".to_string());
        }
        if options.detailed_exitcode {
            args.push("-detailed-exitcode".to_string());
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

        args.push("-no-color".to_string());

        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output = client.run_raw(&arg_refs).await?;

        let success = output.exit_code == 0 || (options.detailed_exitcode && output.exit_code == 2);

        // If a plan file was saved, try to parse it with `terraform show -json`
        let summary = if let Some(ref plan_file) = options.out {
            Self::show_plan_json(client, plan_file).await.ok()
        } else {
            // Parse the inline text summary
            Self::parse_plan_text_summary(&output.stdout)
        };

        Ok(PlanResult {
            success,
            stdout: output.stdout,
            stderr: output.stderr,
            exit_code: output.exit_code,
            plan_file: options.out.clone(),
            summary,
            duration_ms: output.duration_ms,
        })
    }

    /// Show a saved plan file in JSON format and parse it.
    pub async fn show_plan_json(
        client: &TerraformClient,
        plan_file: &str,
    ) -> TerraformResult<PlanSummary> {
        let args = ["show", "-json", plan_file];
        let output = client.run_raw(&args).await?;

        if output.exit_code != 0 {
            return Err(TerraformError::plan_failed(format!(
                "terraform show -json failed: {}",
                output.stderr
            )));
        }

        Self::parse_plan_json(&output.stdout, Some(plan_file), output.duration_ms)
    }

    /// Show a saved plan file in human-readable format.
    pub async fn show_plan_text(
        client: &TerraformClient,
        plan_file: &str,
    ) -> TerraformResult<String> {
        let args = ["show", "-no-color", plan_file];
        let output = client.run_raw(&args).await?;
        Ok(output.stdout)
    }

    /// Parse the JSON output of `terraform show -json <planfile>`.
    pub fn parse_plan_json(
        json_str: &str,
        plan_file: Option<&str>,
        duration_ms: u64,
    ) -> TerraformResult<PlanSummary> {
        let v: serde_json::Value = serde_json::from_str(json_str)?;

        let format_version = v["format_version"]
            .as_str()
            .unwrap_or("unknown")
            .to_string();
        let terraform_version = v["terraform_version"]
            .as_str()
            .unwrap_or("unknown")
            .to_string();

        let resource_changes = Self::parse_resource_changes(&v["resource_changes"]);
        let output_changes = Self::parse_output_changes(&v["output_changes"]);

        let add = resource_changes
            .iter()
            .filter(|r| r.actions.contains(&ChangeAction::Create))
            .count();
        let change = resource_changes
            .iter()
            .filter(|r| r.actions.contains(&ChangeAction::Update))
            .count();
        let destroy = resource_changes
            .iter()
            .filter(|r| r.actions.contains(&ChangeAction::Delete))
            .count();
        let import_count = resource_changes
            .iter()
            .filter(|r| r.action_reason.as_deref() == Some("import"))
            .count();
        let has_changes = add + change + destroy + import_count > 0;

        let prior_state = v
            .get("prior_state")
            .and_then(|ps| serde_json::from_value::<StateSnapshot>(ps.clone()).ok());

        let configuration = v
            .get("configuration")
            .and_then(|c| serde_json::from_value::<ConfigurationSummary>(c.clone()).ok());

        Ok(PlanSummary {
            format_version,
            terraform_version,
            resource_changes,
            output_changes,
            prior_state,
            configuration,
            add,
            change,
            destroy,
            import_count,
            has_changes,
            plan_file: plan_file.map(|s| s.to_string()),
            duration_ms,
        })
    }

    /// Parse the resource_changes array from plan JSON.
    fn parse_resource_changes(val: &serde_json::Value) -> Vec<ResourceChange> {
        let arr = match val.as_array() {
            Some(a) => a,
            None => return Vec::new(),
        };

        arr.iter()
            .filter_map(|item| {
                let change = item.get("change")?;
                let actions: Vec<ChangeAction> = change
                    .get("actions")?
                    .as_array()?
                    .iter()
                    .filter_map(|a| serde_json::from_value(a.clone()).ok())
                    .collect();

                Some(ResourceChange {
                    address: item["address"].as_str().unwrap_or_default().to_string(),
                    module_address: item["module_address"].as_str().map(|s| s.to_string()),
                    mode: item["mode"].as_str().unwrap_or("managed").to_string(),
                    resource_type: item["type"].as_str().unwrap_or_default().to_string(),
                    name: item["name"].as_str().unwrap_or_default().to_string(),
                    provider_name: item["provider_name"]
                        .as_str()
                        .unwrap_or_default()
                        .to_string(),
                    actions,
                    before: change.get("before").cloned(),
                    after: change.get("after").cloned(),
                    after_unknown: change.get("after_unknown").cloned(),
                    before_sensitive: change.get("before_sensitive").cloned(),
                    after_sensitive: change.get("after_sensitive").cloned(),
                    action_reason: item
                        .get("action_reason")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                })
            })
            .collect()
    }

    /// Parse the output_changes map from plan JSON.
    fn parse_output_changes(val: &serde_json::Value) -> Vec<OutputChange> {
        let obj = match val.as_object() {
            Some(o) => o,
            None => return Vec::new(),
        };

        obj.iter()
            .filter_map(|(name, change)| {
                let actions: Vec<ChangeAction> = change
                    .get("actions")?
                    .as_array()?
                    .iter()
                    .filter_map(|a| serde_json::from_value(a.clone()).ok())
                    .collect();

                Some(OutputChange {
                    name: name.clone(),
                    actions,
                    before: change.get("before").cloned(),
                    after: change.get("after").cloned(),
                    after_unknown: change["after_unknown"].as_bool().unwrap_or(false),
                    sensitive: change["sensitive"].as_bool().unwrap_or(false),
                })
            })
            .collect()
    }

    /// Attempt to parse a text summary from `terraform plan` stdout.
    fn parse_plan_text_summary(stdout: &str) -> Option<PlanSummary> {
        let re =
            regex::Regex::new(r"Plan: (\d+) to add, (\d+) to change, (\d+) to destroy").ok()?;

        let caps = re.captures(stdout)?;
        let add: usize = caps[1].parse().unwrap_or(0);
        let change: usize = caps[2].parse().unwrap_or(0);
        let destroy: usize = caps[3].parse().unwrap_or(0);

        Some(PlanSummary {
            format_version: String::new(),
            terraform_version: String::new(),
            resource_changes: Vec::new(),
            output_changes: Vec::new(),
            prior_state: None,
            configuration: None,
            add,
            change,
            destroy,
            import_count: 0,
            has_changes: add + change + destroy > 0,
            plan_file: None,
            duration_ms: 0,
        })
    }
}
