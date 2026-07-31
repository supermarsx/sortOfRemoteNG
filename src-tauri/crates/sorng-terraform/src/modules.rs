// ── sorng-terraform/src/modules.rs ────────────────────────────────────────────
//! Module management — listing, download, registry search.

use crate::client::TerraformClient;
use crate::error::{TerraformError, TerraformResult};
use crate::types::*;
use std::time::Duration;

pub struct ModulesManager;

const MAX_REGISTRY_RESPONSE_BYTES: usize = 8 * 1024 * 1024;

impl ModulesManager {
    /// Run `terraform get` to download declared modules.
    pub async fn get(
        client: &TerraformClient,
        update: bool,
    ) -> TerraformResult<StateOperationResult> {
        let mut args = vec!["get", "-no-color"];
        if update {
            args.push("-update");
        }

        let output = client.run_raw(&args).await?;

        Ok(StateOperationResult {
            success: output.exit_code == 0,
            stdout: output.stdout,
            stderr: output.stderr,
            exit_code: output.exit_code,
        })
    }

    /// Parse the `.terraform/modules/modules.json` manifest to list installed modules.
    pub async fn list_installed(client: &TerraformClient) -> TerraformResult<Vec<ModuleRef>> {
        let manifest_path = client
            .working_dir
            .join(".terraform")
            .join("modules")
            .join("modules.json");

        let content = tokio::fs::read_to_string(&manifest_path)
            .await
            .map_err(|e| {
                TerraformError::new(
                    crate::error::TerraformErrorKind::ModuleFailed,
                    format!("failed to read modules manifest: {}", e),
                )
            })?;

        let v: serde_json::Value = serde_json::from_str(&content)?;

        let modules = v["Modules"]
            .as_array()
            .unwrap_or(&Vec::new())
            .iter()
            .filter_map(|m| {
                let key = m["Key"].as_str().unwrap_or_default().to_string();
                if key.is_empty() {
                    return None; // root module entry
                }
                Some(ModuleRef {
                    key,
                    source: m["Source"].as_str().unwrap_or_default().to_string(),
                    version: m["Version"].as_str().map(|s| s.to_string()),
                    dir: m["Dir"].as_str().map(|s| s.to_string()),
                })
            })
            .collect();

        Ok(modules)
    }

    /// Search the Terraform registry for modules.
    pub async fn search_registry(
        _client: &TerraformClient,
        options: &RegistrySearchOptions,
    ) -> TerraformResult<Vec<RegistryModule>> {
        // Terraform itself doesn't have a CLI search command for modules.
        // We query the public registry REST API directly.
        let mut url = format!(
            "https://registry.terraform.io/v1/modules?q={}&limit={}",
            urlencoding(&options.query),
            options.limit.unwrap_or(20),
        );

        if let Some(ref provider) = options.provider {
            url.push_str(&format!("&provider={}", urlencoding(provider)));
        }
        if let Some(ref ns) = options.namespace {
            url.push_str(&format!("&namespace={}", urlencoding(ns)));
        }
        if let Some(offset) = options.offset {
            url.push_str(&format!("&offset={}", offset));
        }
        if options.verified_only {
            url.push_str("&verified=true");
        }

        let response = Self::http_get(&url).await?;
        Self::parse_registry_response(&response)
    }

    /// Bounded HTTPS GET for the fixed public Terraform registry endpoint.
    async fn http_get(url: &str) -> TerraformResult<String> {
        let client = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("SortOfRemoteNG-Terraform/1")
            .build()
            .map_err(|_| {
                TerraformError::new(
                    crate::error::TerraformErrorKind::ModuleFailed,
                    "failed to initialize registry client",
                )
            })?;
        let mut response = client.get(url).send().await.map_err(|_| {
            TerraformError::new(
                crate::error::TerraformErrorKind::ModuleFailed,
                "registry request failed",
            )
        })?;

        if !response.status().is_success() {
            return Err(TerraformError::new(
                crate::error::TerraformErrorKind::ModuleFailed,
                format!("registry request returned HTTP {}", response.status()),
            ));
        }

        if response
            .content_length()
            .is_some_and(|length| length > MAX_REGISTRY_RESPONSE_BYTES as u64)
        {
            return Err(TerraformError::new(
                crate::error::TerraformErrorKind::ModuleFailed,
                "registry response exceeded the 8 MiB limit",
            ));
        }

        let mut body = Vec::with_capacity(
            response
                .content_length()
                .unwrap_or(16 * 1024)
                .min(MAX_REGISTRY_RESPONSE_BYTES as u64) as usize,
        );
        while let Some(chunk) = response.chunk().await.map_err(|_| {
            TerraformError::new(
                crate::error::TerraformErrorKind::ModuleFailed,
                "failed to read registry response",
            )
        })? {
            if body.len().saturating_add(chunk.len()) > MAX_REGISTRY_RESPONSE_BYTES {
                return Err(TerraformError::new(
                    crate::error::TerraformErrorKind::ModuleFailed,
                    "registry response exceeded the 8 MiB limit",
                ));
            }
            body.extend_from_slice(&chunk);
        }

        String::from_utf8(body).map_err(|_| {
            TerraformError::new(
                crate::error::TerraformErrorKind::ModuleFailed,
                "registry response was not valid UTF-8",
            )
        })
    }

    /// Parse the registry API response.
    fn parse_registry_response(json_str: &str) -> TerraformResult<Vec<RegistryModule>> {
        let v: serde_json::Value = serde_json::from_str(json_str)?;

        let modules = v["modules"]
            .as_array()
            .unwrap_or(&Vec::new())
            .iter()
            .map(|m| RegistryModule {
                id: m["id"].as_str().unwrap_or_default().to_string(),
                namespace: m["namespace"].as_str().unwrap_or_default().to_string(),
                name: m["name"].as_str().unwrap_or_default().to_string(),
                provider: m["provider"].as_str().unwrap_or_default().to_string(),
                version: m["version"].as_str().unwrap_or_default().to_string(),
                description: m["description"].as_str().map(|s| s.to_string()),
                source: m["source"].as_str().unwrap_or_default().to_string(),
                downloads: m["downloads"].as_u64(),
                published_at: m["published_at"].as_str().map(|s| s.to_string()),
                verified: m["verified"].as_bool().unwrap_or(false),
            })
            .collect();

        Ok(modules)
    }
}

/// Minimal URL-encoding for query parameters (no external crate needed).
fn urlencoding(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                result.push(b as char);
            }
            _ => {
                result.push_str(&format!("%{:02X}", b));
            }
        }
    }
    result
}
