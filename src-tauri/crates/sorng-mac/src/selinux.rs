// ── sorng-mac/src/selinux.rs ──────────────────────────────────────────────────
//! SELinux management — modes, booleans, contexts, policies, modules, ports,
//! fcontexts, users, roles, policy reloads.

use crate::client::MacClient;
use crate::error::{MacError, MacResult};
use crate::types::*;

/// Parse `getenforce` output into SelinuxMode.
pub fn parse_getenforce(output: &str) -> SelinuxMode {
    SelinuxMode::from_str_loose(output.trim())
}

/// Parse `sestatus` output into SelinuxStatus.
pub fn parse_sestatus(output: &str) -> MacResult<SelinuxStatus> {
    fn val(lines: &[&str], key: &str) -> String {
        lines.iter()
            .find(|l| l.to_lowercase().contains(&key.to_lowercase()))
            .map(|l| {
                l.splitn(2, ':')
                    .nth(1)
                    .unwrap_or("")
                    .trim()
                    .to_string()
            })
            .unwrap_or_default()
    }

    let lines: Vec<&str> = output.lines().collect();

    Ok(SelinuxStatus {
        mode: SelinuxMode::from_str_loose(&val(&lines, "Current mode")),
        policy_name: val(&lines, "Loaded policy name"),
        policy_version: val(&lines, "Policy version"),
        max_kernel_policy_version: val(&lines, "Max kernel policy version")
            .parse()
            .unwrap_or(0),
        loaded_policy_type: val(&lines, "Loaded policy name"),
        root_login_allowed: val(&lines, "root login").to_lowercase() != "disabled",
        max_open_files: val(&lines, "Max open files").parse().unwrap_or(0),
        max_categories: val(&lines, "Max categories").parse().unwrap_or(1024),
        policy_deny_unknown: val(&lines, "Policy deny_unknown")
            .to_lowercase()
            .contains("allowed")
            .eq(&false),
    })
}

/// Parse `getsebool -a` output into a list of booleans.
pub fn parse_getsebool(output: &str) -> Vec<SelinuxBoolean> {
    output
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            // Format: "bool_name --> on" or "bool_name --> off"
            let parts: Vec<&str> = line.splitn(2, "-->").collect();
            if parts.len() == 2 {
                let name = parts[0].trim().to_string();
                let val = parts[1].trim().to_lowercase() == "on";
                Some(SelinuxBoolean {
                    name,
                    current_value: val,
                    pending_value: val,
                    description: String::new(),
                })
            } else {
                None
            }
        })
        .collect()
}

/// Parse `semodule -l` output into modules.
pub fn parse_semodule_list(output: &str) -> Vec<SelinuxModule> {
    output
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                Some(SelinuxModule {
                    name: parts[0].to_string(),
                    version: parts.get(1).unwrap_or(&"0").to_string(),
                    priority: parts
                        .get(2)
                        .and_then(|s| s.parse().ok())
                        .unwrap_or(400),
                    enabled: true,
                    cil: false,
                })
            } else if parts.len() == 1 && !parts[0].is_empty() {
                Some(SelinuxModule {
                    name: parts[0].to_string(),
                    version: String::new(),
                    priority: 400,
                    enabled: true,
                    cil: false,
                })
            } else {
                None
            }
        })
        .collect()
}

/// Parse `semanage fcontext -l` output.
pub fn parse_fcontext_list(output: &str) -> Vec<SelinuxFileContext> {
    output
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with("SELinux") {
                return None;
            }
            // Format: "/path/pattern    all files    system_u:object_r:type_t:s0"
            let parts: Vec<&str> = line.splitn(3, char::is_whitespace).collect();
            if parts.len() >= 2 {
                let pattern = parts[0].to_string();
                let rest = parts[1..].join(" ");
                let rest = rest.trim();
                // Try to split file_type and context
                if let Some(ctx_start) = rest.rfind(|c: char| c == ':') {
                    let _ = ctx_start; // context is the last colon-delimited part
                }
                Some(SelinuxFileContext {
                    pattern,
                    context: rest.to_string(),
                    file_type: None,
                })
            } else {
                None
            }
        })
        .collect()
}

/// Parse `semanage port -l` output.
pub fn parse_port_list(output: &str) -> Vec<SelinuxPort> {
    output
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with("SELinux") || line.starts_with("---") {
                return None;
            }
            // Format: "http_port_t		tcp	80, 443, 8080"
            let parts: Vec<&str> = line.splitn(3, char::is_whitespace).collect();
            if parts.len() >= 3 {
                Some(SelinuxPort {
                    context_type: parts[0].trim().to_string(),
                    protocol: parts[1].trim().to_string(),
                    port_range: parts[2].trim().to_string(),
                })
            } else {
                None
            }
        })
        .collect()
}

/// Parse `semanage user -l` output.
pub fn parse_user_list(output: &str) -> Vec<SelinuxUser> {
    output
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty()
                || line.starts_with("SELinux")
                || line.starts_with("---")
                || line.starts_with("Labeling")
            {
                return None;
            }
            let parts: Vec<&str> = line.split_whitespace().collect();
            // Format: "user_u  prefix  s0  s0  role1 role2 ..."
            if parts.len() >= 5 {
                Some(SelinuxUser {
                    name: parts[0].to_string(),
                    prefix: parts[1].to_string(),
                    mls_level: parts[2].to_string(),
                    mls_range: parts[3].to_string(),
                    selinux_roles: parts[4..].iter().map(|s| s.to_string()).collect(),
                })
            } else {
                None
            }
        })
        .collect()
}

// ── Remote operations ────────────────────────────────────────────────────────

pub async fn get_mode(client: &MacClient) -> MacResult<SelinuxMode> {
    let out = client.run_command("getenforce").await?;
    Ok(parse_getenforce(&out))
}

pub async fn set_mode(client: &MacClient, req: &SetModeRequest) -> MacResult<SelinuxMode> {
    let mode_str = match req.mode {
        SelinuxMode::Enforcing => "1",
        SelinuxMode::Permissive => "0",
        SelinuxMode::Disabled => {
            return Err(MacError::policy(
                "Cannot set Disabled at runtime; edit /etc/selinux/config and reboot",
            ));
        }
    };
    client
        .run_sudo_command(&format!("setenforce {}", mode_str))
        .await?;

    if req.persistent {
        let sed = format!(
            "sed -i 's/^SELINUX=.*/SELINUX={}/' /etc/selinux/config",
            req.mode.to_string().to_lowercase()
        );
        client.run_sudo_command(&sed).await?;
    }
    Ok(req.mode.clone())
}

pub async fn get_status(client: &MacClient) -> MacResult<SelinuxStatus> {
    let out = client.run_command("sestatus").await?;
    parse_sestatus(&out)
}

pub async fn list_booleans(client: &MacClient) -> MacResult<Vec<SelinuxBoolean>> {
    let out = client.run_command("getsebool -a").await?;
    Ok(parse_getsebool(&out))
}

pub async fn get_boolean(client: &MacClient, name: &str) -> MacResult<SelinuxBoolean> {
    let out = client.run_command(&format!("getsebool {}", name)).await?;
    let bools = parse_getsebool(&out);
    bools
        .into_iter()
        .next()
        .ok_or_else(|| MacError::boolean_not_found(name))
}

pub async fn set_boolean(client: &MacClient, req: &SetBooleanRequest) -> MacResult<bool> {
    let val_str = if req.value { "on" } else { "off" };
    let flag = if req.persistent { "-P" } else { "" };
    client
        .run_sudo_command(&format!("setsebool {} {} {}", flag, req.name, val_str))
        .await?;
    Ok(true)
}

pub async fn list_modules(client: &MacClient) -> MacResult<Vec<SelinuxModule>> {
    let out = client.run_command("semodule -l").await?;
    Ok(parse_semodule_list(&out))
}

pub async fn manage_module(client: &MacClient, req: &ManageModuleRequest) -> MacResult<bool> {
    let cmd = match req.action {
        ModuleAction::Install => format!("semodule -i /tmp/{}.pp", req.name),
        ModuleAction::Remove => format!("semodule -r {}", req.name),
        ModuleAction::Enable => format!("semodule -e {}", req.name),
        ModuleAction::Disable => format!("semodule -d {}", req.name),
    };
    client.run_sudo_command(&cmd).await?;
    Ok(true)
}

pub async fn list_file_contexts(client: &MacClient) -> MacResult<Vec<SelinuxFileContext>> {
    let out = client.run_command("semanage fcontext -l").await?;
    Ok(parse_fcontext_list(&out))
}

pub async fn add_file_context(
    client: &MacClient,
    req: &AddFileContextRequest,
) -> MacResult<bool> {
    let cmd = format!(
        "semanage fcontext -a -t {} '{}'",
        req.context_type, req.pattern
    );
    client.run_sudo_command(&cmd).await?;
    Ok(true)
}

pub async fn remove_file_context(client: &MacClient, pattern: &str) -> MacResult<bool> {
    let cmd = format!("semanage fcontext -d '{}'", pattern);
    client.run_sudo_command(&cmd).await?;
    Ok(true)
}

pub async fn restorecon(
    client: &MacClient,
    path: &str,
    recursive: bool,
) -> MacResult<Vec<String>> {
    let flag = if recursive { "-Rv" } else { "-v" };
    let out = client
        .run_sudo_command(&format!("restorecon {} {}", flag, path))
        .await?;
    Ok(out.lines().map(String::from).collect())
}

pub async fn list_ports(client: &MacClient) -> MacResult<Vec<SelinuxPort>> {
    let out = client.run_command("semanage port -l").await?;
    Ok(parse_port_list(&out))
}

pub async fn add_port_context(
    client: &MacClient,
    req: &AddPortContextRequest,
) -> MacResult<bool> {
    let cmd = format!(
        "semanage port -a -t {} -p {} {}",
        req.context_type, req.protocol, req.port_range
    );
    client.run_sudo_command(&cmd).await?;
    Ok(true)
}

pub async fn list_users(client: &MacClient) -> MacResult<Vec<SelinuxUser>> {
    let out = client.run_command("semanage user -l").await?;
    Ok(parse_user_list(&out))
}

pub async fn list_roles(client: &MacClient) -> MacResult<Vec<SelinuxRole>> {
    let out = client.run_command("seinfo -r").await?;
    let roles: Vec<SelinuxRole> = out
        .lines()
        .filter(|l| !l.trim().is_empty() && !l.starts_with("Roles:"))
        .map(|l| SelinuxRole {
            name: l.trim().to_string(),
            types: Vec::new(),
            default_type: None,
        })
        .collect();
    Ok(roles)
}

pub async fn get_policy_info(client: &MacClient) -> MacResult<SelinuxPolicy> {
    let status = get_status(client).await?;
    let modules = list_modules(client).await?;
    let booleans = list_booleans(client).await?;
    Ok(SelinuxPolicy {
        name: status.policy_name,
        version: status.policy_version,
        module_count: modules.len() as u32,
        boolean_count: booleans.len() as u32,
    })
}

pub async fn audit_log(client: &MacClient, limit: u32) -> MacResult<Vec<SelinuxAuditEntry>> {
    let out = client
        .run_command(&format!(
            "ausearch -m avc --raw | tail -n {}",
            limit
        ))
        .await?;
    Ok(parse_audit_entries(&out))
}

pub fn parse_audit_entries(output: &str) -> Vec<SelinuxAuditEntry> {
    output
        .lines()
        .filter(|l| l.contains("avc:") || l.contains("type=AVC"))
        .map(|line| {
            let extract = |key: &str| -> Option<String> {
                let pattern = format!("{}=", key);
                line.find(&pattern).map(|start| {
                    let rest = &line[start + pattern.len()..];
                    let end = rest.find(' ').unwrap_or(rest.len());
                    rest[..end].trim_matches('"').to_string()
                })
            };
            SelinuxAuditEntry {
                timestamp: extract("msg").unwrap_or_default(),
                event_type: "AVC".to_string(),
                source_context: extract("scontext"),
                target_context: extract("tcontext"),
                target_class: extract("tclass"),
                permission: extract("perm").or_else(|| extract("perms")),
                result: if line.contains("denied") {
                    "denied".to_string()
                } else {
                    "granted".to_string()
                },
                comm: extract("comm"),
                path: extract("path"),
                pid: extract("pid").and_then(|s| s.parse().ok()),
            }
        })
        .collect()
}

pub async fn audit2allow(client: &MacClient, audit_lines: &str) -> MacResult<String> {
    // Pipe audit lines through audit2allow
    let cmd = format!("echo '{}' | audit2allow", audit_lines.replace('\'', "'\\''"));
    client.run_command(&cmd).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_getenforce() {
        assert_eq!(parse_getenforce("Enforcing\n"), SelinuxMode::Enforcing);
        assert_eq!(parse_getenforce("Permissive\n"), SelinuxMode::Permissive);
        assert_eq!(parse_getenforce("Disabled\n"), SelinuxMode::Disabled);
    }

    #[test]
    fn test_parse_getsebool() {
        let output = "httpd_can_network_connect --> on\nhttpd_enable_cgi --> off\n";
        let bools = parse_getsebool(output);
        assert_eq!(bools.len(), 2);
        assert_eq!(bools[0].name, "httpd_can_network_connect");
        assert!(bools[0].current_value);
        assert_eq!(bools[1].name, "httpd_enable_cgi");
        assert!(!bools[1].current_value);
    }

    #[test]
    fn test_parse_semodule_list() {
        let output = "apache\t1.17.1\nmysql\t1.23.3\n";
        let modules = parse_semodule_list(output);
        assert_eq!(modules.len(), 2);
        assert_eq!(modules[0].name, "apache");
        assert_eq!(modules[0].version, "1.17.1");
    }

    #[test]
    fn test_parse_audit_entries() {
        let line = r#"type=AVC msg=audit(1234567890.123:456): avc:  denied  { read } for  pid=1234 comm="httpd" path="/var/www" scontext=system_u:system_r:httpd_t:s0 tcontext=unconfined_u:object_r:var_t:s0 tclass=file"#;
        let entries = parse_audit_entries(line);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].result, "denied");
        assert_eq!(entries[0].comm.as_deref(), Some("httpd"));
    }
}
