// ── sorng-terraform/src/providers.rs ──────────────────────────────────────────
//! Provider management — listing, lock-file inspection, schema, mirror.

use regex::Regex;

use crate::client::TerraformClient;
use crate::error::{TerraformError, TerraformResult};
use crate::types::*;

pub struct ProvidersManager;

impl ProvidersManager {
    /// Run `terraform providers` and list required providers with usage.
    pub async fn list(client: &TerraformClient) -> TerraformResult<Vec<ProviderInfo>> {
        let args = ["providers", "-no-color"];
        let output = client.run_raw(&args).await?;

        if output.exit_code != 0 {
            return Err(TerraformError::new(
                crate::error::TerraformErrorKind::ProviderFailed,
                format!("terraform providers failed: {}", output.stderr),
            ));
        }

        Ok(Self::parse_providers_output(&output.stdout))
    }

    /// Run `terraform providers schema -json` to get full provider schemas.
    pub async fn schemas(client: &TerraformClient) -> TerraformResult<Vec<ProviderSchema>> {
        let args = ["providers", "schema", "-json"];
        let output = client.run_raw(&args).await?;

        if output.exit_code != 0 {
            return Err(TerraformError::new(
                crate::error::TerraformErrorKind::ProviderFailed,
                format!("providers schema failed: {}", output.stderr),
            ));
        }

        Self::parse_provider_schemas(&output.stdout)
    }

    /// Run `terraform providers lock` to update the dependency lock file.
    pub async fn lock(
        client: &TerraformClient,
        platforms: &[&str],
    ) -> TerraformResult<StateOperationResult> {
        let mut args: Vec<String> = vec!["providers".to_string(), "lock".to_string()];
        for p in platforms {
            args.push("-platform".to_string());
            args.push(p.to_string());
        }

        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output = client.run_raw(&arg_refs).await?;

        Ok(StateOperationResult {
            success: output.exit_code == 0,
            stdout: output.stdout,
            stderr: output.stderr,
            exit_code: output.exit_code,
        })
    }

    /// Run `terraform providers mirror <target_dir>`.
    pub async fn mirror(
        client: &TerraformClient,
        target_dir: &str,
        platforms: &[&str],
    ) -> TerraformResult<StateOperationResult> {
        let mut args: Vec<String> = vec!["providers".to_string(), "mirror".to_string()];
        for p in platforms {
            args.push("-platform".to_string());
            args.push(p.to_string());
        }
        args.push(target_dir.to_string());

        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output = client.run_raw(&arg_refs).await?;

        Ok(StateOperationResult {
            success: output.exit_code == 0,
            stdout: output.stdout,
            stderr: output.stderr,
            exit_code: output.exit_code,
        })
    }

    /// Parse the `.terraform.lock.hcl` file in the working directory.
    pub async fn parse_lock_file(
        client: &TerraformClient,
    ) -> TerraformResult<Vec<ProviderLockEntry>> {
        let lock_path = client.working_dir.join(".terraform.lock.hcl");
        let content = tokio::fs::read_to_string(&lock_path).await.map_err(|e| {
            TerraformError::new(
                crate::error::TerraformErrorKind::ProviderFailed,
                format!("failed to read lock file: {}", e),
            )
        })?;

        Ok(Self::parse_lock_hcl(&content))
    }

    // ── Parsing helpers ──────────────────────────────────────────────

    /// Parse the text output of `terraform providers`.
    fn parse_providers_output(stdout: &str) -> Vec<ProviderInfo> {
        let re = Regex::new(r"(?:─|-)+ provider\[([^\]]+)\]\s*(?:~>\s*([\d.]+))?").expect("valid regex literal");

        re.captures_iter(stdout)
            .map(|cap| {
                let source = cap[1].to_string();
                let parts: Vec<&str> = source.rsplitn(3, '/').collect();
                let name = parts.first().unwrap_or(&"").to_string();
                let namespace = parts.get(1).unwrap_or(&"").to_string();

                ProviderInfo {
                    source: source.clone(),
                    namespace,
                    name,
                    version_constraint: cap.get(2).map(|m| m.as_str().to_string()),
                    installed_version: None,
                    platform: None,
                    used_by: Vec::new(),
                }
            })
            .collect()
    }

    /// Parse the `.terraform.lock.hcl` content into lock entries.
    fn parse_lock_hcl(content: &str) -> Vec<ProviderLockEntry> {
        let block_re = Regex::new(r#"provider\s+"([^"]+)"\s*\{([^}]*)\}"#).expect("valid regex literal");

        let version_re = Regex::new(r#"version\s*=\s*"([^"]+)""#).expect("valid regex literal");
        let constraints_re = Regex::new(r#"constraints\s*=\s*"([^"]+)""#).expect("valid regex literal");
        let hash_re = Regex::new(r#""(h1:[^"]+|zh:[^"]+)""#).expect("valid regex literal");

        block_re
            .captures_iter(content)
            .map(|cap| {
                let source = cap[1].to_string();
                let body = &cap[2];

                let version = version_re
                    .captures(body)
                    .map(|c| c[1].to_string())
                    .unwrap_or_default();
                let constraints = constraints_re.captures(body).map(|c| c[1].to_string());
                let hashes: Vec<String> = hash_re
                    .captures_iter(body)
                    .map(|c| c[1].to_string())
                    .collect();

                ProviderLockEntry {
                    source,
                    version,
                    constraints,
                    hashes,
                }
            })
            .collect()
    }

    /// Parse the JSON output of `terraform providers schema -json`.
    fn parse_provider_schemas(json_str: &str) -> TerraformResult<Vec<ProviderSchema>> {
        let v: serde_json::Value = serde_json::from_str(json_str)?;

        let schemas_obj = v["provider_schemas"]
            .as_object()
            .cloned()
            .unwrap_or_default();

        let mut schemas = Vec::new();
        for (source, schema_val) in schemas_obj {
            let parts: Vec<&str> = source.rsplitn(3, '/').collect();
            let name = parts.first().unwrap_or(&"").to_string();

            let resource_types = Self::parse_schema_types(&schema_val["resource_schemas"]);
            let data_source_types = Self::parse_schema_types(&schema_val["data_source_schemas"]);

            // Version from provider block
            let version = schema_val["provider"]["version"]
                .as_str()
                .unwrap_or("")
                .to_string();

            schemas.push(ProviderSchema {
                name: name.clone(),
                source: source.clone(),
                version,
                resource_types,
                data_source_types,
            });
        }

        Ok(schemas)
    }

    /// Parse resource_schemas or data_source_schemas from providers schema JSON.
    fn parse_schema_types(val: &serde_json::Value) -> Vec<SchemaResourceType> {
        let obj = match val.as_object() {
            Some(o) => o,
            None => return Vec::new(),
        };

        obj.iter()
            .map(|(type_name, type_schema)| {
                let block = &type_schema["block"];
                let attributes = Self::parse_schema_attributes(&block["attributes"]);
                let block_types = Self::parse_schema_block_types(&block["block_types"]);
                let description = type_schema["description"].as_str().map(|s| s.to_string());

                SchemaResourceType {
                    name: type_name.clone(),
                    description,
                    attributes,
                    block_types,
                }
            })
            .collect()
    }

    /// Parse attributes from a schema block.
    fn parse_schema_attributes(val: &serde_json::Value) -> Vec<SchemaAttribute> {
        let obj = match val.as_object() {
            Some(o) => o,
            None => return Vec::new(),
        };

        obj.iter()
            .map(|(name, attr)| SchemaAttribute {
                name: name.clone(),
                attr_type: attr.get("type").cloned(),
                description: attr["description"].as_str().map(|s| s.to_string()),
                required: attr["required"].as_bool().unwrap_or(false),
                optional: attr["optional"].as_bool().unwrap_or(false),
                computed: attr["computed"].as_bool().unwrap_or(false),
                sensitive: attr["sensitive"].as_bool().unwrap_or(false),
            })
            .collect()
    }

    /// Parse block_types from a schema block.
    fn parse_schema_block_types(val: &serde_json::Value) -> Vec<SchemaBlockType> {
        let obj = match val.as_object() {
            Some(o) => o,
            None => return Vec::new(),
        };

        obj.iter()
            .map(|(name, bt)| {
                let block = &bt["block"];
                SchemaBlockType {
                    name: name.clone(),
                    nesting_mode: bt["nesting_mode"].as_str().unwrap_or("single").to_string(),
                    min_items: bt["min_items"].as_u64().map(|v| v as usize),
                    max_items: bt["max_items"].as_u64().map(|v| v as usize),
                    attributes: Self::parse_schema_attributes(&block["attributes"]),
                }
            })
            .collect()
    }
}
