// ── sorng-mac/src/apparmor.rs ─────────────────────────────────────────────────
//! AppArmor management — profiles, status, parser, log parsing.

use crate::client::MacClient;
use crate::error::{MacError, MacResult};
use crate::types::*;
use regex::Regex;

/// Parse `aa-status --json` or text output into AppArmorStatus.
pub fn parse_aa_status(output: &str) -> MacResult<AppArmorStatus> {
    // Try JSON first
    if output.trim_start().starts_with('{') {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(output) {
            return Ok(AppArmorStatus {
                version: v["version"].as_str().unwrap_or("").to_string(),
                profiles_loaded: v["profiles"]["loaded"].as_u64().unwrap_or(0) as u32,
                profiles_enforcing: v["profiles"]["enforce"].as_u64().unwrap_or(0) as u32,
                profiles_complain: v["profiles"]["complain"].as_u64().unwrap_or(0) as u32,
                profiles_kill: v["profiles"]["kill"].as_u64().unwrap_or(0) as u32,
                profiles_unconfined: v["profiles"]["unconfined"].as_u64().unwrap_or(0) as u32,
                processes_confined: v["processes"]["confined"].as_u64().unwrap_or(0) as u32,
                processes_unconfined: v["processes"]["unconfined"].as_u64().unwrap_or(0) as u32,
            });
        }
    }

    // Fallback: parse text output
    fn extract_num(lines: &[&str], needle: &str) -> u32 {
        lines
            .iter()
            .find(|l| l.to_lowercase().contains(&needle.to_lowercase()))
            .and_then(|l| {
                l.split_whitespace()
                    .next()
                    .and_then(|n| n.parse::<u32>().ok())
            })
            .unwrap_or(0)
    }

    let lines: Vec<&str> = output.lines().collect();
    Ok(AppArmorStatus {
        version: lines
            .first()
            .map(|l| l.trim().to_string())
            .unwrap_or_default(),
        profiles_loaded: extract_num(&lines, "profiles are loaded"),
        profiles_enforcing: extract_num(&lines, "profiles are in enforce"),
        profiles_complain: extract_num(&lines, "profiles are in complain"),
        profiles_kill: extract_num(&lines, "profiles are in kill"),
        profiles_unconfined: extract_num(&lines, "unconfined"),
        processes_confined: extract_num(&lines, "processes have profiles"),
        processes_unconfined: extract_num(&lines, "processes are unconfined"),
    })
}

/// Parse aa-status text output into profiles list.
pub fn parse_aa_profiles(output: &str) -> Vec<AppArmorProfile> {
    let re = Regex::new(r"^\s+(\S+)\s+\((\w+)\)").expect("valid regex literal");
    output
        .lines()
        .filter_map(|line| {
            re.captures(line).map(|caps| AppArmorProfile {
                name: caps[1].to_string(),
                mode: AppArmorMode::from_str_loose(&caps[2]),
                pid_count: 0,
                source_path: None,
            })
        })
        .collect()
}

/// Parse AppArmor audit log entries from kern.log / audit.log.
pub fn parse_apparmor_log(output: &str) -> Vec<AppArmorLogEntry> {
    let re = Regex::new(r#"apparmor="(\w+)"\s+operation="([^"]+)"\s+(?:.*?profile="([^"]*)")?"#)
        .expect("valid regex literal");

    output
        .lines()
        .filter_map(|line| {
            let caps = re.captures(line)?;
            let extract = |key: &str| -> Option<String> {
                let pat = format!("{}=\"", key);
                line.find(&pat).map(|start| {
                    let rest = &line[start + pat.len()..];
                    let end = rest.find('"').unwrap_or(rest.len());
                    rest[..end].to_string()
                })
            };

            Some(AppArmorLogEntry {
                timestamp: line.get(..15).unwrap_or("").trim().to_string(),
                profile_name: caps
                    .get(3)
                    .map(|m| m.as_str().to_string())
                    .unwrap_or_default(),
                operation: caps[2].to_string(),
                denied: caps[1].to_uppercase() == "DENIED",
                info: extract("info"),
                comm: extract("comm"),
                requested_mask: extract("requested_mask"),
                fsuid: extract("fsuid").and_then(|s| s.parse().ok()),
                ouid: extract("ouid").and_then(|s| s.parse().ok()),
                target: extract("name"),
            })
        })
        .collect()
}

// ── Remote operations ────────────────────────────────────────────────────────

pub async fn get_status(client: &MacClient) -> MacResult<AppArmorStatus> {
    let out = client.run_sudo_command("aa-status").await?;
    parse_aa_status(&out)
}

pub async fn list_profiles(client: &MacClient) -> MacResult<Vec<AppArmorProfile>> {
    let out = client.run_sudo_command("aa-status").await?;
    Ok(parse_aa_profiles(&out))
}

pub async fn set_profile_mode(client: &MacClient, req: &SetProfileModeRequest) -> MacResult<bool> {
    let cmd = match req.mode {
        AppArmorMode::Enforce => format!("aa-enforce {}", req.profile_name),
        AppArmorMode::Complain => format!("aa-complain {}", req.profile_name),
        AppArmorMode::Disabled => format!("aa-disable {}", req.profile_name),
        _ => {
            return Err(MacError::profile(format!(
                "Cannot set mode {} directly",
                req.mode
            )));
        }
    };
    client.run_sudo_command(&cmd).await?;
    Ok(true)
}

pub async fn reload_profile(client: &MacClient, profile_name: &str) -> MacResult<bool> {
    client
        .run_sudo_command(&format!(
            "apparmor_parser -r /etc/apparmor.d/{}",
            profile_name
        ))
        .await?;
    Ok(true)
}

pub async fn create_profile(
    client: &MacClient,
    req: &CreateProfileRequest,
) -> MacResult<AppArmorProfile> {
    let template = req.template.as_deref().unwrap_or(
        r#"# AppArmor profile
#include <tunables/global>

{program} {{
  #include <abstractions/base>
  # Add rules here
}}
"#,
    );
    let content = template.replace("{program}", &req.program_path);
    let profile_name = req
        .program_path
        .rsplit('/')
        .next()
        .unwrap_or(&req.program_path);
    let dest = format!("/etc/apparmor.d/{}", profile_name);

    client
        .run_sudo_command(&format!(
            "cat > {} << 'SORNG_EOF'\n{}\nSORNG_EOF",
            dest, content
        ))
        .await?;
    client
        .run_sudo_command(&format!("apparmor_parser -r {}", dest))
        .await?;

    Ok(AppArmorProfile {
        name: profile_name.to_string(),
        mode: AppArmorMode::Enforce,
        pid_count: 0,
        source_path: Some(dest),
    })
}

pub async fn delete_profile(client: &MacClient, profile_name: &str) -> MacResult<bool> {
    client
        .run_sudo_command(&format!("aa-disable /etc/apparmor.d/{}", profile_name))
        .await?;
    client
        .run_sudo_command(&format!("rm -f /etc/apparmor.d/{}", profile_name))
        .await?;
    Ok(true)
}

pub async fn get_profile_content(client: &MacClient, profile_name: &str) -> MacResult<String> {
    client
        .run_command(&format!("cat /etc/apparmor.d/{}", profile_name))
        .await
}

pub async fn update_profile_content(
    client: &MacClient,
    profile_name: &str,
    content: &str,
) -> MacResult<bool> {
    let dest = format!("/etc/apparmor.d/{}", profile_name);
    client
        .run_sudo_command(&format!(
            "cat > {} << 'SORNG_EOF'\n{}\nSORNG_EOF",
            dest, content
        ))
        .await?;
    client
        .run_sudo_command(&format!("apparmor_parser -r {}", dest))
        .await?;
    Ok(true)
}

pub async fn audit_log(client: &MacClient, limit: u32) -> MacResult<Vec<AppArmorLogEntry>> {
    let out = client
        .run_command(&format!(
            "grep -i apparmor /var/log/audit/audit.log 2>/dev/null || grep -i apparmor /var/log/kern.log 2>/dev/null | tail -n {}",
            limit
        ))
        .await?;
    Ok(parse_apparmor_log(&out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_aa_status_text() {
        let output = "apparmor module is loaded.\n37 profiles are loaded.\n35 profiles are in enforce mode.\n2 profiles are in complain mode.\n0 profiles are in kill mode.\n0 profiles are in unconfined mode.\n19 processes have profiles defined.\n0 processes are unconfined.\n";
        let status = parse_aa_status(output).unwrap();
        assert_eq!(status.profiles_loaded, 37);
        assert_eq!(status.profiles_enforcing, 35);
        assert_eq!(status.profiles_complain, 2);
    }

    #[test]
    fn test_parse_aa_profiles() {
        let output = "   /usr/sbin/cupsd (enforce)\n   /usr/sbin/ntpd (complain)\n";
        let profiles = parse_aa_profiles(output);
        assert_eq!(profiles.len(), 2);
        assert_eq!(profiles[0].name, "/usr/sbin/cupsd");
        assert_eq!(profiles[0].mode, AppArmorMode::Enforce);
        assert_eq!(profiles[1].mode, AppArmorMode::Complain);
    }
}
