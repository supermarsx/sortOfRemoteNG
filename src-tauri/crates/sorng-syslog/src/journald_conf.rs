//! journald.conf management — /etc/systemd/journald.conf
use crate::client;
use crate::error::SyslogError;
use crate::types::*;
use std::collections::HashMap;

pub async fn get_config(host: &SyslogHost) -> Result<JournaldConfig, SyslogError> {
    let content = client::read_file(host, "/etc/systemd/journald.conf").await?;
    Ok(parse_journald_conf(&content))
}

pub async fn restart(host: &SyslogHost) -> Result<(), SyslogError> {
    client::exec_ok(host, "systemctl", &["restart", "systemd-journald"]).await?;
    Ok(())
}

pub fn parse_journald_conf(content: &str) -> JournaldConfig {
    let mut settings = HashMap::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with('[') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            settings.insert(k.trim().to_string(), v.trim().to_string());
        }
    }
    let get_bool = |k: &str| settings.get(k).map(|v| v == "yes" || v == "true");
    let get_str = |k: &str| settings.get(k).cloned();
    let get_u32 = |k: &str| settings.get(k).and_then(|v| v.parse().ok());

    JournaldConfig {
        storage: get_str("Storage"),
        compress: get_bool("Compress"),
        seal: get_bool("Seal"),
        split_mode: get_str("SplitMode"),
        max_use: get_str("SystemMaxUse"),
        max_file_size: get_str("SystemMaxFileSize"),
        max_retention_sec: get_str("MaxRetentionSec"),
        max_level_store: get_str("MaxLevelStore"),
        max_level_syslog: get_str("MaxLevelSyslog"),
        max_level_console: get_str("MaxLevelConsole"),
        forward_to_syslog: get_bool("ForwardToSyslog"),
        forward_to_kmsg: get_bool("ForwardToKMsg"),
        forward_to_console: get_bool("ForwardToConsole"),
        forward_to_wall: get_bool("ForwardToWall"),
        rate_limit_interval_sec: get_u32("RateLimitIntervalSec"),
        rate_limit_burst: get_u32("RateLimitBurst"),
        all_settings: settings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_parse_journald() {
        let content = "[Journal]\nStorage=persistent\nCompress=yes\nSystemMaxUse=500M\nForwardToSyslog=no\nRateLimitBurst=10000\n";
        let cfg = parse_journald_conf(content);
        assert_eq!(cfg.storage, Some("persistent".into()));
        assert_eq!(cfg.compress, Some(true));
        assert_eq!(cfg.max_use, Some("500M".into()));
        assert_eq!(cfg.forward_to_syslog, Some(false));
        assert_eq!(cfg.rate_limit_burst, Some(10000));
    }
}
