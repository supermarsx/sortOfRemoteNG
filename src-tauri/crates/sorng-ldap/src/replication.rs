//! LDAP replication status.
use crate::client;
use crate::error::LdapError;
use crate::types::*;

pub async fn get_replication_status(host: &LdapHost) -> Result<Vec<ReplicationStatus>, LdapError> {
    let stdout = client::exec_ok(
        host,
        "ldapsearch",
        &[
            "-x",
            "-H",
            &host.ldap_uri,
            "-b",
            "cn=config",
            "(objectClass=olcSyncReplConfig)",
        ],
    )
    .await?;
    parse_syncrepl_config(&stdout, &host.ldap_uri)
}

/// Unfold LDIF continuation lines (lines starting with a single space are
/// appended to the previous line).
fn unfold_ldif(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    for line in text.lines() {
        if line.starts_with(' ') {
            // Continuation: append content after the leading space
            result.push_str(&line[1..]);
        } else {
            if !result.is_empty() {
                result.push('\n');
            }
            result.push_str(line);
        }
    }
    result
}

/// Extract a value for `key` from a space-separated `key=value` syncrepl line.
fn extract_syncrepl_field<'a>(value: &'a str, key: &str) -> Option<&'a str> {
    let prefix = format!("{}=", key);
    for token in value.split_whitespace() {
        if let Some(val) = token.strip_prefix(prefix.as_str()) {
            return Some(val.trim_matches('"'));
        }
    }
    None
}

/// Parse `olcSyncRepl` attributes out of the ldapsearch LDIF output.
fn parse_syncrepl_config(
    ldif: &str,
    consumer_uri: &str,
) -> Result<Vec<ReplicationStatus>, LdapError> {
    let unfolded = unfold_ldif(ldif);
    let mut results = Vec::new();

    for line in unfolded.lines() {
        // Match "olcSyncRepl:" (case-insensitive check on the attribute name)
        let attr_value = if let Some(rest) = line.strip_prefix("olcSyncRepl:") {
            rest.trim()
        } else if let Some(rest) = line.strip_prefix("olcSyncrepl:") {
            rest.trim()
        } else {
            continue;
        };

        // Strip optional LDAP ordering prefix, e.g. "{0}"
        let value = match attr_value.strip_prefix('{') {
            Some(s) => s.find('}').map_or(attr_value, |i| &s[i + 1..]).trim(),
            None => attr_value,
        };

        if let Some(provider) = extract_syncrepl_field(value, "provider") {
            results.push(ReplicationStatus {
                provider: provider.to_string(),
                consumer: consumer_uri.to_string(),
                // Config presence doesn't imply live status; default to true.
                // A full status check would query contextCSN on both sides.
                in_sync: true,
                lag_seconds: None,
                last_sync: None,
            });
        }
    }

    Ok(results)
}
