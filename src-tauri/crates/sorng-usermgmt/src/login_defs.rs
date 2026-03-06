//! /etc/login.defs parser and editor.

use crate::error::UserMgmtError;
use crate::types::LoginDefs;
use std::collections::HashMap;

/// Parse /etc/login.defs content.
pub fn parse_login_defs(content: &str) -> LoginDefs {
    let mut settings: HashMap<String, String> = HashMap::new();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let parts: Vec<&str> = line.splitn(2, char::is_whitespace).collect();
        if parts.len() == 2 {
            settings.insert(parts[0].to_string(), parts[1].trim().to_string());
        }
    }

    LoginDefs {
        uid_min: get_u32(&settings, "UID_MIN", 1000),
        uid_max: get_u32(&settings, "UID_MAX", 60000),
        sys_uid_min: get_u32(&settings, "SYS_UID_MIN", 100),
        sys_uid_max: get_u32(&settings, "SYS_UID_MAX", 999),
        gid_min: get_u32(&settings, "GID_MIN", 1000),
        gid_max: get_u32(&settings, "GID_MAX", 60000),
        sys_gid_min: get_u32(&settings, "SYS_GID_MIN", 100),
        sys_gid_max: get_u32(&settings, "SYS_GID_MAX", 999),
        pass_max_days: get_i32(&settings, "PASS_MAX_DAYS", 99999),
        pass_min_days: get_i32(&settings, "PASS_MIN_DAYS", 0),
        pass_warn_age: get_i32(&settings, "PASS_WARN_AGE", 7),
        pass_min_len: settings.get("PASS_MIN_LEN").and_then(|v| v.parse().ok()),
        login_retries: settings.get("LOGIN_RETRIES").and_then(|v| v.parse().ok()),
        login_timeout: settings.get("LOGIN_TIMEOUT").and_then(|v| v.parse().ok()),
        create_home: settings.get("CREATE_HOME").map(|v| v == "yes").unwrap_or(true),
        default_home: settings.get("DEFAULT_HOME").cloned(),
        umask: settings.get("UMASK").cloned(),
        usergroups_enab: settings.get("USERGROUPS_ENAB").map(|v| v == "yes").unwrap_or(true),
        encrypt_method: settings.get("ENCRYPT_METHOD").cloned(),
        sha_crypt_rounds: settings.get("SHA_CRYPT_MAX_ROUNDS").and_then(|v| v.parse().ok()),
        all_settings: settings,
    }
}

fn get_u32(map: &HashMap<String, String>, key: &str, default: u32) -> u32 {
    map.get(key).and_then(|v| v.parse().ok()).unwrap_or(default)
}

fn get_i32(map: &HashMap<String, String>, key: &str, default: i32) -> i32 {
    map.get(key).and_then(|v| v.parse().ok()).unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_login_defs() {
        let content = "\
# Comment
UID_MIN                  1000
UID_MAX                 60000
SYS_UID_MIN               201
SYS_UID_MAX               999
PASS_MAX_DAYS            99999
PASS_MIN_DAYS              0
PASS_WARN_AGE              7
ENCRYPT_METHOD SHA512
CREATE_HOME     yes
UMASK           077
";
        let defs = parse_login_defs(content);
        assert_eq!(defs.uid_min, 1000);
        assert_eq!(defs.uid_max, 60000);
        assert_eq!(defs.sys_uid_min, 201);
        assert_eq!(defs.pass_max_days, 99999);
        assert_eq!(defs.encrypt_method, Some("SHA512".to_string()));
        assert_eq!(defs.umask, Some("077".to_string()));
        assert!(defs.create_home);
    }
}
