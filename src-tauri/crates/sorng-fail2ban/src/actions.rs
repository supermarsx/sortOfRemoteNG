//! Action definition management — list, read, and inspect actions.

use crate::error::Fail2banError;
use crate::types::{ActionDef, Fail2banHost};
use std::collections::HashMap;

/// List available action names by scanning action.d directory.
pub async fn list_actions(host: &Fail2banHost) -> Result<Vec<String>, Fail2banError> {
    let cmd = "ls /etc/fail2ban/action.d/*.conf 2>/dev/null | sed 's|.*/||;s|\\.conf$||' | sort";

    let output = if let Some(ssh) = &host.ssh {
        let ssh_args = ssh.ssh_command();
        let mut command = tokio::process::Command::new(&ssh_args[0]);
        for arg in &ssh_args[1..] {
            command.arg(arg);
        }
        command.arg(cmd);
        command.output().await
    } else {
        tokio::process::Command::new("sh")
            .args(["-c", cmd])
            .output()
            .await
    };

    let output = output.map_err(|e| Fail2banError::ProcessError(format!("list actions: {e}")))?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    Ok(stdout
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect())
}

/// Read an action configuration file and parse it into an ActionDef.
pub async fn read_action(
    host: &Fail2banHost,
    action_name: &str,
) -> Result<ActionDef, Fail2banError> {
    let path = format!("/etc/fail2ban/action.d/{action_name}.conf");
    let cmd = format!("cat {path}");

    let output = if let Some(ssh) = &host.ssh {
        let ssh_args = ssh.ssh_command();
        let mut command = tokio::process::Command::new(&ssh_args[0]);
        for arg in &ssh_args[1..] {
            command.arg(arg);
        }
        command.arg(&cmd);
        command.output().await
    } else {
        tokio::process::Command::new("sh")
            .args(["-c", &cmd])
            .output()
            .await
    };

    let output = output.map_err(|e| Fail2banError::ProcessError(format!("read action: {e}")))?;

    if !output.status.success() {
        return Err(Fail2banError::ActionNotFound(action_name.to_string()));
    }

    let content = String::from_utf8_lossy(&output.stdout);
    parse_action_conf(action_name, &content, &path)
}

/// List actions associated with a specific jail.
pub async fn actions_for_jail(
    host: &Fail2banHost,
    jail_name: &str,
) -> Result<Vec<String>, Fail2banError> {
    use crate::client;
    let (output, _stderr, _code) = client::exec(host, &["get", jail_name, "actions"]).await?;

    // Output: "The jail <name> has the following actions:\niptables-multiport\nsendmail"
    Ok(output
        .lines()
        .filter(|l| {
            let t = l.trim();
            !t.is_empty() && !t.starts_with("The jail")
        })
        .map(|l| l.trim().to_string())
        .collect())
}

/// Get detailed info about a jail's action configuration.
pub async fn action_properties(
    host: &Fail2banHost,
    jail_name: &str,
    action_name: &str,
) -> Result<HashMap<String, String>, Fail2banError> {
    use crate::client;

    let properties = [
        "actionstart",
        "actionstop",
        "actioncheck",
        "actionban",
        "actionunban",
        "timeout",
        "port",
        "protocol",
    ];

    let mut result = HashMap::new();

    for prop in &properties {
        match client::exec(host, &["get", jail_name, "action", action_name, prop]).await {
            Ok((val, _stderr, _code)) => {
                let cleaned = val.trim().to_string();
                if !cleaned.is_empty() {
                    result.insert(prop.to_string(), cleaned);
                }
            }
            Err(_) => {
                // Property not set — skip
            }
        }
    }

    Ok(result)
}

// ─── Parsers ────────────────────────────────────────────────────────

/// Parse an action .conf file.
fn parse_action_conf(
    name: &str,
    content: &str,
    source_path: &str,
) -> Result<ActionDef, Fail2banError> {
    let mut actionstart = None;
    let mut actionstop = None;
    let mut actioncheck = None;
    let mut actionban = None;
    let mut actionunban = None;
    let mut init = HashMap::new();
    let mut current_section = String::new();
    let mut current_key: Option<String> = None;
    let mut current_value = String::new();

    let flush = |key: &Option<String>,
                 value: &str,
                 start: &mut Option<String>,
                 stop: &mut Option<String>,
                 check: &mut Option<String>,
                 ban: &mut Option<String>,
                 unban: &mut Option<String>,
                 init_map: &mut HashMap<String, String>,
                 section: &str| {
        if let Some(k) = key {
            let val = value.trim().to_string();
            match section {
                "definition" => match k.as_str() {
                    "actionstart" => *start = Some(val),
                    "actionstop" => *stop = Some(val),
                    "actioncheck" => *check = Some(val),
                    "actionban" => *ban = Some(val),
                    "actionunban" => *unban = Some(val),
                    _ => {
                        init_map.insert(k.clone(), val);
                    }
                },
                "init" => {
                    init_map.insert(k.clone(), val);
                }
                _ => {}
            }
        }
    };

    for line in content.lines() {
        let trimmed = line.trim();

        // Skip comments and empty lines
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with(';') {
            continue;
        }

        // Section headers
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            flush(
                &current_key,
                &current_value,
                &mut actionstart,
                &mut actionstop,
                &mut actioncheck,
                &mut actionban,
                &mut actionunban,
                &mut init,
                &current_section,
            );
            current_key = None;
            current_value.clear();
            current_section = trimmed[1..trimmed.len() - 1].to_lowercase();
            continue;
        }

        // Key = value
        if let Some((key, val)) = trimmed.split_once('=') {
            flush(
                &current_key,
                &current_value,
                &mut actionstart,
                &mut actionstop,
                &mut actioncheck,
                &mut actionban,
                &mut actionunban,
                &mut init,
                &current_section,
            );
            current_key = Some(key.trim().to_string());
            current_value = val.trim().to_string();
        } else if current_key.is_some() {
            // Continuation line
            current_value.push('\n');
            current_value.push_str(trimmed);
        }
    }

    // Flush last key
    flush(
        &current_key,
        &current_value,
        &mut actionstart,
        &mut actionstop,
        &mut actioncheck,
        &mut actionban,
        &mut actionunban,
        &mut init,
        &current_section,
    );

    Ok(ActionDef {
        name: name.to_string(),
        actionstart,
        actionstop,
        actioncheck,
        actionban,
        actionunban,
        defaults: init,
        source_path: Some(source_path.to_string()),
    })
}
