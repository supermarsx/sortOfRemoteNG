// ── sorng-mac/src/smack.rs ────────────────────────────────────────────────────
//! SMACK (Simplified Mandatory Access Control Kernel) label and rule management.

use crate::client::MacClient;
use crate::error::MacResult;
use crate::types::*;

/// Parse SMACK status from /smack/access and related pseudo-files.
pub fn parse_smack_status(mount_output: &str, load_output: &str) -> SmackStatus {
    let enabled = mount_output.contains("smackfs");
    let rules_count = load_output.lines().filter(|l| !l.trim().is_empty()).count() as u32;
    let labels: Vec<&str> = load_output
        .lines()
        .filter_map(|l| l.split_whitespace().next())
        .collect();
    let unique_labels: std::collections::HashSet<&&str> = labels.iter().collect();
    SmackStatus {
        enabled,
        labels_count: unique_labels.len() as u32,
        rules_count,
        default_label: "_".to_string(),
    }
}

/// Parse SMACK labels from /proc entries and attr.
pub fn parse_smack_labels(output: &str) -> Vec<SmackLabel> {
    let mut label_map: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    for line in output.lines() {
        let label = line.trim().to_string();
        if !label.is_empty() {
            *label_map.entry(label).or_insert(0) += 1;
        }
    }
    label_map
        .into_iter()
        .map(|(name, count)| SmackLabel {
            name,
            associated_processes: count,
            access_count: 0,
        })
        .collect()
}

/// Parse SMACK load rules from /smack/load2 or smackctl.
pub fn parse_smack_rules(output: &str) -> Vec<SmackRule> {
    output
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 3 {
                Some(SmackRule {
                    subject: parts[0].to_string(),
                    object: parts[1].to_string(),
                    access: parts[2].to_string(),
                })
            } else {
                None
            }
        })
        .collect()
}

// ── Remote operations ────────────────────────────────────────────────────────

pub async fn get_status(client: &MacClient) -> MacResult<SmackStatus> {
    let mount = client.run_command("mount | grep smackfs").await?;
    let load = client
        .run_command("cat /sys/fs/smackfs/load2 2>/dev/null || echo ''")
        .await?;
    Ok(parse_smack_status(&mount, &load))
}

pub async fn list_labels(client: &MacClient) -> MacResult<Vec<SmackLabel>> {
    let out = client
        .run_command("cat /proc/*/attr/current 2>/dev/null | sort | uniq -c | sort -rn")
        .await?;
    Ok(parse_smack_labels(&out))
}

pub async fn list_rules(client: &MacClient) -> MacResult<Vec<SmackRule>> {
    let out = client
        .run_command("cat /sys/fs/smackfs/load2 2>/dev/null || echo ''")
        .await?;
    Ok(parse_smack_rules(&out))
}

pub async fn add_rule(client: &MacClient, req: &AddSmackRuleRequest) -> MacResult<bool> {
    let rule = format!("{} {} {}", req.subject, req.object, req.access);
    client
        .run_sudo_command(&format!("echo '{}' > /sys/fs/smackfs/load2", rule))
        .await?;
    Ok(true)
}

pub async fn remove_rule(client: &MacClient, subject: &str, object: &str) -> MacResult<bool> {
    // Remove by writing empty access
    let rule = format!("{} {} ---", subject, object);
    client
        .run_sudo_command(&format!("echo '{}' > /sys/fs/smackfs/load2", rule))
        .await?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_smack_status() {
        let mount = "smackfs on /sys/fs/smackfs type smackfs (rw,relatime)";
        let load = "system web rwx\nsystem db rx\n";
        let status = parse_smack_status(mount, load);
        assert!(status.enabled);
        assert_eq!(status.rules_count, 2);
        assert_eq!(status.labels_count, 1); // "system" is the only subject
    }

    #[test]
    fn test_parse_smack_rules() {
        let output = "system web rwx\nuser data rx\n";
        let rules = parse_smack_rules(output);
        assert_eq!(rules.len(), 2);
        assert_eq!(rules[0].subject, "system");
        assert_eq!(rules[0].object, "web");
        assert_eq!(rules[0].access, "rwx");
    }

    #[test]
    fn test_parse_smack_labels() {
        let output = "system\nweb\nsystem\ndb\n";
        let labels = parse_smack_labels(output);
        assert_eq!(labels.len(), 3);
        let system = labels.iter().find(|l| l.name == "system").unwrap();
        assert_eq!(system.associated_processes, 2);
    }
}
