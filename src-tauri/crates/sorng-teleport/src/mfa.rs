//! # Teleport MFA Device Management
//!
//! Multi-factor authentication device registration, removal,
//! listing, and summary utilities.

use crate::types::*;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Build `tsh mfa ls` command.
pub fn list_mfa_devices_command(format_json: bool) -> Vec<String> {
    let mut cmd = vec![
        "tsh".to_string(),
        "mfa".to_string(),
        "ls".to_string(),
    ];
    if format_json {
        cmd.push("--format=json".to_string());
    }
    cmd
}

/// Build `tsh mfa add` command to register a new MFA device.
pub fn add_mfa_device_command(name: &str, device_type: MfaDeviceType) -> Vec<String> {
    let t = match device_type {
        MfaDeviceType::Totp => "totp",
        MfaDeviceType::WebAuthn => "webauthn",
        MfaDeviceType::Sso => "sso",
    };
    vec![
        "tsh".to_string(),
        "mfa".to_string(),
        "add".to_string(),
        format!("--name={}", name),
        format!("--type={}", t),
    ]
}

/// Build `tsh mfa rm` command to remove an MFA device.
pub fn remove_mfa_device_command(name: &str) -> Vec<String> {
    vec![
        "tsh".to_string(),
        "mfa".to_string(),
        "rm".to_string(),
        name.to_string(),
    ]
}

/// Group MFA devices by type.
pub fn group_by_type<'a>(
    devices: &[&'a MfaDevice],
) -> HashMap<String, Vec<&'a MfaDevice>> {
    let mut map: HashMap<String, Vec<&'a MfaDevice>> = HashMap::new();
    for d in devices {
        map.entry(format!("{:?}", d.device_type))
            .or_default()
            .push(d);
    }
    map
}

/// Filter devices that have been used recently (within threshold).
pub fn recently_used<'a>(
    devices: &[&'a MfaDevice],
    now: DateTime<Utc>,
    threshold_secs: i64,
) -> Vec<&'a MfaDevice> {
    devices
        .iter()
        .filter(|d| {
            d.last_used.map_or(false, |lu| {
                (now - lu).num_seconds() < threshold_secs
            })
        })
        .copied()
        .collect()
}

/// MFA summary.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MfaSummary {
    pub total: u32,
    pub totp: u32,
    pub webauthn: u32,
    pub sso: u32,
    pub never_used: u32,
}

pub fn summarize_mfa(devices: &[&MfaDevice]) -> MfaSummary {
    MfaSummary {
        total: devices.len() as u32,
        totp: devices.iter().filter(|d| d.device_type == MfaDeviceType::Totp).count() as u32,
        webauthn: devices
            .iter()
            .filter(|d| d.device_type == MfaDeviceType::WebAuthn)
            .count() as u32,
        sso: devices.iter().filter(|d| d.device_type == MfaDeviceType::Sso).count() as u32,
        never_used: devices.iter().filter(|d| d.last_used.is_none()).count() as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn sample_device(name: &str, dt: MfaDeviceType) -> MfaDevice {
        MfaDevice {
            id: format!("dev-{}", name),
            name: name.to_string(),
            device_type: dt,
            added_at: Utc::now() - Duration::days(30),
            last_used: Some(Utc::now() - Duration::hours(1)),
        }
    }

    #[test]
    fn test_add_mfa_command() {
        let cmd = add_mfa_device_command("yubikey", MfaDeviceType::WebAuthn);
        assert!(cmd.contains(&"--name=yubikey".to_string()));
        assert!(cmd.contains(&"--type=webauthn".to_string()));
    }

    #[test]
    fn test_remove_mfa_command() {
        let cmd = remove_mfa_device_command("yubikey");
        assert_eq!(cmd[3], "yubikey");
    }

    #[test]
    fn test_summarize_mfa() {
        let d1 = sample_device("totp-1", MfaDeviceType::Totp);
        let d2 = sample_device("weba-1", MfaDeviceType::WebAuthn);
        let summary = summarize_mfa(&[&d1, &d2]);
        assert_eq!(summary.total, 2);
        assert_eq!(summary.totp, 1);
        assert_eq!(summary.webauthn, 1);
    }

    #[test]
    fn test_recently_used() {
        let d1 = sample_device("key1", MfaDeviceType::Totp);
        let now = Utc::now();
        let recent = recently_used(&[&d1], now, 7200);
        assert_eq!(recent.len(), 1);
        let not_recent = recently_used(&[&d1], now, 60);
        assert_eq!(not_recent.len(), 0);
    }
}
