// ── sorng-mac/src/tomoyo.rs ───────────────────────────────────────────────────
//! TOMOYO Linux management — domain management, policy editing, learning mode.

use crate::client::MacClient;
use crate::error::MacResult;
use crate::types::*;

/// Parse TOMOYO status from /sys/kernel/security/tomoyo/stat.
pub fn parse_tomoyo_status(output: &str) -> TomoyoStatus {
    fn count_mode(lines: &[&str], mode: &str) -> u32 {
        lines
            .iter()
            .filter(|l| l.to_lowercase().contains(mode))
            .count() as u32
    }
    let lines: Vec<&str> = output.lines().collect();
    let enabled = !output.trim().is_empty();
    TomoyoStatus {
        enabled,
        learning_domains: count_mode(&lines, "learning"),
        enforcing_domains: count_mode(&lines, "enforcing"),
        permissive_domains: count_mode(&lines, "permissive"),
    }
}

/// Parse domain list from /sys/kernel/security/tomoyo/domain_policy.
pub fn parse_domain_list(output: &str) -> Vec<TomoyoDomain> {
    let mut domains = Vec::new();
    let mut current_name: Option<String> = None;
    let mut current_mode = TomoyoMode::Disabled;
    let mut rules_count: u32 = 0;

    for line in output.lines() {
        let line = line.trim();
        if line.starts_with('<') {
            // Save previous domain
            if let Some(name) = current_name.take() {
                domains.push(TomoyoDomain {
                    name,
                    mode: current_mode.clone(),
                    rules_count,
                });
            }
            current_name = Some(line.to_string());
            current_mode = TomoyoMode::Disabled;
            rules_count = 0;
        } else if line.starts_with("use_profile") {
            if let Some(n) = line.split_whitespace().nth(1) {
                current_mode = match n {
                    "0" => TomoyoMode::Disabled,
                    "1" => TomoyoMode::Learning,
                    "2" => TomoyoMode::Permissive,
                    "3" => TomoyoMode::Enforcing,
                    _ => TomoyoMode::Disabled,
                };
            }
        } else if !line.is_empty() {
            rules_count += 1;
        }
    }

    // Final domain
    if let Some(name) = current_name {
        domains.push(TomoyoDomain {
            name,
            mode: current_mode,
            rules_count,
        });
    }

    domains
}

/// Parse rules for a specific domain.
pub fn parse_domain_rules(output: &str, domain: &str) -> Vec<TomoyoRule> {
    output
        .lines()
        .filter(|l| !l.trim().is_empty() && !l.starts_with('<') && !l.starts_with("use_profile"))
        .map(|line| {
            let parts: Vec<&str> = line.splitn(2, ' ').collect();
            TomoyoRule {
                domain: domain.to_string(),
                permission: parts.first().unwrap_or(&"").to_string(),
                target: parts.get(1).unwrap_or(&"").to_string(),
            }
        })
        .collect()
}

// ── Remote operations ────────────────────────────────────────────────────────

pub async fn get_status(client: &MacClient) -> MacResult<TomoyoStatus> {
    let out = client
        .run_command("cat /sys/kernel/security/tomoyo/stat 2>/dev/null || echo ''")
        .await?;
    Ok(parse_tomoyo_status(&out))
}

pub async fn list_domains(client: &MacClient) -> MacResult<Vec<TomoyoDomain>> {
    let out = client
        .run_command("cat /sys/kernel/security/tomoyo/domain_policy 2>/dev/null || echo ''")
        .await?;
    Ok(parse_domain_list(&out))
}

pub async fn set_domain_mode(client: &MacClient, req: &SetDomainModeRequest) -> MacResult<bool> {
    let profile = req.mode.to_flag();
    let cmd = format!(
        "echo 'select {}' > /sys/kernel/security/tomoyo/domain_policy && echo 'use_profile {}' > /sys/kernel/security/tomoyo/domain_policy",
        req.domain, profile
    );
    client.run_sudo_command(&cmd).await?;
    Ok(true)
}

pub async fn list_rules(client: &MacClient, domain: &str) -> MacResult<Vec<TomoyoRule>> {
    let out = client
        .run_command(&format!(
            "echo 'select {}' > /sys/kernel/security/tomoyo/domain_policy && cat /sys/kernel/security/tomoyo/domain_policy",
            domain
        ))
        .await?;
    Ok(parse_domain_rules(&out, domain))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_tomoyo_status() {
        let output = "Policy update: 0\nlearning domains: 2\nenforcing domains: 1\npermissive domains: 3\n";
        let status = parse_tomoyo_status(output);
        assert!(status.enabled);
        assert_eq!(status.learning_domains, 2);
        assert_eq!(status.enforcing_domains, 1);
        assert_eq!(status.permissive_domains, 3);
    }

    #[test]
    fn test_parse_domain_list() {
        let output = "<kernel>\nuse_profile 3\nfile read /etc/ld.so.cache\nfile read /lib/*\n\n<kernel> /usr/sbin/sshd\nuse_profile 1\nnetwork inet stream listen\n";
        let domains = parse_domain_list(output);
        assert_eq!(domains.len(), 2);
        assert_eq!(domains[0].name, "<kernel>");
        assert_eq!(domains[0].mode, TomoyoMode::Enforcing);
        assert_eq!(domains[0].rules_count, 2);
        assert_eq!(domains[1].mode, TomoyoMode::Learning);
    }

    #[test]
    fn test_parse_domain_rules() {
        let output = "file read /etc/passwd\nfile write /tmp/*\n";
        let rules = parse_domain_rules(output, "<kernel>");
        assert_eq!(rules.len(), 2);
        assert_eq!(rules[0].permission, "file");
        assert_eq!(rules[0].target, "read /etc/passwd");
    }
}
