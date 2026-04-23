//! Sudoers management — parse and edit /etc/sudoers and /etc/sudoers.d/*.

use crate::client;
use crate::error::UserMgmtError;
use crate::types::*;
use log::info;

/// List all sudoers rules from /etc/sudoers and /etc/sudoers.d/*.
pub async fn list_rules(host: &UserMgmtHost) -> Result<Vec<SudoersRule>, UserMgmtError> {
    let content = client::read_file(host, "/etc/sudoers").await?;
    let mut rules = parse_sudoers(&content, "/etc/sudoers");

    // Also parse /etc/sudoers.d/ files
    let (ls_out, _, _) = client::exec(host, "ls", &["-1", "/etc/sudoers.d/"]).await?;
    for file in ls_out.lines() {
        let file = file.trim();
        if file.is_empty() || file.starts_with('.') || file.ends_with('~') {
            continue;
        }
        let path = format!("/etc/sudoers.d/{file}");
        if let Ok(content) = client::read_file(host, &path).await {
            rules.extend(parse_sudoers(&content, &path));
        }
    }

    Ok(rules)
}

/// Validate sudoers syntax.
pub async fn validate(host: &UserMgmtHost) -> Result<bool, UserMgmtError> {
    let (_, _, code) = client::exec(host, "visudo", &["-c"]).await?;
    Ok(code == 0)
}

/// Add a sudoers rule to /etc/sudoers.d/<filename>.
pub async fn add_rule(
    host: &UserMgmtHost,
    filename: &str,
    rule_line: &str,
) -> Result<(), UserMgmtError> {
    let path = format!("/etc/sudoers.d/{filename}");
    let escaped = rule_line.replace('\'', "'\\''");
    client::exec_ok(host, "sh", &["-c", &format!("echo '{escaped}' > {path}")]).await?;
    client::exec_ok(host, "chmod", &["0440", &path]).await?;

    // Validate
    let (_, _, code) = client::exec(host, "visudo", &["-c", "-f", &path]).await?;
    if code != 0 {
        client::exec_ok(host, "rm", &["-f", &path]).await?;
        return Err(UserMgmtError::SudoersInvalid(format!(
            "Rule failed validation: {rule_line}"
        )));
    }

    info!("Added sudoers rule to {path}");
    Ok(())
}

/// Remove a sudoers.d file.
pub async fn remove_rule_file(host: &UserMgmtHost, filename: &str) -> Result<(), UserMgmtError> {
    let path = format!("/etc/sudoers.d/{filename}");
    client::exec_ok(host, "rm", &["-f", &path]).await?;
    info!("Removed sudoers file: {path}");
    Ok(())
}

fn parse_sudoers(content: &str, source_file: &str) -> Vec<SudoersRule> {
    let mut rules = Vec::new();
    for (i, line) in content.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with("Defaults") {
            continue;
        }
        // Basic rule parsing: USER HOST=(RUNAS) COMMANDS
        if let Some(rule) = parse_sudoers_rule(line, source_file, (i + 1) as u32) {
            rules.push(rule);
        }
    }
    rules
}

fn parse_sudoers_rule(line: &str, source_file: &str, line_number: u32) -> Option<SudoersRule> {
    // Very simplified parser — real sudoers grammar is complex
    let parts: Vec<&str> = line.splitn(2, char::is_whitespace).collect();
    if parts.len() < 2 {
        return None;
    }

    let principal_str = parts[0];
    let principal = if let Some(group) = principal_str.strip_prefix('%') {
        SudoersPrincipal::Group {
            name: group.to_string(),
        }
    } else {
        SudoersPrincipal::User {
            name: principal_str.to_string(),
        }
    };

    let no_password = line.contains("NOPASSWD:");
    let commands_part = parts[1].trim();

    Some(SudoersRule {
        id: format!("{source_file}:{line_number}"),
        principal,
        hosts: vec!["ALL".to_string()],
        run_as: None,
        commands: vec![commands_part.to_string()],
        no_password,
        tags: Vec::new(),
        comment: None,
        source_file: source_file.to_string(),
        line_number,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_user_rule() {
        let rule = parse_sudoers_rule("alice ALL=(ALL:ALL) ALL", "/etc/sudoers", 1).unwrap();
        let SudoersPrincipal::User { name } = &rule.principal else {
            unreachable!("Expected user principal")
        };
        assert_eq!(name, "alice");
        assert!(!rule.no_password);
    }

    #[test]
    fn test_parse_group_rule() {
        let rule = parse_sudoers_rule("%wheel ALL=(ALL) NOPASSWD: ALL", "/etc/sudoers", 5).unwrap();
        let SudoersPrincipal::Group { name } = &rule.principal else {
            unreachable!("Expected group principal")
        };
        assert_eq!(name, "wheel");
        assert!(rule.no_password);
    }
}
