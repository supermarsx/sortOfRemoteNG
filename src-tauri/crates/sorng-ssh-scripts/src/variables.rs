// ── sorng-ssh-scripts/src/variables.rs ───────────────────────────────────────
//! Variable resolution engine.

use std::collections::HashMap;
use chrono::Utc;

use crate::types::*;

/// Resolved variable set for a script execution.
pub type ResolvedVariables = HashMap<String, String>;

/// Resolve all variables for a script, returning the final map.
/// Variables that need remote execution are returned as pending.
pub fn resolve_variables(
    script: &SshEventScript,
    overrides: &HashMap<String, String>,
    connection_meta: &HashMap<String, String>,
    previous_outputs: &HashMap<String, String>,
) -> (ResolvedVariables, Vec<PendingVariable>) {
    let mut resolved = HashMap::new();
    let mut pending = Vec::new();

    for var in &script.variables {
        // Check override first
        if let Some(val) = overrides.get(&var.name) {
            resolved.insert(var.name.clone(), val.clone());
            continue;
        }

        match &var.source {
            VariableSource::Static => {
                resolved.insert(var.name.clone(), var.default_value.clone());
            }
            VariableSource::Prompt { label: _ } => {
                // For non-manual triggers, fall back to default
                resolved.insert(var.name.clone(), var.default_value.clone());
                // In manual mode, the UI should have already provided overrides
            }
            VariableSource::ConnectionMeta { field } => {
                let val = connection_meta.get(field)
                    .cloned()
                    .unwrap_or_else(|| var.default_value.clone());
                resolved.insert(var.name.clone(), val);
            }
            VariableSource::PreviousOutput { script_id } => {
                let val = previous_outputs.get(script_id)
                    .cloned()
                    .unwrap_or_else(|| var.default_value.clone());
                resolved.insert(var.name.clone(), val);
            }
            VariableSource::Timestamp { format } => {
                let fmt = format.as_deref().unwrap_or("%Y-%m-%dT%H:%M:%S%.3fZ");
                resolved.insert(var.name.clone(), Utc::now().format(fmt).to_string());
            }
            VariableSource::RemoteCommand { command } => {
                pending.push(PendingVariable {
                    name: var.name.clone(),
                    default_value: var.default_value.clone(),
                    resolution: PendingResolution::RemoteCommand(command.clone()),
                });
            }
            VariableSource::RemoteFile { path } => {
                pending.push(PendingVariable {
                    name: var.name.clone(),
                    default_value: var.default_value.clone(),
                    resolution: PendingResolution::RemoteCommand(format!("cat {}", shell_escape(path))),
                });
            }
            VariableSource::RemoteEnv { variable } => {
                pending.push(PendingVariable {
                    name: var.name.clone(),
                    default_value: var.default_value.clone(),
                    resolution: PendingResolution::RemoteCommand(format!("echo \"${}\"", variable)),
                });
            }
        }
    }

    // Also add built-in variables
    resolved.entry("TIMESTAMP".to_string()).or_insert_with(|| Utc::now().to_rfc3339());
    resolved.entry("SCRIPT_ID".to_string()).or_insert_with(|| script.id.clone());
    resolved.entry("SCRIPT_NAME".to_string()).or_insert_with(|| script.name.clone());

    if let Some(host) = connection_meta.get("host") {
        resolved.entry("HOST".to_string()).or_insert_with(|| host.clone());
    }
    if let Some(user) = connection_meta.get("username") {
        resolved.entry("USERNAME".to_string()).or_insert_with(|| user.clone());
    }
    if let Some(port) = connection_meta.get("port") {
        resolved.entry("PORT".to_string()).or_insert_with(|| port.clone());
    }

    (resolved, pending)
}

/// A variable that needs remote resolution.
pub struct PendingVariable {
    pub name: String,
    pub default_value: String,
    pub resolution: PendingResolution,
}

pub enum PendingResolution {
    RemoteCommand(String),
}

/// Substitute variables in a script body.
/// Supports `{{VAR_NAME}}` and `$VAR_NAME` syntax.
pub fn substitute_variables(content: &str, vars: &ResolvedVariables) -> String {
    let mut result = content.to_string();

    // First pass: {{variable}} mustache-style
    for (name, value) in vars {
        result = result.replace(&format!("{{{{{}}}}}", name), value);
    }

    // Second pass: $VARIABLE style (only at word boundaries)
    for (name, value) in vars {
        let _pattern = format!("${}", name);
        // Only replace if followed by non-alphanumeric or end-of-string
        let re = regex::Regex::new(&format!(r"\$\b{}\b", regex::escape(name)));
        if let Ok(re) = re {
            result = re.replace_all(&result, value.as_str()).to_string();
        }
    }

    result
}

fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_substitute_mustache() {
        let mut vars = HashMap::new();
        vars.insert("HOST".to_string(), "server1.example.com".to_string());
        vars.insert("PORT".to_string(), "22".to_string());

        let content = "ssh {{HOST}} -p {{PORT}}";
        let result = substitute_variables(content, &vars);
        assert_eq!(result, "ssh server1.example.com -p 22");
    }

    #[test]
    fn test_substitute_dollar() {
        let mut vars = HashMap::new();
        vars.insert("USER".to_string(), "admin".to_string());

        let content = "echo $USER";
        let result = substitute_variables(content, &vars);
        assert_eq!(result, "echo admin");
    }
}
