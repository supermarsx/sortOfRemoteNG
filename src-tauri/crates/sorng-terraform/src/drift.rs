// ── sorng-terraform/src/drift.rs ──────────────────────────────────────────────
//! Drift detection — compares actual infrastructure state with the
//! Terraform configuration to surface resources that have drifted.

use crate::client::TerraformClient;
use crate::error::{TerraformError, TerraformErrorKind, TerraformResult};
use crate::types::*;

pub struct DriftDetector;

impl DriftDetector {
    /// Detect drift by running `terraform plan -detailed-exitcode -refresh-only`
    /// and scanning for changes.
    pub async fn detect(client: &TerraformClient) -> TerraformResult<DriftResult> {
        let start = std::time::Instant::now();

        // Step 1: Generate a refresh-only plan in JSON format.
        let plan_file = Self::temp_plan_file();
        let args = [
            "plan",
            "-refresh-only",
            "-detailed-exitcode",
            "-no-color",
            "-input=false",
            "-out",
            &plan_file,
        ];

        let plan_output = client.run_raw(&args).await?;

        // Exit code 0 = no changes, 1 = error, 2 = changes detected
        let has_drift = plan_output.exit_code == 2;

        if plan_output.exit_code == 1 {
            return Err(TerraformError::new(
                TerraformErrorKind::DriftDetectionFailed,
                format!("terraform refresh plan failed: {}", plan_output.stderr),
            ));
        }

        if !has_drift {
            let elapsed = start.elapsed().as_millis() as u64;
            return Ok(DriftResult {
                has_drift: false,
                drifted_resources: Vec::new(),
                total_resources: 0,
                drift_percentage: 0.0,
                detected_at: chrono::Utc::now(),
                duration_ms: elapsed,
            });
        }

        // Step 2: Show plan in JSON to extract resource changes.
        let show_args = ["show", "-json", &plan_file];
        let show_output = client.run_raw(&show_args).await?;

        // Clean up the temp file (best effort).
        let _ = tokio::fs::remove_file(&plan_file).await;

        if show_output.exit_code != 0 {
            return Err(TerraformError::new(
                TerraformErrorKind::DriftDetectionFailed,
                format!("terraform show -json failed: {}", show_output.stderr),
            ));
        }

        let (drifted, total) = Self::parse_drift_plan(&show_output.stdout)?;
        let elapsed = start.elapsed().as_millis() as u64;

        let drift_percentage = if total > 0 {
            (drifted.len() as f64 / total as f64) * 100.0
        } else {
            0.0
        };

        Ok(DriftResult {
            has_drift: true,
            drifted_resources: drifted,
            total_resources: total,
            drift_percentage,
            detected_at: chrono::Utc::now(),
            duration_ms: elapsed,
        })
    }

    /// Quick boolean check — does drift exist?
    pub async fn has_drift(client: &TerraformClient) -> TerraformResult<bool> {
        let args = [
            "plan",
            "-refresh-only",
            "-detailed-exitcode",
            "-no-color",
            "-input=false",
        ];

        let output = client.run_raw(&args).await?;

        match output.exit_code {
            0 => Ok(false),
            2 => Ok(true),
            _ => Err(TerraformError::new(
                TerraformErrorKind::DriftDetectionFailed,
                format!(
                    "plan exited with code {}: {}",
                    output.exit_code, output.stderr
                ),
            )),
        }
    }

    /// Compare two state snapshots and list the differences as drift.
    pub fn compare_snapshots(
        before: &StateSnapshot,
        after: &StateSnapshot,
    ) -> Vec<DriftedResource> {
        let mut drifted = Vec::new();

        // Index resources by address.
        let before_map: std::collections::HashMap<&str, &StateResource> = before
            .resources
            .iter()
            .map(|r| (r.address.as_str(), r))
            .collect();

        let after_map: std::collections::HashMap<&str, &StateResource> = after
            .resources
            .iter()
            .map(|r| (r.address.as_str(), r))
            .collect();

        // Deleted: in before but not in after.
        for (addr, res) in &before_map {
            if !after_map.contains_key(addr) {
                drifted.push(DriftedResource {
                    address: addr.to_string(),
                    resource_type: res.resource_type.clone(),
                    name: res.name.clone(),
                    drift_type: DriftType::Deleted,
                    before: Some(serde_json::to_value(res).unwrap_or_default()),
                    after: None,
                    changed_attributes: Vec::new(),
                });
            }
        }

        // Added: in after but not in before.
        for (addr, res) in &after_map {
            if !before_map.contains_key(addr) {
                drifted.push(DriftedResource {
                    address: addr.to_string(),
                    resource_type: res.resource_type.clone(),
                    name: res.name.clone(),
                    drift_type: DriftType::Added,
                    before: None,
                    after: Some(serde_json::to_value(res).unwrap_or_default()),
                    changed_attributes: Vec::new(),
                });
            }
        }

        // Modified: present in both but instances differ.
        for (addr, before_res) in &before_map {
            if let Some(after_res) = after_map.get(addr) {
                let before_json = serde_json::to_string(&before_res.instances).unwrap_or_default();
                let after_json = serde_json::to_string(&after_res.instances).unwrap_or_default();
                if before_json != after_json {
                    drifted.push(DriftedResource {
                        address: addr.to_string(),
                        resource_type: before_res.resource_type.clone(),
                        name: before_res.name.clone(),
                        drift_type: DriftType::Modified,
                        before: Some(
                            serde_json::to_value(&before_res.instances).unwrap_or_default(),
                        ),
                        after: Some(serde_json::to_value(&after_res.instances).unwrap_or_default()),
                        changed_attributes: Vec::new(),
                    });
                }
            }
        }

        drifted
    }

    // ── internal helpers ──────────────────────────────────────────────────

    /// Parse the JSON plan output to extract drifted resources.
    fn parse_drift_plan(json_str: &str) -> TerraformResult<(Vec<DriftedResource>, usize)> {
        let v: serde_json::Value = serde_json::from_str(json_str)?;

        let changes = v["resource_changes"]
            .as_array()
            .cloned()
            .unwrap_or_default();

        let total = changes.len();
        let mut drifted = Vec::new();

        for change in &changes {
            let actions = change["change"]["actions"]
                .as_array()
                .cloned()
                .unwrap_or_default();

            let action_strs: Vec<String> = actions
                .iter()
                .filter_map(|a| a.as_str().map(|s| s.to_string()))
                .collect();

            if action_strs.iter().any(|a| a == "update")
                || action_strs.iter().any(|a| a == "delete")
            {
                let address = change["address"].as_str().unwrap_or_default().to_string();
                let resource_type = change["type"].as_str().unwrap_or_default().to_string();
                let name = change["name"].as_str().unwrap_or_default().to_string();

                let drift_type = if action_strs.contains(&"delete".to_string()) {
                    DriftType::Deleted
                } else {
                    DriftType::Modified
                };

                let before_val = change["change"]["before"].clone();
                let after_val = change["change"]["after"].clone();

                let changed_attributes = Self::diff_json_objects(&before_val, &after_val);

                drifted.push(DriftedResource {
                    address,
                    resource_type,
                    name,
                    drift_type,
                    before: Some(before_val),
                    after: Some(after_val),
                    changed_attributes,
                });
            }
        }

        Ok((drifted, total))
    }

    /// Diff two JSON values representing resource attributes.
    fn diff_json_objects(before: &serde_json::Value, after: &serde_json::Value) -> Vec<String> {
        let mut changed = Vec::new();

        if let (Some(b), Some(a)) = (before.as_object(), after.as_object()) {
            for (key, b_val) in b {
                match a.get(key) {
                    Some(a_val) if a_val != b_val => {
                        changed.push(key.clone());
                    }
                    None => {
                        changed.push(key.clone());
                    }
                    _ => {}
                }
            }
            for key in a.keys() {
                if !b.contains_key(key) {
                    changed.push(key.clone());
                }
            }
        }

        changed.sort();
        changed
    }

    /// Generate a temporary plan file path.
    fn temp_plan_file() -> String {
        let id = uuid::Uuid::new_v4();
        let tmp = std::env::temp_dir();
        tmp.join(format!("tfplan-drift-{}.bin", id))
            .to_string_lossy()
            .to_string()
    }
}
