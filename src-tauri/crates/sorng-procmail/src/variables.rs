// ── procmail variable management ─────────────────────────────────────────────
//! Manages procmail environment variables defined at the top of procmailrc
//! (e.g. MAILDIR, LOGFILE, DEFAULT, VERBOSE, etc.).

use crate::client::ProcmailClient;
use crate::error::{ProcmailError, ProcmailResult};
use crate::types::*;

pub struct VariableManager;

impl VariableManager {
    /// List all variables defined in the user's procmailrc.
    pub async fn list(
        client: &ProcmailClient,
        user: &str,
    ) -> ProcmailResult<Vec<ProcmailVariable>> {
        let content = client.get_procmailrc(user).await?;
        Ok(parse_variables(&content))
    }

    /// Get a single variable by name.
    pub async fn get(
        client: &ProcmailClient,
        user: &str,
        name: &str,
    ) -> ProcmailResult<ProcmailVariable> {
        let vars = Self::list(client, user).await?;
        vars.into_iter().find(|v| v.name == name).ok_or_else(|| {
            ProcmailError::new(
                crate::error::ProcmailErrorKind::ParseError,
                format!("Variable not found: {name}"),
            )
        })
    }

    /// Set (create or update) a variable.
    pub async fn set(
        client: &ProcmailClient,
        user: &str,
        name: &str,
        value: &str,
    ) -> ProcmailResult<()> {
        let content = client.get_procmailrc(user).await.unwrap_or_default();
        let lines: Vec<&str> = content.lines().collect();
        let mut output = Vec::new();
        let mut found = false;

        for line in &lines {
            let trimmed = line.trim();
            // Match VAR=value or VAR = value
            if let Some(eq_pos) = trimmed.find('=') {
                let var_name = trimmed[..eq_pos].trim();
                if var_name == name
                    && !trimmed.starts_with('#')
                    && !trimmed.starts_with(':')
                    && !trimmed.starts_with('*')
                {
                    output.push(format!("{}={}", name, value));
                    found = true;
                    continue;
                }
            }
            output.push(line.to_string());
        }

        if !found {
            // Insert before the first recipe line
            let insert_pos = output
                .iter()
                .position(|l| {
                    let t = l.trim();
                    t.starts_with(":0") || t.starts_with("#:0")
                })
                .unwrap_or(output.len());
            output.insert(insert_pos, format!("{}={}", name, value));
        }

        let new_content = output.join("\n") + "\n";
        client.write_procmailrc(user, &new_content).await
    }

    /// Delete a variable by name.
    pub async fn delete(client: &ProcmailClient, user: &str, name: &str) -> ProcmailResult<()> {
        let content = client.get_procmailrc(user).await?;
        let lines: Vec<&str> = content.lines().collect();
        let mut output = Vec::new();
        let mut found = false;

        for line in &lines {
            let trimmed = line.trim();
            if let Some(eq_pos) = trimmed.find('=') {
                let var_name = trimmed[..eq_pos].trim();
                if var_name == name
                    && !trimmed.starts_with('#')
                    && !trimmed.starts_with(':')
                    && !trimmed.starts_with('*')
                {
                    // Also remove preceding comment if it exists
                    if !output.is_empty() {
                        let last = output.last().map(|s: &String| s.trim().to_string());
                        if let Some(ref l) = last {
                            if l.starts_with('#') && !l.starts_with("# SORNG") {
                                output.pop();
                            }
                        }
                    }
                    found = true;
                    continue;
                }
            }
            output.push(line.to_string());
        }

        if !found {
            return Err(ProcmailError::new(
                crate::error::ProcmailErrorKind::ParseError,
                format!("Variable not found: {name}"),
            ));
        }

        let new_content = output.join("\n") + "\n";
        client.write_procmailrc(user, &new_content).await
    }
}

// ─── Parsing helpers ─────────────────────────────────────────────────────────

fn parse_variables(content: &str) -> Vec<ProcmailVariable> {
    let mut variables = Vec::new();
    let lines: Vec<&str> = content.lines().collect();

    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();

        // Skip empty lines, comments, recipe lines, includes
        if trimmed.is_empty()
            || trimmed.starts_with(':')
            || trimmed.starts_with('*')
            || trimmed.starts_with("INCLUDERC")
            || trimmed.starts_with("##")
        {
            continue;
        }

        // Skip commented-out recipe lines
        if trimmed.starts_with("#:0") || trimmed.starts_with("# SORNG") {
            continue;
        }

        // Pure comment lines are not variables
        if trimmed.starts_with('#') {
            continue;
        }

        // Match VAR=value or VAR = value
        if let Some(eq_pos) = trimmed.find('=') {
            let var_name = trimmed[..eq_pos].trim();
            let var_value = trimmed[eq_pos + 1..].trim();

            // Validate that var_name looks like an identifier
            if var_name.is_empty()
                || !var_name
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_')
            {
                continue;
            }

            // Check for preceding comment
            let comment = if i > 0 {
                let prev = lines[i - 1].trim();
                if prev.starts_with('#') && !prev.starts_with("# SORNG") && !prev.starts_with("#:0")
                {
                    Some(prev.trim_start_matches('#').trim().to_string())
                } else {
                    None
                }
            } else {
                None
            };

            // Strip quotes from value
            let clean_value = var_value.trim_matches('"').trim_matches('\'').to_string();

            variables.push(ProcmailVariable {
                name: var_name.to_string(),
                value: clean_value,
                comment,
            });
        }
    }

    variables
}
