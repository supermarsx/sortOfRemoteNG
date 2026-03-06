// ── procmail include management ──────────────────────────────────────────────
//! Manages INCLUDERC directives in the procmailrc file.

use crate::client::ProcmailClient;
use crate::error::{ProcmailError, ProcmailResult};
use crate::types::*;

pub struct IncludeManager;

impl IncludeManager {
    /// List all INCLUDERC directives in the user's procmailrc.
    pub async fn list(
        client: &ProcmailClient,
        user: &str,
    ) -> ProcmailResult<Vec<ProcmailInclude>> {
        let content = client.get_procmailrc(user).await?;
        Ok(parse_includes(&content))
    }

    /// Add a new INCLUDERC directive.
    pub async fn add(
        client: &ProcmailClient,
        user: &str,
        path: &str,
    ) -> ProcmailResult<()> {
        let mut content = client.get_procmailrc(user).await.unwrap_or_default();

        // Check if already included
        let includes = parse_includes(&content);
        if includes.iter().any(|inc| inc.path == path) {
            return Err(ProcmailError::new(
                crate::error::ProcmailErrorKind::InternalError,
                format!("Include already exists: {path}"),
            ));
        }

        // Insert before the first recipe line
        let lines: Vec<&str> = content.lines().collect();
        let insert_pos = lines
            .iter()
            .position(|l| {
                let t = l.trim();
                t.starts_with(":0") || t.starts_with("#:0")
            });

        if let Some(pos) = insert_pos {
            let mut output: Vec<String> = lines.iter().map(|l| l.to_string()).collect();
            output.insert(pos, format!("INCLUDERC={}", path));
            content = output.join("\n") + "\n";
        } else {
            if !content.ends_with('\n') {
                content.push('\n');
            }
            content.push_str(&format!("INCLUDERC={}\n", path));
        }

        client.write_procmailrc(user, &content).await
    }

    /// Remove an INCLUDERC directive by path.
    pub async fn remove(
        client: &ProcmailClient,
        user: &str,
        path: &str,
    ) -> ProcmailResult<()> {
        let content = client.get_procmailrc(user).await?;
        let lines: Vec<&str> = content.lines().collect();
        let mut output = Vec::new();
        let mut found = false;

        for line in &lines {
            let trimmed = line.trim();
            let check = trimmed.strip_prefix('#').unwrap_or(trimmed);
            if check.starts_with("INCLUDERC=") || check.starts_with("INCLUDERC =") {
                let inc_path = extract_include_path(check);
                if inc_path == path {
                    found = true;
                    // Also remove preceding comment
                    if !output.is_empty() {
                        let last = output.last().map(|s: &String| s.trim().to_string());
                        if let Some(ref l) = last {
                            if l.starts_with('#') && !l.starts_with("# SORNG") {
                                output.pop();
                            }
                        }
                    }
                    continue;
                }
            }
            output.push(line.to_string());
        }

        if !found {
            return Err(ProcmailError::new(
                crate::error::ProcmailErrorKind::ParseError,
                format!("Include not found: {path}"),
            ));
        }

        let new_content = output.join("\n") + "\n";
        client.write_procmailrc(user, &new_content).await
    }

    /// Enable an INCLUDERC directive (uncomment it).
    pub async fn enable(
        client: &ProcmailClient,
        user: &str,
        path: &str,
    ) -> ProcmailResult<()> {
        let content = client.get_procmailrc(user).await?;
        let lines: Vec<&str> = content.lines().collect();
        let mut output = Vec::new();
        let mut found = false;

        for line in &lines {
            let trimmed = line.trim();
            if trimmed.starts_with('#') {
                let uncommented = trimmed.strip_prefix('#').unwrap_or(trimmed).trim();
                if uncommented.starts_with("INCLUDERC=") || uncommented.starts_with("INCLUDERC =") {
                    let inc_path = extract_include_path(uncommented);
                    if inc_path == path {
                        output.push(uncommented.to_string());
                        found = true;
                        continue;
                    }
                }
            }
            output.push(line.to_string());
        }

        if !found {
            return Err(ProcmailError::new(
                crate::error::ProcmailErrorKind::ParseError,
                format!("Disabled include not found: {path}"),
            ));
        }

        let new_content = output.join("\n") + "\n";
        client.write_procmailrc(user, &new_content).await
    }

    /// Disable an INCLUDERC directive (comment it out).
    pub async fn disable(
        client: &ProcmailClient,
        user: &str,
        path: &str,
    ) -> ProcmailResult<()> {
        let content = client.get_procmailrc(user).await?;
        let lines: Vec<&str> = content.lines().collect();
        let mut output = Vec::new();
        let mut found = false;

        for line in &lines {
            let trimmed = line.trim();
            // Only comment out active includes, not already-commented ones
            if !trimmed.starts_with('#')
                && (trimmed.starts_with("INCLUDERC=") || trimmed.starts_with("INCLUDERC ="))
            {
                let inc_path = extract_include_path(trimmed);
                if inc_path == path {
                    output.push(format!("#{}", trimmed));
                    found = true;
                    continue;
                }
            }
            output.push(line.to_string());
        }

        if !found {
            return Err(ProcmailError::new(
                crate::error::ProcmailErrorKind::ParseError,
                format!("Active include not found: {path}"),
            ));
        }

        let new_content = output.join("\n") + "\n";
        client.write_procmailrc(user, &new_content).await
    }
}

// ─── Parsing helpers ─────────────────────────────────────────────────────────

fn parse_includes(content: &str) -> Vec<ProcmailInclude> {
    let mut includes = Vec::new();
    let lines: Vec<&str> = content.lines().collect();

    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        let (check, enabled) = if trimmed.starts_with('#') {
            let uncommented = trimmed.strip_prefix('#').unwrap_or(trimmed).trim();
            (uncommented, false)
        } else {
            (trimmed, true)
        };

        if check.starts_with("INCLUDERC=") || check.starts_with("INCLUDERC =") {
            let path = extract_include_path(check);

            // Check for preceding comment
            let comment = if i > 0 {
                let prev = lines[i - 1].trim();
                if prev.starts_with('#')
                    && !prev.starts_with("# SORNG")
                    && !prev.starts_with("#:0")
                    && !prev.starts_with("#INCLUDERC")
                {
                    Some(prev.trim_start_matches('#').trim().to_string())
                } else {
                    None
                }
            } else {
                None
            };

            includes.push(ProcmailInclude {
                path,
                comment,
                enabled,
            });
        }
    }

    includes
}

/// Extract the included file path from an INCLUDERC line.
fn extract_include_path(line: &str) -> String {
    let after_eq = if let Some(pos) = line.find('=') {
        line[pos + 1..].trim()
    } else {
        ""
    };
    after_eq
        .trim_matches('"')
        .trim_matches('\'')
        .trim()
        .to_string()
}
