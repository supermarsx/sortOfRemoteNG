//! /etc/shadow parser — password hashes and aging info.

use crate::types::*;

/// Parse /etc/shadow content into entries.
pub fn parse_shadow(content: &str) -> Vec<ShadowEntry> {
    content
        .lines()
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .filter_map(parse_shadow_line)
        .collect()
}

/// Get shadow entry for a specific user.
pub fn get_shadow_entry(content: &str, username: &str) -> Option<ShadowEntry> {
    parse_shadow(content)
        .into_iter()
        .find(|e| e.username == username)
}

fn parse_shadow_line(line: &str) -> Option<ShadowEntry> {
    let f: Vec<&str> = line.split(':').collect();
    if f.len() < 9 {
        return None;
    }

    let password_hash = f[1].to_string();
    let hash_algorithm = detect_hash_algorithm(&password_hash);

    Some(ShadowEntry {
        username: f[0].to_string(),
        password_hash,
        last_change: parse_opt_i64(f[2]),
        min_days: parse_opt_i32(f[3]),
        max_days: parse_opt_i32(f[4]),
        warn_days: parse_opt_i32(f[5]),
        inactive_days: parse_opt_i32(f[6]),
        expire_date: parse_opt_i64(f[7]),
        hash_algorithm,
    })
}

fn detect_hash_algorithm(hash: &str) -> PasswordHashAlgorithm {
    if hash == "!" || hash == "!!" || hash.starts_with("!$") {
        PasswordHashAlgorithm::Locked
    } else if hash == "*" || hash.is_empty() {
        PasswordHashAlgorithm::NoPassword
    } else if hash.starts_with("$1$") {
        PasswordHashAlgorithm::Md5
    } else if hash.starts_with("$5$") {
        PasswordHashAlgorithm::Sha256
    } else if hash.starts_with("$6$") {
        PasswordHashAlgorithm::Sha512
    } else if hash.starts_with("$2b$") || hash.starts_with("$2a$") || hash.starts_with("$2y$") {
        PasswordHashAlgorithm::Blowfish
    } else if hash.starts_with("$y$") {
        PasswordHashAlgorithm::Yescrypt
    } else {
        PasswordHashAlgorithm::Unknown
    }
}

fn parse_opt_i64(s: &str) -> Option<i64> {
    if s.is_empty() {
        None
    } else {
        s.parse().ok()
    }
}

fn parse_opt_i32(s: &str) -> Option<i32> {
    if s.is_empty() {
        None
    } else {
        s.parse().ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_shadow_entry() {
        let line = "root:$6$salt$hash:19000:0:99999:7:::";
        let entry = parse_shadow_line(line).unwrap();
        assert_eq!(entry.username, "root");
        assert_eq!(entry.hash_algorithm, PasswordHashAlgorithm::Sha512);
        assert_eq!(entry.max_days, Some(99999));
    }

    #[test]
    fn test_locked_account() {
        let line = "nobody:!:19000:0:99999:7:::";
        let entry = parse_shadow_line(line).unwrap();
        assert_eq!(entry.hash_algorithm, PasswordHashAlgorithm::Locked);
    }

    #[test]
    fn test_yescrypt() {
        let line = "user:$y$j9T$salt$hash:19500:0:99999:7:::";
        let entry = parse_shadow_line(line).unwrap();
        assert_eq!(entry.hash_algorithm, PasswordHashAlgorithm::Yescrypt);
    }

    #[test]
    fn test_detect_algorithms() {
        assert_eq!(
            detect_hash_algorithm("$1$salt$hash"),
            PasswordHashAlgorithm::Md5
        );
        assert_eq!(
            detect_hash_algorithm("$5$salt$hash"),
            PasswordHashAlgorithm::Sha256
        );
        assert_eq!(
            detect_hash_algorithm("$6$salt$hash"),
            PasswordHashAlgorithm::Sha512
        );
        assert_eq!(
            detect_hash_algorithm("$2b$12$hash"),
            PasswordHashAlgorithm::Blowfish
        );
        assert_eq!(
            detect_hash_algorithm("*"),
            PasswordHashAlgorithm::NoPassword
        );
    }
}
