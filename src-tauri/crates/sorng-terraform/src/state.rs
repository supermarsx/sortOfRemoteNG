// ── sorng-terraform/src/state.rs ──────────────────────────────────────────────
//! Terraform state management — list, show, mv, rm, pull, push, import,
//! taint, untaint, force-unlock.

use std::collections::HashMap;

use crate::client::TerraformClient;
use crate::error::{TerraformError, TerraformResult};
use crate::types::*;

pub struct StateManager;

impl StateManager {
    // ── State listing & inspection ───────────────────────────────────

    /// Run `terraform state list` and return resource addresses.
    pub async fn list(
        client: &TerraformClient,
        filter: Option<&str>,
    ) -> TerraformResult<Vec<String>> {
        let mut args = vec!["state", "list"];
        if let Some(f) = filter {
            args.push(f);
        }
        let output = client.run_no_color(&args).await?;

        if output.exit_code != 0 {
            return Err(TerraformError::state_failed(format!(
                "state list failed: {}", output.stderr
            )));
        }

        Ok(output
            .stdout
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect())
    }

    /// Run `terraform state show <address>` and return the attributes.
    pub async fn show(
        client: &TerraformClient,
        address: &str,
    ) -> TerraformResult<StateResource> {
        let args = ["state", "show", "-no-color", address];
        let output = client.run_raw(&args).await?;

        if output.exit_code != 0 {
            return Err(TerraformError::state_failed(format!(
                "state show failed for {}: {}", address, output.stderr
            )));
        }

        Self::parse_state_show(&output.stdout, address)
    }

    /// Run `terraform show -json` to get the full state in JSON format.
    pub async fn show_json(client: &TerraformClient) -> TerraformResult<StateSnapshot> {
        let args = ["show", "-json"];
        let output = client.run_raw(&args).await?;

        if output.exit_code != 0 {
            return Err(TerraformError::state_failed(format!(
                "terraform show -json failed: {}", output.stderr
            )));
        }

        let v: serde_json::Value = serde_json::from_str(&output.stdout)?;
        Self::parse_state_snapshot(&v)
    }

    /// Run `terraform state pull` and return the raw JSON state.
    pub async fn pull(client: &TerraformClient) -> TerraformResult<String> {
        let args = ["state", "pull"];
        let output = client.run_raw(&args).await?;

        if output.exit_code != 0 {
            return Err(TerraformError::state_failed(format!(
                "state pull failed: {}", output.stderr
            )));
        }

        Ok(output.stdout)
    }

    /// Run `terraform state push <file>`.
    pub async fn push(
        client: &TerraformClient,
        state_file: &str,
        force: bool,
    ) -> TerraformResult<StateOperationResult> {
        let mut args = vec!["state", "push"];
        if force {
            args.push("-force");
        }
        args.push(state_file);

        let output = client.run_raw(&args).await?;

        Ok(StateOperationResult {
            success: output.exit_code == 0,
            stdout: output.stdout,
            stderr: output.stderr,
            exit_code: output.exit_code,
        })
    }

    // ── State mutations ──────────────────────────────────────────────

    /// Run `terraform state mv <source> <destination>`.
    pub async fn mv(
        client: &TerraformClient,
        source: &str,
        destination: &str,
        dry_run: bool,
    ) -> TerraformResult<StateOperationResult> {
        let mut args = vec!["state", "mv"];
        if dry_run {
            args.push("-dry-run");
        }
        args.push(source);
        args.push(destination);

        let output = client.run_no_color(&args).await?;

        Ok(StateOperationResult {
            success: output.exit_code == 0,
            stdout: output.stdout,
            stderr: output.stderr,
            exit_code: output.exit_code,
        })
    }

    /// Run `terraform state rm <addresses...>`.
    pub async fn rm(
        client: &TerraformClient,
        addresses: &[&str],
        dry_run: bool,
    ) -> TerraformResult<StateOperationResult> {
        let mut args: Vec<&str> = vec!["state", "rm"];
        if dry_run {
            args.push("-dry-run");
        }
        for addr in addresses {
            args.push(addr);
        }

        let output = client.run_no_color(&args).await?;

        Ok(StateOperationResult {
            success: output.exit_code == 0,
            stdout: output.stdout,
            stderr: output.stderr,
            exit_code: output.exit_code,
        })
    }

    /// Run `terraform import <address> <id>`.
    pub async fn import(
        client: &TerraformClient,
        options: &ImportOptions,
    ) -> TerraformResult<StateOperationResult> {
        let mut args: Vec<String> = vec!["import".to_string(), "-input=false".to_string()];

        if let Some(ref provider) = options.provider {
            args.push(format!("-provider={}", provider));
        }
        if let Some(lock) = options.lock {
            args.push(format!("-lock={}", lock));
        }
        if let Some(ref lt) = options.lock_timeout {
            args.push(format!("-lock-timeout={}", lt));
        }
        for vf in &options.var_files {
            args.push(format!("-var-file={}", vf));
        }
        for (k, v) in &options.vars {
            args.push(format!("-var={}={}", k, v));
        }

        args.push("-no-color".to_string());
        args.push(options.address.clone());
        args.push(options.resource_id.clone());

        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output = client.run_raw(&arg_refs).await?;

        if output.exit_code != 0 {
            return Err(TerraformError::import_failed(format!(
                "import {} ({}): {}", options.address, options.resource_id, output.stderr
            )));
        }

        Ok(StateOperationResult {
            success: output.exit_code == 0,
            stdout: output.stdout,
            stderr: output.stderr,
            exit_code: output.exit_code,
        })
    }

    /// Run `terraform taint <address>`.
    pub async fn taint(
        client: &TerraformClient,
        address: &str,
    ) -> TerraformResult<StateOperationResult> {
        let args = ["taint", "-no-color", address];
        let output = client.run_raw(&args).await?;

        Ok(StateOperationResult {
            success: output.exit_code == 0,
            stdout: output.stdout,
            stderr: output.stderr,
            exit_code: output.exit_code,
        })
    }

    /// Run `terraform untaint <address>`.
    pub async fn untaint(
        client: &TerraformClient,
        address: &str,
    ) -> TerraformResult<StateOperationResult> {
        let args = ["untaint", "-no-color", address];
        let output = client.run_raw(&args).await?;

        Ok(StateOperationResult {
            success: output.exit_code == 0,
            stdout: output.stdout,
            stderr: output.stderr,
            exit_code: output.exit_code,
        })
    }

    /// Run `terraform force-unlock <lock_id>`.
    pub async fn force_unlock(
        client: &TerraformClient,
        lock_id: &str,
    ) -> TerraformResult<StateOperationResult> {
        let args = ["force-unlock", "-force", lock_id];
        let output = client.run_raw(&args).await?;

        Ok(StateOperationResult {
            success: output.exit_code == 0,
            stdout: output.stdout,
            stderr: output.stderr,
            exit_code: output.exit_code,
        })
    }

    // ── Parsing helpers ──────────────────────────────────────────────

    /// Parse `terraform state show` text output into a StateResource.
    fn parse_state_show(stdout: &str, address: &str) -> TerraformResult<StateResource> {
        // Extract type and name from the address (e.g. "aws_instance.web")
        let parts: Vec<&str> = address.rsplitn(2, '.').collect();
        let name = parts.first().unwrap_or(&"").to_string();
        let resource_type = parts.get(1).unwrap_or(&"").to_string();

        // Parse key = value pairs from the text output.
        let mut attrs = serde_json::Map::new();
        for line in stdout.lines() {
            let trimmed = line.trim();
            if let Some(eq_pos) = trimmed.find('=') {
                let key = trimmed[..eq_pos].trim().to_string();
                let val = trimmed[eq_pos + 1..].trim().trim_matches('"').to_string();
                attrs.insert(key, serde_json::Value::String(val));
            }
        }

        Ok(StateResource {
            address: address.to_string(),
            mode: "managed".to_string(),
            resource_type,
            name,
            provider: String::new(),
            module: None,
            instances: vec![ResourceInstance {
                index_key: None,
                schema_version: None,
                attributes: serde_json::Value::Object(attrs),
                sensitive_attributes: Vec::new(),
                private: None,
                dependencies: Vec::new(),
                create_before_destroy: false,
            }],
            tainted: false,
        })
    }

    /// Parse a full state snapshot from JSON.
    fn parse_state_snapshot(v: &serde_json::Value) -> TerraformResult<StateSnapshot> {
        let format_version = v["format_version"].as_str().map(|s| s.to_string());
        let terraform_version = v["terraform_version"].as_str().map(|s| s.to_string());
        let serial = v["serial"].as_u64();
        let lineage = v["lineage"].as_str().map(|s| s.to_string());

        let resources = Self::parse_state_resources(&v["values"]["root_module"]);

        let outputs = if let Some(obj) = v["values"]["outputs"].as_object() {
            obj.iter()
                .map(|(k, v)| {
                    (
                        k.clone(),
                        OutputValue {
                            value: v["value"].clone(),
                            output_type: v.get("type").cloned(),
                            sensitive: v["sensitive"].as_bool().unwrap_or(false),
                        },
                    )
                })
                .collect()
        } else {
            HashMap::new()
        };

        Ok(StateSnapshot {
            format_version,
            terraform_version,
            serial,
            lineage,
            resources,
            outputs,
        })
    }

    /// Recursively parse resources from a root_module JSON value.
    fn parse_state_resources(module: &serde_json::Value) -> Vec<StateResource> {
        let mut resources = Vec::new();

        if let Some(arr) = module["resources"].as_array() {
            for r in arr {
                let address = r["address"].as_str().unwrap_or_default().to_string();
                let mode = r["mode"].as_str().unwrap_or("managed").to_string();
                let rtype = r["type"].as_str().unwrap_or_default().to_string();
                let name = r["name"].as_str().unwrap_or_default().to_string();
                let provider = r["provider_name"].as_str().unwrap_or_default().to_string();
                let tainted = r["tainted"].as_bool().unwrap_or(false);

                let instances = if let Some(vals) = r.get("values") {
                    vec![ResourceInstance {
                        index_key: r.get("index").cloned(),
                        schema_version: r["schema_version"].as_u64(),
                        attributes: vals.clone(),
                        sensitive_attributes: r["sensitive_values"]
                            .as_object()
                            .map(|o| o.keys().cloned().collect())
                            .unwrap_or_default(),
                        private: None,
                        dependencies: r["depends_on"]
                            .as_array()
                            .map(|a| {
                                a.iter()
                                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                                    .collect()
                            })
                            .unwrap_or_default(),
                        create_before_destroy: false,
                    }]
                } else {
                    Vec::new()
                };

                resources.push(StateResource {
                    address,
                    mode,
                    resource_type: rtype,
                    name,
                    provider,
                    module: r.get("module_address").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    instances,
                    tainted,
                });
            }
        }

        // Recurse into child modules.
        if let Some(children) = module["child_modules"].as_array() {
            for child in children {
                resources.extend(Self::parse_state_resources(child));
            }
        }

        resources
    }
}
