//! /etc/security/pwquality.conf management and password testing.

use crate::client;
use crate::error::PamError;
use crate::types::{PamHost, PwQualityConfig};
use log::info;
use std::collections::HashMap;

// ─── Parsing ────────────────────────────────────────────────────────

const PWQUALITY_CONF: &str = "/etc/security/pwquality.conf";

/// Parse a single pwquality.conf line.
fn parse_pwquality_line(line: &str) -> Option<(String, String)> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }

    let parts: Vec<&str> = trimmed.splitn(2, '=').collect();
    if parts.len() != 2 {
        return None;
    }

    Some((
        parts[0].trim().to_string(),
        parts[1].trim().to_string(),
    ))
}

/// Parse pwquality.conf content into a PwQualityConfig.
pub fn parse_pwquality(content: &str) -> PwQualityConfig {
    let mut settings: HashMap<String, String> = HashMap::new();

    for line in content.lines() {
        if let Some((key, value)) = parse_pwquality_line(line) {
            settings.insert(key, value);
        }
    }

    PwQualityConfig {
        difok: get_i32(&settings, "difok"),
        minlen: get_i32(&settings, "minlen"),
        dcredit: get_i32(&settings, "dcredit"),
        ucredit: get_i32(&settings, "ucredit"),
        lcredit: get_i32(&settings, "lcredit"),
        ocredit: get_i32(&settings, "ocredit"),
        minclass: get_i32(&settings, "minclass"),
        maxrepeat: get_i32(&settings, "maxrepeat"),
        maxsequence: get_i32(&settings, "maxsequence"),
        maxclassrepeat: get_i32(&settings, "maxclassrepeat"),
        gecoscheck: get_bool(&settings, "gecoscheck"),
        dictcheck: get_bool(&settings, "dictcheck"),
        usercheck: get_bool(&settings, "usercheck"),
        enforcing: get_bool(&settings, "enforcing"),
        all_settings: settings,
    }
}

fn get_i32(map: &HashMap<String, String>, key: &str) -> Option<i32> {
    map.get(key).and_then(|v| v.parse().ok())
}

fn get_bool(map: &HashMap<String, String>, key: &str) -> Option<bool> {
    map.get(key).map(|v| v == "1" || v.to_lowercase() == "true")
}

/// Serialize a PwQualityConfig back to file content.
pub fn serialize_pwquality(config: &PwQualityConfig) -> String {
    let mut out = String::new();
    out.push_str("# /etc/security/pwquality.conf\n");
    out.push_str("# Configuration for the pam_pwquality module.\n");
    out.push_str("#\n");

    let mut emit = |key: &str, val: &str| {
        out.push_str(&format!("{} = {}\n", key, val));
    };

    if let Some(v) = config.difok { emit("difok", &v.to_string()); }
    if let Some(v) = config.minlen { emit("minlen", &v.to_string()); }
    if let Some(v) = config.dcredit { emit("dcredit", &v.to_string()); }
    if let Some(v) = config.ucredit { emit("ucredit", &v.to_string()); }
    if let Some(v) = config.lcredit { emit("lcredit", &v.to_string()); }
    if let Some(v) = config.ocredit { emit("ocredit", &v.to_string()); }
    if let Some(v) = config.minclass { emit("minclass", &v.to_string()); }
    if let Some(v) = config.maxrepeat { emit("maxrepeat", &v.to_string()); }
    if let Some(v) = config.maxsequence { emit("maxsequence", &v.to_string()); }
    if let Some(v) = config.maxclassrepeat { emit("maxclassrepeat", &v.to_string()); }
    if let Some(v) = config.gecoscheck { emit("gecoscheck", if v { "1" } else { "0" }); }
    if let Some(v) = config.dictcheck { emit("dictcheck", if v { "1" } else { "0" }); }
    if let Some(v) = config.usercheck { emit("usercheck", if v { "1" } else { "0" }); }
    if let Some(v) = config.enforcing { emit("enforcing", if v { "1" } else { "0" }); }

    // Emit any extra settings not covered by typed fields
    let known: std::collections::HashSet<&str> = [
        "difok", "minlen", "dcredit", "ucredit", "lcredit", "ocredit", "minclass",
        "maxrepeat", "maxsequence", "maxclassrepeat", "gecoscheck", "dictcheck",
        "usercheck", "enforcing",
    ]
    .iter()
    .copied()
    .collect();

    for (key, value) in &config.all_settings {
        if !known.contains(key.as_str()) {
            out.push_str(&format!("{} = {}\n", key, value));
        }
    }

    out
}

// ─── Remote Operations ──────────────────────────────────────────────

/// Get the full password quality configuration.
pub async fn get_pwquality(host: &PamHost) -> Result<PwQualityConfig, PamError> {
    let content = client::read_file(host, PWQUALITY_CONF).await?;
    Ok(parse_pwquality(&content))
}

/// Set the full password quality configuration.
pub async fn set_pwquality(host: &PamHost, config: &PwQualityConfig) -> Result<(), PamError> {
    let content = serialize_pwquality(config);
    client::write_file(host, PWQUALITY_CONF, &content).await?;
    info!("Updated {}", PWQUALITY_CONF);
    Ok(())
}

/// Get a single pwquality parameter value.
pub async fn get_pwquality_param(
    host: &PamHost,
    key: &str,
) -> Result<Option<String>, PamError> {
    let config = get_pwquality(host).await?;
    Ok(config.all_settings.get(key).cloned())
}

/// Set a single pwquality parameter.
pub async fn set_pwquality_param(
    host: &PamHost,
    key: &str,
    value: &str,
) -> Result<(), PamError> {
    let mut config = get_pwquality(host).await?;
    config.all_settings.insert(key.to_string(), value.to_string());

    // Update typed fields if applicable
    match key {
        "difok" => config.difok = value.parse().ok(),
        "minlen" => config.minlen = value.parse().ok(),
        "dcredit" => config.dcredit = value.parse().ok(),
        "ucredit" => config.ucredit = value.parse().ok(),
        "lcredit" => config.lcredit = value.parse().ok(),
        "ocredit" => config.ocredit = value.parse().ok(),
        "minclass" => config.minclass = value.parse().ok(),
        "maxrepeat" => config.maxrepeat = value.parse().ok(),
        "maxsequence" => config.maxsequence = value.parse().ok(),
        "maxclassrepeat" => config.maxclassrepeat = value.parse().ok(),
        "gecoscheck" => config.gecoscheck = Some(value == "1"),
        "dictcheck" => config.dictcheck = Some(value == "1"),
        "usercheck" => config.usercheck = Some(value == "1"),
        "enforcing" => config.enforcing = Some(value == "1"),
        _ => {}
    }

    set_pwquality(host, &config).await
}

/// Test a password against the system's password quality rules.
///
/// Returns a list of failure messages (empty = password passes).
/// Uses `pwscore` if available, falls back to `cracklib-check`.
pub async fn test_password(host: &PamHost, password: &str) -> Result<Vec<String>, PamError> {
    let escaped = password.replace('\'', "'\\''");
    let mut failures = Vec::new();

    // Try pwscore first
    let pwscore_cmd = format!("echo '{}' | pwscore 2>&1", escaped);
    let (stdout, stderr, exit_code) =
        client::exec(host, "sh", &["-c", &pwscore_cmd]).await?;

    if exit_code == 0 {
        // pwscore outputs a numeric score; anything non-error means pass
        return Ok(Vec::new());
    }

    // pwscore failed — collect its error message
    let msg = if !stderr.is_empty() {
        stderr.trim().to_string()
    } else {
        stdout.trim().to_string()
    };
    if !msg.is_empty() && !msg.contains("not found") && !msg.contains("No such file") {
        failures.push(msg);
        return Ok(failures);
    }

    // Fallback to cracklib-check
    let cracklib_cmd = format!("echo '{}' | cracklib-check 2>&1", escaped);
    let (stdout, _, exit_code) =
        client::exec(host, "sh", &["-c", &cracklib_cmd]).await?;

    if exit_code != 0 || stdout.is_empty() {
        // Neither tool available
        return Err(PamError::CommandNotFound(
            "Neither pwscore nor cracklib-check found on host".to_string(),
        ));
    }

    // cracklib-check format: "password: OK" or "password: reason"
    let output = stdout.trim();
    if let Some(colon_idx) = output.rfind(':') {
        let result = output[colon_idx + 1..].trim();
        if result != "OK" {
            failures.push(result.to_string());
        }
    }

    Ok(failures)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_pwquality() {
        let content = "\
# Configuration for the pam_pwquality module
difok = 5
minlen = 12
dcredit = -1
ucredit = -1
lcredit = -1
ocredit = -1
minclass = 3
maxrepeat = 3
gecoscheck = 1
dictcheck = 1
usercheck = 1
enforcing = 1
";
        let config = parse_pwquality(content);
        assert_eq!(config.difok, Some(5));
        assert_eq!(config.minlen, Some(12));
        assert_eq!(config.dcredit, Some(-1));
        assert_eq!(config.ucredit, Some(-1));
        assert_eq!(config.lcredit, Some(-1));
        assert_eq!(config.ocredit, Some(-1));
        assert_eq!(config.minclass, Some(3));
        assert_eq!(config.maxrepeat, Some(3));
        assert_eq!(config.gecoscheck, Some(true));
        assert_eq!(config.dictcheck, Some(true));
        assert_eq!(config.usercheck, Some(true));
        assert_eq!(config.enforcing, Some(true));
    }

    #[test]
    fn test_parse_comments_and_empty() {
        let content = "\
# comment
  # indented comment

difok = 3
";
        let config = parse_pwquality(content);
        assert_eq!(config.difok, Some(3));
        // only difok should be set
        assert_eq!(config.minlen, None);
    }

    #[test]
    fn test_serialize_roundtrip() {
        let config = PwQualityConfig {
            difok: Some(5),
            minlen: Some(8),
            dcredit: Some(-1),
            ucredit: None,
            lcredit: None,
            ocredit: None,
            minclass: Some(2),
            maxrepeat: None,
            maxsequence: None,
            maxclassrepeat: None,
            gecoscheck: Some(true),
            dictcheck: Some(true),
            usercheck: None,
            enforcing: Some(true),
            all_settings: HashMap::new(),
        };
        let serialized = serialize_pwquality(&config);
        let reparsed = parse_pwquality(&serialized);
        assert_eq!(reparsed.difok, Some(5));
        assert_eq!(reparsed.minlen, Some(8));
        assert_eq!(reparsed.dcredit, Some(-1));
        assert_eq!(reparsed.minclass, Some(2));
        assert_eq!(reparsed.gecoscheck, Some(true));
        assert_eq!(reparsed.enforcing, Some(true));
    }

    #[test]
    fn test_serialize_with_extra_settings() {
        let mut all = HashMap::new();
        all.insert("retry".to_string(), "3".to_string());
        all.insert("local_users_only".to_string(), "1".to_string());

        let config = PwQualityConfig {
            difok: Some(3),
            all_settings: all,
            ..Default::default()
        };
        let serialized = serialize_pwquality(&config);
        assert!(serialized.contains("difok = 3"));
        assert!(serialized.contains("retry = 3"));
        assert!(serialized.contains("local_users_only = 1"));
    }
}
