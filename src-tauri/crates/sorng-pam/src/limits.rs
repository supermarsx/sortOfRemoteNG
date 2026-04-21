//! /etc/security/limits.conf and /etc/security/limits.d/ management.

use crate::client;
use crate::error::PamError;
use crate::types::{LimitType, PamHost, PamLimit, PamLimitItem};
use log::{debug, info};
use std::collections::HashMap;

// ─── Parsing ────────────────────────────────────────────────────────

/// Parse a single limits.conf line.
fn parse_limit_line(line: &str) -> Option<PamLimit> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }

    let tokens: Vec<&str> = trimmed.split_whitespace().collect();
    if tokens.len() < 4 {
        return None;
    }

    let domain = tokens[0].to_string();
    let limit_type = LimitType::parse(tokens[1])?;
    let item = PamLimitItem::parse(tokens[2])?;
    let value = tokens[3].to_string();

    Some(PamLimit {
        domain,
        limit_type,
        item,
        value,
    })
}

/// Parse limits.conf content into a list of PamLimit entries.
pub fn parse_limits(content: &str) -> Vec<PamLimit> {
    content.lines().filter_map(parse_limit_line).collect()
}

/// Serialize a list of limits back to file content, preserving comments header.
pub fn serialize_limits(limits: &[PamLimit]) -> String {
    let mut out = String::new();
    out.push_str("# /etc/security/limits.conf\n");
    out.push_str("#\n");
    out.push_str("# <domain>  <type>  <item>  <value>\n");
    out.push_str("#\n");
    for limit in limits {
        out.push_str(&limit.to_config_line());
        out.push('\n');
    }
    out
}

// ─── Remote Operations ──────────────────────────────────────────────

const LIMITS_CONF: &str = "/etc/security/limits.conf";
const LIMITS_D: &str = "/etc/security/limits.d";

/// Get all limits from /etc/security/limits.conf.
pub async fn get_limits(host: &PamHost) -> Result<Vec<PamLimit>, PamError> {
    let content = client::read_file(host, LIMITS_CONF).await?;
    Ok(parse_limits(&content))
}

/// Set (add or update) a limit in /etc/security/limits.conf.
///
/// If a matching domain+item entry exists, it is updated; otherwise appended.
pub async fn set_limit(host: &PamHost, limit: &PamLimit) -> Result<(), PamError> {
    let content = client::read_file(host, LIMITS_CONF).await?;
    let mut limits = parse_limits(&content);

    // Find existing entry with same domain + item
    let existing = limits.iter_mut().find(|l| {
        l.domain == limit.domain && l.item == limit.item && l.limit_type == limit.limit_type
    });

    if let Some(existing) = existing {
        existing.value = limit.value.clone();
        debug!(
            "Updated limit: {} {} {} = {}",
            limit.domain,
            limit.limit_type.as_str(),
            limit.item.as_str(),
            limit.value
        );
    } else {
        limits.push(limit.clone());
        debug!(
            "Added limit: {} {} {} = {}",
            limit.domain,
            limit.limit_type.as_str(),
            limit.item.as_str(),
            limit.value
        );
    }

    let new_content = serialize_limits(&limits);
    client::write_file(host, LIMITS_CONF, &new_content).await?;
    info!("Updated {}", LIMITS_CONF);
    Ok(())
}

/// Remove a limit from /etc/security/limits.conf by domain and item.
pub async fn remove_limit(
    host: &PamHost,
    domain: &str,
    item: PamLimitItem,
) -> Result<(), PamError> {
    let content = client::read_file(host, LIMITS_CONF).await?;
    let limits: Vec<PamLimit> = parse_limits(&content)
        .into_iter()
        .filter(|l| !(l.domain == domain && l.item == item))
        .collect();

    let new_content = serialize_limits(&limits);
    client::write_file(host, LIMITS_CONF, &new_content).await?;
    info!("Removed limit for domain={} item={}", domain, item.as_str());
    Ok(())
}

/// Get limits from all files in /etc/security/limits.d/.
pub async fn get_limits_d(host: &PamHost) -> Result<HashMap<String, Vec<PamLimit>>, PamError> {
    let mut result = HashMap::new();

    if !client::dir_exists(host, LIMITS_D).await.unwrap_or(false) {
        return Ok(result);
    }

    let files = client::list_dir(host, LIMITS_D).await?;
    for file_name in &files {
        if !file_name.ends_with(".conf") {
            continue;
        }
        let path = format!("{}/{}", LIMITS_D, file_name);
        match client::read_file(host, &path).await {
            Ok(content) => {
                let limits = parse_limits(&content);
                result.insert(file_name.clone(), limits);
            }
            Err(e) => {
                log::warn!("Failed to read {}: {}", path, e);
            }
        }
    }

    Ok(result)
}

/// Write a complete limits.d file.
pub async fn set_limit_file(
    host: &PamHost,
    filename: &str,
    limits: &[PamLimit],
) -> Result<(), PamError> {
    let path = format!("{}/{}", LIMITS_D, filename);
    let content = serialize_limits(limits);
    client::write_file(host, &path, &content).await?;
    info!("Wrote limits file: {}", path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_limit_line() {
        let line = "*\tsoft\tnofile\t1024";
        let limit = parse_limit_line(line).unwrap();
        assert_eq!(limit.domain, "*");
        assert_eq!(limit.limit_type, LimitType::Soft);
        assert_eq!(limit.item, PamLimitItem::Nofile);
        assert_eq!(limit.value, "1024");
    }

    #[test]
    fn test_parse_limit_both() {
        let line = "@developers\t-\tnproc\t4096";
        let limit = parse_limit_line(line).unwrap();
        assert_eq!(limit.domain, "@developers");
        assert_eq!(limit.limit_type, LimitType::Both);
        assert_eq!(limit.item, PamLimitItem::Nproc);
        assert_eq!(limit.value, "4096");
    }

    #[test]
    fn test_parse_limit_hard() {
        let line = "root  hard  core  unlimited";
        let limit = parse_limit_line(line).unwrap();
        assert_eq!(limit.domain, "root");
        assert_eq!(limit.limit_type, LimitType::Hard);
        assert_eq!(limit.item, PamLimitItem::Core);
        assert_eq!(limit.value, "unlimited");
    }

    #[test]
    fn test_parse_limit_comment_ignored() {
        assert!(parse_limit_line("# this is a comment").is_none());
        assert!(parse_limit_line("").is_none());
    }

    #[test]
    fn test_parse_limits_conf() {
        let content = "\
# /etc/security/limits.conf
#
# Each line describes a limit for a user in the form:
#
# <domain>  <type>  <item>  <value>

*               soft    core            0
*               hard    rss             10000
@student        hard    nproc           20
@faculty        soft    nproc           20
@faculty        hard    nproc           50
";
        let limits = parse_limits(content);
        assert_eq!(limits.len(), 5);
        assert_eq!(limits[0].domain, "*");
        assert_eq!(limits[0].item, PamLimitItem::Core);
        assert_eq!(limits[1].item, PamLimitItem::Rss);
        assert_eq!(limits[2].domain, "@student");
    }

    #[test]
    fn test_serialize_roundtrip() {
        let limits = vec![
            PamLimit {
                domain: "*".to_string(),
                limit_type: LimitType::Soft,
                item: PamLimitItem::Nofile,
                value: "1024".to_string(),
            },
            PamLimit {
                domain: "@admin".to_string(),
                limit_type: LimitType::Hard,
                item: PamLimitItem::Nproc,
                value: "unlimited".to_string(),
            },
        ];
        let serialized = serialize_limits(&limits);
        let reparsed = parse_limits(&serialized);
        assert_eq!(reparsed.len(), 2);
        assert_eq!(reparsed[0].domain, "*");
        assert_eq!(reparsed[1].domain, "@admin");
    }
}
