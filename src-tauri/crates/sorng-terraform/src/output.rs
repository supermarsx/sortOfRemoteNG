// ── sorng-terraform/src/output.rs ─────────────────────────────────────────────
//! `terraform output` operations.

use std::collections::HashMap;

use crate::client::TerraformClient;
use crate::error::{TerraformError, TerraformResult};
use crate::types::OutputValue;

pub struct OutputManager;

impl OutputManager {
    /// Get all outputs in JSON format.
    pub async fn list(client: &TerraformClient) -> TerraformResult<HashMap<String, OutputValue>> {
        let args = ["output", "-json"];
        let output = client.run_raw(&args).await?;

        if output.exit_code != 0 {
            // No outputs is not an error — but terraform may exit 0 with "{}" anyway.
            if output.stderr.contains("no outputs defined") || output.stderr.contains("No outputs found") {
                return Ok(HashMap::new());
            }
            return Err(TerraformError::new(
                crate::error::TerraformErrorKind::OutputFailed,
                format!("terraform output failed: {}", output.stderr),
            ));
        }

        let v: serde_json::Value = serde_json::from_str(&output.stdout)?;

        let obj = v.as_object().cloned().unwrap_or_default();
        let mut map = HashMap::new();
        for (k, val) in obj {
            map.insert(
                k,
                OutputValue {
                    value: val["value"].clone(),
                    output_type: val.get("type").cloned(),
                    sensitive: val["sensitive"].as_bool().unwrap_or(false),
                },
            );
        }

        Ok(map)
    }

    /// Get a single output value.
    pub async fn get(
        client: &TerraformClient,
        name: &str,
    ) -> TerraformResult<OutputValue> {
        let args = ["output", "-json", name];
        let output = client.run_raw(&args).await?;

        if output.exit_code != 0 {
            return Err(TerraformError::new(
                crate::error::TerraformErrorKind::OutputFailed,
                format!("output '{}' not found: {}", name, output.stderr),
            ));
        }

        let v: serde_json::Value = serde_json::from_str(&output.stdout)?;

        // `terraform output -json <name>` returns the value directly,
        // but may also include wrapping with type & sensitive info.
        if v.is_object() && v.get("value").is_some() {
            Ok(OutputValue {
                value: v["value"].clone(),
                output_type: v.get("type").cloned(),
                sensitive: v["sensitive"].as_bool().unwrap_or(false),
            })
        } else {
            Ok(OutputValue {
                value: v,
                output_type: None,
                sensitive: false,
            })
        }
    }

    /// Get a single output as a raw string (no JSON parsing).
    pub async fn get_raw(
        client: &TerraformClient,
        name: &str,
    ) -> TerraformResult<String> {
        let args = ["output", "-raw", name];
        let output = client.run_raw(&args).await?;

        if output.exit_code != 0 {
            return Err(TerraformError::new(
                crate::error::TerraformErrorKind::OutputFailed,
                format!("output '{}' not found: {}", name, output.stderr),
            ));
        }

        Ok(output.stdout)
    }
}
