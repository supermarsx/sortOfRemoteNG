// ── sorng-terraform/src/validate.rs ───────────────────────────────────────────
//! `terraform validate` and `terraform fmt` operations.

use crate::client::TerraformClient;
use crate::error::{TerraformError, TerraformResult};
use crate::types::*;

pub struct ValidateManager;

impl ValidateManager {
    /// Run `terraform validate -json` and return structured diagnostics.
    pub async fn validate(client: &TerraformClient) -> TerraformResult<ValidationResult> {
        let args = ["validate", "-json", "-no-color"];
        let output = client.run_raw(&args).await?;

        // terraform validate -json returns JSON even on validation failure
        let v: serde_json::Value = serde_json::from_str(&output.stdout).map_err(|e| {
            TerraformError::new(
                crate::error::TerraformErrorKind::ValidationFailed,
                format!("failed to parse validate JSON: {}", e),
            )
        })?;

        let valid = v["valid"].as_bool().unwrap_or(false);
        let diags = Self::parse_diagnostics(&v["diagnostics"]);
        let error_count = diags
            .iter()
            .filter(|d| d.severity == DiagnosticSeverity::Error)
            .count();
        let warning_count = diags
            .iter()
            .filter(|d| d.severity == DiagnosticSeverity::Warning)
            .count();
        let format_version = v["format_version"].as_str().map(|s| s.to_string());

        Ok(ValidationResult {
            valid,
            error_count,
            warning_count,
            diagnostics: diags,
            format_version,
        })
    }

    /// Run `terraform fmt` to format HCL files in-place.
    pub async fn fmt(
        client: &TerraformClient,
        check_only: bool,
        recursive: bool,
        diff: bool,
    ) -> TerraformResult<FmtResult> {
        let mut args = vec!["fmt"];
        if check_only {
            args.push("-check");
        }
        if recursive {
            args.push("-recursive");
        }
        if diff {
            args.push("-diff");
        }
        args.push("-no-color");

        let output = client.run_raw(&args).await?;

        let files_changed: Vec<String> = output
            .stdout
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect();

        Ok(FmtResult {
            files_changed,
            success: output.exit_code == 0,
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }

    /// Run `terraform fmt -write=false` to show what would change without modifying.
    pub async fn fmt_check(client: &TerraformClient) -> TerraformResult<FmtResult> {
        Self::fmt(client, true, false, true).await
    }

    /// Parse the diagnostics array from terraform validate -json.
    fn parse_diagnostics(val: &serde_json::Value) -> Vec<Diagnostic> {
        let arr = match val.as_array() {
            Some(a) => a,
            None => return Vec::new(),
        };

        arr.iter()
            .filter_map(|d| {
                let severity = match d["severity"].as_str() {
                    Some("error") => DiagnosticSeverity::Error,
                    Some("warning") => DiagnosticSeverity::Warning,
                    _ => return None,
                };

                let range = d.get("range").and_then(|r| {
                    Some(DiagnosticRange {
                        filename: r["filename"].as_str()?.to_string(),
                        start: DiagnosticPos {
                            line: r["start"]["line"].as_u64()? as usize,
                            column: r["start"]["column"].as_u64()? as usize,
                            byte: r["start"]["byte"].as_u64().map(|b| b as usize),
                        },
                        end: DiagnosticPos {
                            line: r["end"]["line"].as_u64()? as usize,
                            column: r["end"]["column"].as_u64()? as usize,
                            byte: r["end"]["byte"].as_u64().map(|b| b as usize),
                        },
                    })
                });

                let snippet = d.get("snippet").and_then(|s| {
                    Some(DiagnosticSnippet {
                        context: s["context"].as_str().map(|s| s.to_string()),
                        code: s["code"].as_str()?.to_string(),
                        start_line: s["start_line"].as_u64()? as usize,
                        highlight_start_offset: s["highlight_start_offset"]
                            .as_u64()
                            .map(|v| v as usize),
                        highlight_end_offset: s["highlight_end_offset"]
                            .as_u64()
                            .map(|v| v as usize),
                        values: s["values"]
                            .as_array()
                            .map(|arr| {
                                arr.iter()
                                    .filter_map(|ev| {
                                        Some(DiagnosticExprValue {
                                            traversal: ev["traversal"].as_str()?.to_string(),
                                            statement: ev["statement"].as_str()?.to_string(),
                                        })
                                    })
                                    .collect()
                            })
                            .unwrap_or_default(),
                    })
                });

                Some(Diagnostic {
                    severity,
                    summary: d["summary"].as_str().unwrap_or_default().to_string(),
                    detail: d["detail"].as_str().map(|s| s.to_string()),
                    range,
                    snippet,
                })
            })
            .collect()
    }
}
