//! /etc/login.defs management.

use crate::client;
use crate::error::PamError;
use crate::types::{LoginDefs, PamHost};
use log::info;
use std::collections::HashMap;

// ─── Parsing ────────────────────────────────────────────────────────

const LOGIN_DEFS: &str = "/etc/login.defs";

/// Parse /etc/login.defs content into a LoginDefs structure.
pub fn parse_login_defs(content: &str) -> LoginDefs {
    let mut settings: HashMap<String, String> = HashMap::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let parts: Vec<&str> = trimmed.splitn(2, char::is_whitespace).collect();
        if parts.len() == 2 {
            settings.insert(parts[0].to_string(), parts[1].trim().to_string());
        }
    }

    LoginDefs { settings }
}

/// Serialize a LoginDefs back to file content.
///
/// Reads the original file to preserve comments and order, updating values
/// in-place and appending new keys at the end.
pub fn serialize_login_defs(original: &str, defs: &LoginDefs) -> String {
    let mut used_keys = std::collections::HashSet::new();
    let mut out = String::new();

    for line in original.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            out.push_str(line);
            out.push('\n');
            continue;
        }
        let parts: Vec<&str> = trimmed.splitn(2, char::is_whitespace).collect();
        if parts.len() == 2 {
            let key = parts[0];
            if let Some(new_value) = defs.settings.get(key) {
                out.push_str(&format!("{}\t{}\n", key, new_value));
                used_keys.insert(key.to_string());
            } else {
                // Key was removed — skip it
                used_keys.insert(key.to_string());
            }
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }

    // Append any new keys not in the original file
    for (key, value) in &defs.settings {
        if !used_keys.contains(key) {
            out.push_str(&format!("{}\t{}\n", key, value));
        }
    }

    out
}

/// Simple serialization (without preserving original structure).
pub fn serialize_login_defs_simple(defs: &LoginDefs) -> String {
    let mut out = String::new();
    out.push_str("# /etc/login.defs\n");
    out.push_str("#\n");

    let mut keys: Vec<&String> = defs.settings.keys().collect();
    keys.sort();

    for key in keys {
        if let Some(value) = defs.settings.get(key) {
            out.push_str(&format!("{}\t{}\n", key, value));
        }
    }
    out
}

// ─── Remote Operations ──────────────────────────────────────────────

/// Get login.defs from the host.
pub async fn get_login_defs(host: &PamHost) -> Result<LoginDefs, PamError> {
    let content = client::read_file(host, LOGIN_DEFS).await?;
    Ok(parse_login_defs(&content))
}

/// Get a single login.defs value.
pub async fn get_login_def(host: &PamHost, key: &str) -> Result<Option<String>, PamError> {
    let defs = get_login_defs(host).await?;
    Ok(defs.settings.get(key).cloned())
}

/// Set a single login.defs value (preserving the rest of the file).
pub async fn set_login_def(host: &PamHost, key: &str, value: &str) -> Result<(), PamError> {
    let original = client::read_file(host, LOGIN_DEFS).await?;
    let mut defs = parse_login_defs(&original);
    defs.settings.insert(key.to_string(), value.to_string());

    let new_content = serialize_login_defs(&original, &defs);
    client::write_file(host, LOGIN_DEFS, &new_content).await?;
    info!("Set login.defs {} = {}", key, value);
    Ok(())
}

/// Extract password-related settings from login.defs.
pub async fn get_password_policy(host: &PamHost) -> Result<HashMap<String, String>, PamError> {
    let defs = get_login_defs(host).await?;
    let password_keys = [
        "PASS_MAX_DAYS",
        "PASS_MIN_DAYS",
        "PASS_WARN_AGE",
        "PASS_MIN_LEN",
        "ENCRYPT_METHOD",
        "SHA_CRYPT_MIN_ROUNDS",
        "SHA_CRYPT_MAX_ROUNDS",
        "MD5_CRYPT_ENAB",
        "OBSCURE_CHECKS_ENAB",
        "LOGIN_RETRIES",
        "LOGIN_TIMEOUT",
        "FAILLOG_ENAB",
        "LOG_UNKFAIL_ENAB",
        "LOG_OK_LOGINS",
        "LASTLOG_ENAB",
    ];

    let mut policy = HashMap::new();
    for key in &password_keys {
        if let Some(value) = defs.settings.get(*key) {
            policy.insert(key.to_string(), value.clone());
        }
    }
    Ok(policy)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_login_defs() {
        let content = "\
# /etc/login.defs
#
# Comment

MAIL_DIR        /var/spool/mail
PASS_MAX_DAYS   99999
PASS_MIN_DAYS   0
PASS_WARN_AGE   7
UID_MIN                  1000
UID_MAX                 60000
SYS_UID_MIN               201
SYS_UID_MAX               999
GID_MIN                  1000
GID_MAX                 60000
CREATE_HOME     yes
UMASK           077
ENCRYPT_METHOD SHA512
";
        let defs = parse_login_defs(content);
        assert_eq!(defs.get("PASS_MAX_DAYS"), Some(&"99999".to_string()));
        assert_eq!(defs.get("PASS_MIN_DAYS"), Some(&"0".to_string()));
        assert_eq!(defs.get("UID_MIN"), Some(&"1000".to_string()));
        assert_eq!(defs.get("ENCRYPT_METHOD"), Some(&"SHA512".to_string()));
        assert_eq!(defs.get("UMASK"), Some(&"077".to_string()));
        assert_eq!(defs.get_i32("UID_MIN"), Some(1000));
        assert_eq!(defs.get_bool("CREATE_HOME"), Some(true));
    }

    #[test]
    fn test_parse_comments_and_blank() {
        let content = "\
# comment
  # indented comment

UID_MIN   500
";
        let defs = parse_login_defs(content);
        assert_eq!(defs.settings.len(), 1);
        assert_eq!(defs.get("UID_MIN"), Some(&"500".to_string()));
    }

    #[test]
    fn test_serialize_preserves_comments() {
        let original = "\
# /etc/login.defs
# Important file

PASS_MAX_DAYS   99999
PASS_MIN_DAYS   0
UMASK           077
";
        let mut defs = parse_login_defs(original);
        defs.settings
            .insert("PASS_MAX_DAYS".to_string(), "365".to_string());
        defs.settings
            .insert("NEW_KEY".to_string(), "new_value".to_string());

        let serialized = serialize_login_defs(original, &defs);
        assert!(serialized.contains("# /etc/login.defs"));
        assert!(serialized.contains("# Important file"));
        assert!(serialized.contains("PASS_MAX_DAYS\t365"));
        assert!(serialized.contains("PASS_MIN_DAYS\t0"));
        assert!(serialized.contains("UMASK\t077"));
        assert!(serialized.contains("NEW_KEY\tnew_value"));
        // Original value should be replaced
        assert!(!serialized.contains("PASS_MAX_DAYS\t99999"));
    }

    #[test]
    fn test_serialize_simple() {
        let mut settings = HashMap::new();
        settings.insert("UID_MIN".to_string(), "1000".to_string());
        settings.insert("PASS_MAX_DAYS".to_string(), "365".to_string());
        let defs = LoginDefs { settings };
        let serialized = serialize_login_defs_simple(&defs);
        assert!(serialized.contains("UID_MIN\t1000"));
        assert!(serialized.contains("PASS_MAX_DAYS\t365"));
    }
}
