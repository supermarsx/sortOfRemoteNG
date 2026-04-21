//! # Teleport Windows Desktop Access
//!
//! List Windows desktops, connect via TDP (Teleport Desktop Protocol),
//! manage desktop sessions, clipboard/directory sharing config.

use crate::types::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Build `tsh desktop ls` command.
pub fn list_desktops_command(cluster: Option<&str>, format_json: bool) -> Vec<String> {
    let mut cmd = vec!["tsh".to_string(), "desktop".to_string(), "ls".to_string()];
    if let Some(c) = cluster {
        cmd.push(format!("--cluster={}", c));
    }
    if format_json {
        cmd.push("--format=json".to_string());
    }
    cmd
}

/// Build `tsh desktop play <session-id>` for recording playback.
pub fn desktop_play_command(session_id: &str) -> Vec<String> {
    vec![
        "tsh".to_string(),
        "play".to_string(),
        session_id.to_string(),
    ]
}

/// Desktop settings that affect session behaviour.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesktopSessionSettings {
    pub clipboard_enabled: bool,
    pub directory_sharing_enabled: bool,
    pub screen_width: Option<u32>,
    pub screen_height: Option<u32>,
}

impl Default for DesktopSessionSettings {
    fn default() -> Self {
        Self {
            clipboard_enabled: true,
            directory_sharing_enabled: true,
            screen_width: None,
            screen_height: None,
        }
    }
}

/// Group desktops by domain.
pub fn group_desktops_by_domain<'a>(
    desktops: &[&'a TeleportDesktop],
) -> HashMap<String, Vec<&'a TeleportDesktop>> {
    let mut map: HashMap<String, Vec<&TeleportDesktop>> = HashMap::new();
    for d in desktops {
        map.entry(d.domain.clone()).or_default().push(d);
    }
    map
}

/// Desktop summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesktopSummary {
    pub total: u32,
    pub online: u32,
    pub offline: u32,
    pub ad_joined: u32,
    pub non_ad: u32,
    pub domains: u32,
}

pub fn summarize_desktops(desktops: &[&TeleportDesktop]) -> DesktopSummary {
    let domains = group_desktops_by_domain(desktops);
    DesktopSummary {
        total: desktops.len() as u32,
        online: desktops
            .iter()
            .filter(|d| d.status == ResourceStatus::Online)
            .count() as u32,
        offline: desktops
            .iter()
            .filter(|d| d.status == ResourceStatus::Offline)
            .count() as u32,
        ad_joined: desktops.iter().filter(|d| !d.non_ad).count() as u32,
        non_ad: desktops.iter().filter(|d| d.non_ad).count() as u32,
        domains: domains.len() as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_desktop(id: &str, domain: &str, non_ad: bool) -> TeleportDesktop {
        TeleportDesktop {
            id: id.into(),
            name: id.into(),
            address: "10.0.0.1".into(),
            domain: domain.into(),
            labels: HashMap::new(),
            cluster_name: "root".into(),
            host_id: None,
            logins: vec!["Administrator".into()],
            non_ad,
            status: ResourceStatus::Online,
        }
    }

    #[test]
    fn test_group_desktops_by_domain() {
        let d1 = make_desktop("d1", "corp.example.com", false);
        let d2 = make_desktop("d2", "corp.example.com", false);
        let d3 = make_desktop("d3", "lab.example.com", false);
        let map = group_desktops_by_domain(&[&d1, &d2, &d3]);
        assert_eq!(map.len(), 2);
        assert_eq!(map.get("corp.example.com").unwrap().len(), 2);
    }

    #[test]
    fn test_summarize_desktops() {
        let d1 = make_desktop("d1", "corp", false);
        let d2 = make_desktop("d2", "corp", true);
        let summary = summarize_desktops(&[&d1, &d2]);
        assert_eq!(summary.total, 2);
        assert_eq!(summary.ad_joined, 1);
        assert_eq!(summary.non_ad, 1);
    }
}
