// ── ClamAV milter management ─────────────────────────────────────────────────

use crate::client::ClamavClient;
use crate::error::ClamavResult;
use crate::types::*;

const MILTER_CONF_PATH: &str = "/etc/clamav/clamav-milter.conf";

pub struct MilterManager;

impl MilterManager {
    /// Get current milter configuration.
    pub async fn get_config(client: &ClamavClient) -> ClamavResult<MilterConfig> {
        let content = client.read_remote_file(MILTER_CONF_PATH).await?;
        Ok(parse_milter_config(&content))
    }

    /// Set milter configuration.
    pub async fn set_config(client: &ClamavClient, config: &MilterConfig) -> ClamavResult<()> {
        let content = client.read_remote_file(MILTER_CONF_PATH).await?;
        let new_content = apply_milter_config(&content, config);
        client
            .write_remote_file(MILTER_CONF_PATH, &new_content)
            .await
    }

    /// Enable the milter.
    pub async fn enable(client: &ClamavClient) -> ClamavResult<()> {
        client
            .exec_ssh("sudo systemctl enable clamav-milter && sudo systemctl start clamav-milter")
            .await?;
        Ok(())
    }

    /// Disable the milter.
    pub async fn disable(client: &ClamavClient) -> ClamavResult<()> {
        client
            .exec_ssh("sudo systemctl stop clamav-milter && sudo systemctl disable clamav-milter")
            .await?;
        Ok(())
    }
}

// ─── Parsing helpers ─────────────────────────────────────────────────────────

fn parse_milter_config(content: &str) -> MilterConfig {
    let mut enabled = false;
    let mut socket = String::from("/var/run/clamav/clamav-milter.ctl");
    let mut condition = None;
    let mut add_header = None;
    let mut reject_infected = None;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.is_empty() {
            continue;
        }

        if let Some((key, value)) = trimmed.split_once(char::is_whitespace) {
            let value = value.trim();
            match key {
                "MilterSocket" => socket = value.to_string(),
                "ClamdSocket" => { /* clamd socket reference */ }
                "OnInfected" => {
                    if value.to_lowercase() == "reject" {
                        reject_infected = Some(true);
                    } else {
                        reject_infected = Some(false);
                    }
                }
                "AddHeader" => {
                    add_header = Some(
                        value.to_lowercase() == "yes"
                            || value.to_lowercase() == "replace"
                            || value.to_lowercase() == "add",
                    );
                }
                "RejectMsg" => { /* store if needed */ }
                "VirusAction" => condition = Some(value.to_string()),
                _ => {}
            }
        }
    }

    // Check if service is referenced (heuristic: non-empty config = enabled)
    if !socket.is_empty() {
        enabled = true;
    }

    MilterConfig {
        enabled,
        socket,
        condition,
        add_header,
        reject_infected,
    }
}

fn apply_milter_config(content: &str, config: &MilterConfig) -> String {
    let milter_keys = ["MilterSocket", "OnInfected", "AddHeader", "VirusAction"];

    let mut lines: Vec<String> = content
        .lines()
        .filter(|line| {
            let trimmed = line.trim();
            if trimmed.starts_with('#') || trimmed.is_empty() {
                return true;
            }
            if let Some((key, _)) = trimmed.split_once(char::is_whitespace) {
                !milter_keys.contains(&key)
            } else {
                true
            }
        })
        .map(|l| l.to_string())
        .collect();

    // Append milter config
    lines.push(String::new());
    lines.push("# Milter configuration".to_string());
    lines.push(format!("MilterSocket {}", config.socket));

    if let Some(ref cond) = config.condition {
        lines.push(format!("VirusAction {}", cond));
    }

    if let Some(add_hdr) = config.add_header {
        lines.push(format!(
            "AddHeader {}",
            if add_hdr { "Replace" } else { "No" }
        ));
    }

    if let Some(reject) = config.reject_infected {
        lines.push(format!(
            "OnInfected {}",
            if reject { "Reject" } else { "Quarantine" }
        ));
    }

    lines.join("\n") + "\n"
}
