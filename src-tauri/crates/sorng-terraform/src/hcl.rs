// ── sorng-terraform/src/hcl.rs ────────────────────────────────────────────────
//! HCL file analysis — static parsing of *.tf files to extract variables,
//! outputs, resources, data sources, locals, module calls, provider
//! requirements, and terraform settings.
//!
//! This is a **regex-based best-effort** parser used for IDE navigation and
//! configuration summaries.  It deliberately avoids a full HCL grammar to keep
//! the dependency footprint minimal.

use std::collections::HashMap;

use regex::Regex;

use crate::error::{TerraformError, TerraformErrorKind, TerraformResult};
use crate::types::*;

pub struct HclAnalyzer;

impl HclAnalyzer {
    /// Analyse all `*.tf` files under the working directory.
    pub async fn analyse_dir(dir: &std::path::Path) -> TerraformResult<HclAnalysis> {
        let mut combined = HclAnalysis {
            variables: Vec::new(),
            outputs: Vec::new(),
            resources: Vec::new(),
            data_sources: Vec::new(),
            locals: Vec::new(),
            modules: Vec::new(),
            providers_required: Vec::new(),
            terraform_settings: None,
            files: Vec::new(),
        };

        let mut entries = tokio::fs::read_dir(dir).await.map_err(|e| {
            TerraformError::new(
                TerraformErrorKind::HclParseFailed,
                format!("read dir: {}", e),
            )
        })?;

        while let Some(entry) = entries.next_entry().await.map_err(|e| {
            TerraformError::new(
                TerraformErrorKind::HclParseFailed,
                format!("read dir entry: {}", e),
            )
        })? {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("tf") {
                if let Ok(content) = tokio::fs::read_to_string(&path).await {
                    let filename = path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string();
                    Self::merge_file(&mut combined, &content, &filename);
                    combined.files.push(filename);
                }
            }
        }

        Ok(combined)
    }

    /// Analyse a single HCL file given its contents and name.
    pub fn analyse_file(content: &str, filename: &str) -> HclAnalysis {
        let mut analysis = HclAnalysis {
            variables: Vec::new(),
            outputs: Vec::new(),
            resources: Vec::new(),
            data_sources: Vec::new(),
            locals: Vec::new(),
            modules: Vec::new(),
            providers_required: Vec::new(),
            terraform_settings: None,
            files: vec![filename.to_string()],
        };
        Self::merge_file(&mut analysis, content, filename);
        analysis
    }

    // ── internal helpers ──────────────────────────────────────────────────

    fn merge_file(analysis: &mut HclAnalysis, content: &str, filename: &str) {
        analysis
            .variables
            .extend(Self::parse_variables(content, filename));
        analysis
            .outputs
            .extend(Self::parse_outputs(content, filename));
        analysis
            .resources
            .extend(Self::parse_resources(content, filename));
        analysis
            .data_sources
            .extend(Self::parse_data_sources(content, filename));
        analysis
            .locals
            .extend(Self::parse_locals(content, filename));
        analysis
            .modules
            .extend(Self::parse_module_calls(content, filename));
        analysis
            .providers_required
            .extend(Self::parse_required_providers(content));

        if let Some(settings) = Self::parse_terraform_settings(content) {
            analysis.terraform_settings = Some(settings);
        }
    }

    /// Parse `variable "xxx" { ... }` blocks.
    fn parse_variables(content: &str, filename: &str) -> Vec<HclVariable> {
        let re = Regex::new(r#"(?m)^variable\s+"([^"]+)"\s*\{"#).expect("valid regex literal");

        re.captures_iter(content)
            .map(|cap| {
                let name = cap[1].to_string();
                let match_start = cap.get(0).expect("capture group 0 always exists").start();
                let block_start = cap.get(0).expect("capture group 0 always exists").end();
                let block = Self::extract_block(content, block_start);
                let line = Self::line_number(content, match_start);

                let default_str = Self::extract_attr(&block, "default");
                let default: Option<serde_json::Value> = default_str.and_then(|s| {
                    serde_json::from_str(&s)
                        .ok()
                        .or_else(|| Some(serde_json::Value::String(s)))
                });

                let validation_rules: Vec<String> = if block.contains("validation") {
                    vec!["has validation block".to_string()]
                } else {
                    Vec::new()
                };

                HclVariable {
                    name,
                    var_type: Self::extract_attr(&block, "type"),
                    default,
                    description: Self::extract_string_attr(&block, "description"),
                    sensitive: Self::extract_bool_attr(&block, "sensitive"),
                    nullable: Self::extract_bool_attr(&block, "nullable"),
                    validation_rules,
                    file: filename.to_string(),
                    line,
                }
            })
            .collect()
    }

    /// Parse `output "xxx" { ... }` blocks.
    fn parse_outputs(content: &str, filename: &str) -> Vec<HclOutput> {
        let re = Regex::new(r#"(?m)^output\s+"([^"]+)"\s*\{"#).expect("valid regex literal");

        re.captures_iter(content)
            .map(|cap| {
                let name = cap[1].to_string();
                let match_start = cap.get(0).expect("capture group 0 always exists").start();
                let block_start = cap.get(0).expect("capture group 0 always exists").end();
                let block = Self::extract_block(content, block_start);
                let line = Self::line_number(content, match_start);

                HclOutput {
                    name,
                    value_expr: Self::extract_attr(&block, "value"),
                    description: Self::extract_string_attr(&block, "description"),
                    sensitive: Self::extract_bool_attr(&block, "sensitive"),
                    depends_on: Self::extract_list_attr(&block, "depends_on"),
                    file: filename.to_string(),
                    line,
                }
            })
            .collect()
    }

    /// Parse `resource "type" "name" { ... }` blocks.
    fn parse_resources(content: &str, filename: &str) -> Vec<HclResource> {
        let re = Regex::new(r#"(?m)^resource\s+"([^"]+)"\s+"([^"]+)"\s*\{"#).expect("valid regex literal");

        re.captures_iter(content)
            .map(|cap| {
                let resource_type = cap[1].to_string();
                let name = cap[2].to_string();
                let match_start = cap.get(0).expect("capture group 0 always exists").start();
                let block_start = cap.get(0).expect("capture group 0 always exists").end();
                let block = Self::extract_block(content, block_start);
                let line = Self::line_number(content, match_start);

                let address = format!("{}.{}", resource_type, name);
                let provider = Self::extract_attr(&block, "provider");
                let count_expr = Self::extract_attr(&block, "count");
                let for_each_expr = Self::extract_attr(&block, "for_each");
                let depends_on = Self::extract_list_attr(&block, "depends_on");
                let lifecycle = Self::parse_lifecycle_block(&block);
                let provisioners = Self::extract_provisioner_types(&block);

                HclResource {
                    resource_type,
                    name,
                    address,
                    provider,
                    count_expr,
                    for_each_expr,
                    depends_on,
                    lifecycle,
                    provisioners,
                    file: filename.to_string(),
                    line,
                }
            })
            .collect()
    }

    /// Parse `data "type" "name" { ... }` blocks.
    fn parse_data_sources(content: &str, filename: &str) -> Vec<HclDataSource> {
        let re = Regex::new(r#"(?m)^data\s+"([^"]+)"\s+"([^"]+)"\s*\{"#).expect("valid regex literal");

        re.captures_iter(content)
            .map(|cap| {
                let data_type = cap[1].to_string();
                let name = cap[2].to_string();
                let match_start = cap.get(0).expect("capture group 0 always exists").start();
                let block_start = cap.get(0).expect("capture group 0 always exists").end();
                let block = Self::extract_block(content, block_start);
                let line = Self::line_number(content, match_start);
                let address = format!("data.{}.{}", data_type, name);

                let provider = Self::extract_attr(&block, "provider");
                let depends_on = Self::extract_list_attr(&block, "depends_on");

                HclDataSource {
                    data_type,
                    name,
                    address,
                    provider,
                    depends_on,
                    file: filename.to_string(),
                    line,
                }
            })
            .collect()
    }

    /// Parse `locals { ... }` blocks — each key inside is a local value.
    fn parse_locals(content: &str, filename: &str) -> Vec<HclLocal> {
        let re = Regex::new(r#"(?m)^locals\s*\{"#).expect("valid regex literal");
        let kv_re = Regex::new(r#"(?m)^\s+(\w+)\s*="#).expect("valid regex literal");

        let mut locals = Vec::new();
        for cap in re.captures_iter(content) {
            let match_start = cap.get(0).expect("capture group 0 always exists").start();
            let block_start = cap.get(0).expect("capture group 0 always exists").end();
            let block = Self::extract_block(content, block_start);
            let base_line = Self::line_number(content, match_start);

            for kv in kv_re.captures_iter(&block) {
                let kv_offset = kv.get(0).expect("capture group 0 always exists").start();
                let local_line = base_line + block[..kv_offset].matches('\n').count();
                locals.push(HclLocal {
                    name: kv[1].to_string(),
                    value_expr: Self::extract_attr(&block, &kv[1]),
                    file: filename.to_string(),
                    line: local_line,
                });
            }
        }
        locals
    }

    /// Parse `module "xxx" { ... }` blocks.
    fn parse_module_calls(content: &str, filename: &str) -> Vec<HclModuleCall> {
        let re = Regex::new(r#"(?m)^module\s+"([^"]+)"\s*\{"#).expect("valid regex literal");

        re.captures_iter(content)
            .map(|cap| {
                let name = cap[1].to_string();
                let match_start = cap.get(0).expect("capture group 0 always exists").start();
                let block_start = cap.get(0).expect("capture group 0 always exists").end();
                let block = Self::extract_block(content, block_start);
                let line = Self::line_number(content, match_start);

                let source = Self::extract_string_attr(&block, "source").unwrap_or_default();
                let version = Self::extract_string_attr(&block, "version");
                let count_expr = Self::extract_attr(&block, "count");
                let for_each_expr = Self::extract_attr(&block, "for_each");
                let depends_on = Self::extract_list_attr(&block, "depends_on");
                let providers: HashMap<String, String> =
                    Self::extract_map_attr(&block, "providers")
                        .into_iter()
                        .collect();

                HclModuleCall {
                    name,
                    source,
                    version,
                    count_expr,
                    for_each_expr,
                    depends_on,
                    providers,
                    file: filename.to_string(),
                    line,
                }
            })
            .collect()
    }

    /// Parse `required_providers` inside `terraform { ... }` blocks.
    fn parse_required_providers(content: &str) -> Vec<HclRequiredProvider> {
        let tf_re = Regex::new(r#"(?m)^terraform\s*\{"#).expect("valid regex literal");
        let rp_re = Regex::new(r#"(?m)required_providers\s*\{"#).expect("valid regex literal");
        let entry_re = Regex::new(r#"(?m)(\w+)\s*=\s*\{"#).expect("valid regex literal");

        let mut providers = Vec::new();

        for cap in tf_re.captures_iter(content) {
            let block_start = cap.get(0).expect("capture group 0 always exists").end();
            let tf_block = Self::extract_block(content, block_start);

            if let Some(rp_cap) = rp_re.captures(&tf_block) {
                let rp_start = rp_cap.get(0).expect("capture group 0 always exists").end();
                let rp_block = Self::extract_block(&tf_block, rp_start);

                for entry in entry_re.captures_iter(&rp_block) {
                    let pname = entry[1].to_string();
                    let entry_start = entry.get(0).expect("capture group 0 always exists").end();
                    let entry_block = Self::extract_block(&rp_block, entry_start);

                    providers.push(HclRequiredProvider {
                        name: pname,
                        source: Self::extract_string_attr(&entry_block, "source")
                            .unwrap_or_default(),
                        version_constraint: Self::extract_string_attr(&entry_block, "version"),
                    });
                }
            }
        }
        providers
    }

    /// Parse the `terraform { ... }` settings block.
    fn parse_terraform_settings(content: &str) -> Option<HclTerraformSettings> {
        let tf_re = Regex::new(r#"(?m)^terraform\s*\{"#).expect("valid regex literal");
        let tf_cap = tf_re.captures(content)?;
        let block_start = tf_cap.get(0).expect("capture group 0 always exists").end();
        let tf_block = Self::extract_block(content, block_start);

        let required_version = Self::extract_string_attr(&tf_block, "required_version");

        // Detect backend type
        let backend_re = Regex::new(r#"(?m)backend\s+"(\w+)"\s*\{"#).expect("valid regex literal");
        let backend_type = backend_re.captures(&tf_block).map(|c| c[1].to_string());

        // backend_config — we just note the type, not parse all keys
        let backend_config: HashMap<String, serde_json::Value> = HashMap::new();

        // Detect cloud block
        let cloud_block = if tf_block.contains("cloud {") || tf_block.contains("cloud{") {
            Some(HashMap::new()) // placeholder
        } else {
            None
        };

        // experiments
        let experiments = Self::extract_list_attr(&tf_block, "experiments");

        Some(HclTerraformSettings {
            required_version,
            backend_type,
            backend_config,
            cloud_block,
            experiments,
        })
    }

    /// Parse a `lifecycle { ... }` sub-block.
    fn parse_lifecycle_block(block: &str) -> Option<HclLifecycle> {
        let lc_re = Regex::new(r#"(?m)lifecycle\s*\{"#).expect("valid regex literal");
        let lc_cap = lc_re.captures(block)?;
        let lc_start = lc_cap.get(0).expect("capture group 0 always exists").end();
        let lc_block = Self::extract_block(block, lc_start);

        let ignore_changes = if lc_block.contains("ignore_changes = all")
            || lc_block.contains("ignore_changes=all")
        {
            vec!["all".to_string()]
        } else {
            Self::extract_list_attr(&lc_block, "ignore_changes")
        };

        Some(HclLifecycle {
            create_before_destroy: Self::extract_bool_attr_opt(&lc_block, "create_before_destroy"),
            prevent_destroy: Self::extract_bool_attr_opt(&lc_block, "prevent_destroy"),
            ignore_changes,
            replace_triggered_by: Self::extract_list_attr(&lc_block, "replace_triggered_by"),
            preconditions: Vec::new(),
            postconditions: Vec::new(),
        })
    }

    /// Extract provisioner type names from the block.
    fn extract_provisioner_types(block: &str) -> Vec<String> {
        let re = Regex::new(r#"(?m)provisioner\s+"([^"]+)"\s*\{"#).expect("valid regex literal");
        re.captures_iter(block).map(|c| c[1].to_string()).collect()
    }

    // ── block / attribute extraction helpers ──────────────────────────────

    /// Extract the text inside the next `{ ... }` region starting after `start_idx`,
    /// handling nested braces.
    fn extract_block(content: &str, start_idx: usize) -> String {
        let bytes = content.as_bytes();
        let mut depth: i32 = 1;
        let mut end = start_idx;

        for (i, &b) in bytes[start_idx..].iter().enumerate() {
            match b {
                b'{' => depth += 1,
                b'}' => {
                    depth -= 1;
                    if depth == 0 {
                        end = start_idx + i;
                        break;
                    }
                }
                _ => {}
            }
        }

        content[start_idx..end].to_string()
    }

    /// Extract a simple attribute value:  `key = <value>` → the raw value token.
    fn extract_attr(block: &str, key: &str) -> Option<String> {
        let re = Regex::new(&format!(r#"(?m)^\s*{}\s*=\s*(.+)"#, regex::escape(key))).expect("valid regex literal");
        re.captures(block).map(|c| c[1].trim().to_string())
    }

    /// Extract a string-quoted attribute:  `key = "value"`.
    fn extract_string_attr(block: &str, key: &str) -> Option<String> {
        let re = Regex::new(&format!(
            r#"(?m)^\s*{}\s*=\s*"([^"]*)""#,
            regex::escape(key)
        ))
        .expect("valid regex literal");
        re.captures(block).map(|c| c[1].to_string())
    }

    /// Extract a boolean attribute defaulting to false.
    fn extract_bool_attr(block: &str, key: &str) -> bool {
        Self::extract_attr(block, key)
            .map(|v| v.trim() == "true")
            .unwrap_or(false)
    }

    /// Extract a boolean attribute as Option.
    fn extract_bool_attr_opt(block: &str, key: &str) -> Option<bool> {
        Self::extract_attr(block, key).map(|v| v.trim() == "true")
    }

    /// Extract a list attribute:  `key = [a, b, c]`.
    fn extract_list_attr(block: &str, key: &str) -> Vec<String> {
        let re = Regex::new(&format!(
            r#"(?m)^\s*{}\s*=\s*\[([^\]]*)\]"#,
            regex::escape(key)
        ))
        .expect("valid regex literal");

        if let Some(cap) = re.captures(block) {
            let inner = &cap[1];
            inner
                .split(',')
                .map(|s| s.trim().trim_matches('"').trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        } else {
            Vec::new()
        }
    }

    /// Extract a map attribute:  `key = { a = b.c, d = e.f }`.
    fn extract_map_attr(block: &str, key: &str) -> Vec<(String, String)> {
        let re = Regex::new(&format!(
            r#"(?m)^\s*{}\s*=\s*\{{([^}}]*)\}}"#,
            regex::escape(key)
        ))
        .expect("valid regex literal");

        if let Some(cap) = re.captures(block) {
            let inner = &cap[1];
            let pair_re = Regex::new(r#"(\S+)\s*=\s*(\S+)"#).expect("valid regex literal");
            pair_re
                .captures_iter(inner)
                .map(|p| (p[1].to_string(), p[2].to_string()))
                .collect()
        } else {
            Vec::new()
        }
    }

    /// Compute 1-based line number from byte offset.
    fn line_number(content: &str, byte_offset: usize) -> usize {
        content[..byte_offset].matches('\n').count() + 1
    }

    /// Produce a `ConfigurationSummary` from an `HclAnalysis`.
    pub fn summarise(analysis: &HclAnalysis) -> ConfigurationSummary {
        // ConfigurationSummary only has provider_configs and root_module.
        // Build a quick provider_configs map from the analysis.
        let mut provider_configs: HashMap<String, serde_json::Value> = HashMap::new();
        for p in &analysis.providers_required {
            let mut map = serde_json::Map::new();
            map.insert(
                "source".to_string(),
                serde_json::Value::String(p.source.clone()),
            );
            if let Some(ref vc) = p.version_constraint {
                map.insert("version".to_string(), serde_json::Value::String(vc.clone()));
            }
            provider_configs.insert(p.name.clone(), serde_json::Value::Object(map));
        }

        // Build a simplified root_module summary.
        let mut root = serde_json::Map::new();
        root.insert(
            "resource_count".to_string(),
            serde_json::Value::Number(serde_json::Number::from(analysis.resources.len())),
        );
        root.insert(
            "data_source_count".to_string(),
            serde_json::Value::Number(serde_json::Number::from(analysis.data_sources.len())),
        );
        root.insert(
            "variable_count".to_string(),
            serde_json::Value::Number(serde_json::Number::from(analysis.variables.len())),
        );
        root.insert(
            "output_count".to_string(),
            serde_json::Value::Number(serde_json::Number::from(analysis.outputs.len())),
        );
        root.insert(
            "module_count".to_string(),
            serde_json::Value::Number(serde_json::Number::from(analysis.modules.len())),
        );
        root.insert(
            "local_count".to_string(),
            serde_json::Value::Number(serde_json::Number::from(analysis.locals.len())),
        );
        root.insert(
            "file_count".to_string(),
            serde_json::Value::Number(serde_json::Number::from(analysis.files.len())),
        );

        ConfigurationSummary {
            provider_configs,
            root_module: Some(serde_json::Value::Object(root)),
        }
    }
}
