// ── sorng-terraform/src/init.rs ───────────────────────────────────────────────
//! `terraform init` operations.

use regex::Regex;

use crate::client::TerraformClient;
use crate::error::{TerraformError, TerraformResult};
use crate::types::{InitOptions, InitResult, ProviderVersion};

pub struct InitManager;

impl InitManager {
    /// Run `terraform init` with the given options.
    pub async fn init(
        client: &TerraformClient,
        options: &InitOptions,
    ) -> TerraformResult<InitResult> {
        let mut args: Vec<String> = vec!["init".to_string(), "-input=false".to_string()];

        if options.upgrade {
            args.push("-upgrade".to_string());
        }
        if options.reconfigure {
            args.push("-reconfigure".to_string());
        }
        if options.migrate_state {
            args.push("-migrate-state".to_string());
        }
        if options.force_copy {
            args.push("-force-copy".to_string());
        }
        if let Some(ref mode) = options.lockfile_mode {
            args.push(format!("-lockfile={}", mode));
        }
        if let Some(get) = options.get_plugins {
            args.push(format!("-get-plugins={}", get));
        }
        for dir in &options.plugin_dirs {
            args.push(format!("-plugin-dir={}", dir));
        }

        // Backend config overrides from options + client defaults.
        for (k, v) in &client.backend_configs {
            args.push(format!("-backend-config={}={}", k, v));
        }
        for (k, v) in &options.backend_configs {
            args.push(format!("-backend-config={}={}", k, v));
        }

        args.push("-no-color".to_string());

        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let output = client.run_raw(&arg_refs).await?;

        let providers_installed = Self::parse_installed_providers(&output.stdout);
        let backend_type = Self::parse_backend_type(&output.stdout);

        let success = output.exit_code == 0;
        if !success {
            return Err(
                TerraformError::init_failed(&output.stderr).with_detail(output.stdout.clone())
            );
        }

        Ok(InitResult {
            success,
            stdout: output.stdout,
            stderr: output.stderr,
            exit_code: output.exit_code,
            providers_installed,
            backend_type,
            duration_ms: output.duration_ms,
        })
    }

    /// Parse provider installation lines from init output.
    fn parse_installed_providers(stdout: &str) -> Vec<ProviderVersion> {
        let re = Regex::new(
            r"- Installing ([a-zA-Z0-9_-]+)/([a-zA-Z0-9_-]+) v([0-9]+\.[0-9]+\.[0-9]+[a-zA-Z0-9._-]*)"
        ).unwrap();

        re.captures_iter(stdout)
            .map(|cap| ProviderVersion {
                namespace: cap[1].to_string(),
                name: cap[2].to_string(),
                version: cap[3].to_string(),
                source: format!("{}/{}", &cap[1], &cap[2]),
            })
            .collect()
    }

    /// Parse backend type from init output.
    fn parse_backend_type(stdout: &str) -> Option<String> {
        let re = Regex::new(r#"Initializing the backend\.\.\.[\s\S]*?backend "([^"]+)""#).ok()?;
        re.captures(stdout).map(|cap| cap[1].to_string())
    }

    /// Run `terraform init` with -backend=false (no backend initialization).
    pub async fn init_no_backend(client: &TerraformClient) -> TerraformResult<InitResult> {
        let args = ["init", "-input=false", "-backend=false", "-no-color"];
        let output = client.run_raw(&args).await?;

        Ok(InitResult {
            success: output.exit_code == 0,
            stdout: output.stdout,
            stderr: output.stderr,
            exit_code: output.exit_code,
            providers_installed: Vec::new(),
            backend_type: None,
            duration_ms: output.duration_ms,
        })
    }
}
