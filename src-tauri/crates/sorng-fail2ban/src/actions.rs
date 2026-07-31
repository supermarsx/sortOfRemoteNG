//! Action definition management — list, read, and inspect actions.

use crate::error::Fail2banError;
use crate::types::{ActionDef, Fail2banHost};
use std::collections::HashMap;

/// List available action names by scanning action.d directory.
pub async fn list_actions(host: &Fail2banHost) -> Result<Vec<String>, Fail2banError> {
    let output = crate::client::exec_program(
        host,
        host.use_sudo,
        "find",
        &[
            "/etc/fail2ban/action.d",
            "-maxdepth",
            "1",
            "-type",
            "f",
            "-name",
            "*.conf",
            "-print",
        ],
        "list actions",
    )
    .await?;
    let output = crate::client::require_success("list actions", output)?;
    let mut names: Vec<String> = output
        .stdout
        .lines()
        .filter_map(|line| line.trim().rsplit('/').next())
        .filter_map(|name| name.strip_suffix(".conf"))
        .filter(|name| crate::client::validate_safe_name(name, "action name").is_ok())
        .map(str::to_string)
        .collect();
    names.sort();
    names.dedup();
    Ok(names)
}

/// Read an action configuration file and parse it into an ActionDef.
pub async fn read_action(
    host: &Fail2banHost,
    action_name: &str,
) -> Result<ActionDef, Fail2banError> {
    crate::client::validate_safe_name(action_name, "action name")?;
    let path = format!("/etc/fail2ban/action.d/{action_name}.conf");
    let output =
        crate::client::exec_program(host, host.use_sudo, "cat", &["--", &path], "read action")
            .await?;
    if output.exit_code != 0 {
        return Err(Fail2banError::ActionNotFound(action_name.to_string()));
    }
    parse_action_conf(action_name, &output.stdout, &path)
}

/// List actions associated with a specific jail.
pub async fn actions_for_jail(
    host: &Fail2banHost,
    jail_name: &str,
) -> Result<Vec<String>, Fail2banError> {
    use crate::client;
    client::validate_safe_name(jail_name, "jail name")?;
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
    client::validate_safe_name(jail_name, "jail name")?;
    client::validate_safe_name(action_name, "action name")?;

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
