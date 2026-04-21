// ── OpenDKIM signing table management ────────────────────────────────────────
//! Manages the SigningTable file, which maps sender patterns to key names.
//! Format per line:  pattern  key_name  [# comment]

use crate::client::OpendkimClient;
use crate::error::{OpendkimError, OpendkimResult};
use crate::types::SigningTableEntry;

pub struct SigningTableManager;

impl SigningTableManager {
    /// Resolve the SigningTable file path from opendkim.conf.
    async fn table_path(client: &OpendkimClient) -> OpendkimResult<String> {
        let conf = client.read_remote_file(client.config_path()).await?;
        for line in conf.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("SigningTable") {
                // SigningTable  refile:/etc/opendkim/signing.table
                // or SigningTable  /etc/opendkim/signing.table
                let value = trimmed
                    .split_once(char::is_whitespace)
                    .map(|x| x.1)
                    .unwrap_or("")
                    .trim();
                let path = value
                    .strip_prefix("refile:")
                    .or_else(|| value.strip_prefix("file:"))
                    .unwrap_or(value);
                return Ok(path.to_string());
            }
        }
        Ok("/etc/opendkim/signing.table".to_string())
    }

    /// Parse all entries from the signing table file.
    pub async fn list(client: &OpendkimClient) -> OpendkimResult<Vec<SigningTableEntry>> {
        let path = Self::table_path(client).await?;
        let content = client.read_remote_file(&path).await?;
        Ok(parse_signing_table(&content))
    }

    /// Get a single signing table entry by pattern.
    pub async fn get(client: &OpendkimClient, pattern: &str) -> OpendkimResult<SigningTableEntry> {
        let all = Self::list(client).await?;
        all.into_iter()
            .find(|e| e.pattern == pattern)
            .ok_or_else(|| OpendkimError::signing_table(format!("pattern not found: {}", pattern)))
    }

    /// Add a new entry to the signing table.
    pub async fn add(client: &OpendkimClient, entry: &SigningTableEntry) -> OpendkimResult<()> {
        let path = Self::table_path(client).await?;
        let content = client.read_remote_file(&path).await.unwrap_or_default();
        // Check for duplicate
        let existing = parse_signing_table(&content);
        if existing.iter().any(|e| e.pattern == entry.pattern) {
            return Err(OpendkimError::signing_table(format!(
                "pattern already exists: {}",
                entry.pattern
            )));
        }
        let mut new_content = content;
        if !new_content.ends_with('\n') && !new_content.is_empty() {
            new_content.push('\n');
        }
        new_content.push_str(&format_signing_entry(entry));
        new_content.push('\n');
        client.write_remote_file(&path, &new_content).await
    }

    /// Update an existing entry (matched by pattern).
    pub async fn update(
        client: &OpendkimClient,
        pattern: &str,
        entry: &SigningTableEntry,
    ) -> OpendkimResult<()> {
        let path = Self::table_path(client).await?;
        let content = client.read_remote_file(&path).await?;
        let mut entries = parse_signing_table(&content);
        let idx = entries
            .iter()
            .position(|e| e.pattern == pattern)
            .ok_or_else(|| {
                OpendkimError::signing_table(format!("pattern not found: {}", pattern))
            })?;
        entries[idx] = entry.clone();
        let new_content = serialize_signing_table(&entries);
        client.write_remote_file(&path, &new_content).await
    }

    /// Remove an entry from the signing table by pattern.
    pub async fn remove(client: &OpendkimClient, pattern: &str) -> OpendkimResult<()> {
        let path = Self::table_path(client).await?;
        let content = client.read_remote_file(&path).await?;
        let entries = parse_signing_table(&content);
        if !entries.iter().any(|e| e.pattern == pattern) {
            return Err(OpendkimError::signing_table(format!(
                "pattern not found: {}",
                pattern
            )));
        }
        let filtered: Vec<_> = entries
            .into_iter()
            .filter(|e| e.pattern != pattern)
            .collect();
        let new_content = serialize_signing_table(&filtered);
        client.write_remote_file(&path, &new_content).await
    }

    /// Rebuild the signing table from key table entries (clear and regenerate).
    pub async fn rebuild(client: &OpendkimClient) -> OpendkimResult<()> {
        let path = Self::table_path(client).await?;
        // Read key table to auto-generate signing table
        let kt_conf = client.read_remote_file(client.config_path()).await?;
        let kt_path = kt_conf
            .lines()
            .find(|l| l.trim().starts_with("KeyTable"))
            .and_then(|l| l.split_once(char::is_whitespace).map(|x| x.1))
            .map(|v| {
                v.trim()
                    .strip_prefix("refile:")
                    .or_else(|| v.trim().strip_prefix("file:"))
                    .unwrap_or(v.trim())
                    .to_string()
            })
            .unwrap_or_else(|| "/etc/opendkim/key.table".to_string());
        let kt_content = client.read_remote_file(&kt_path).await.unwrap_or_default();
        let mut entries = Vec::new();
        for line in kt_content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let parts: Vec<&str> = line.splitn(2, char::is_whitespace).collect();
            if parts.len() >= 2 {
                let key_name = parts[0];
                // Extract domain from key_name: selector._domainkey.domain
                let domain = key_name.split("._domainkey.").nth(1).unwrap_or(key_name);
                entries.push(SigningTableEntry {
                    pattern: format!("*@{}", domain),
                    key_name: key_name.to_string(),
                    comment: None,
                });
            }
        }
        let new_content = serialize_signing_table(&entries);
        client.write_remote_file(&path, &new_content).await
    }
}

// ─── Parsing helpers ─────────────────────────────────────────────────────────

fn parse_signing_table(content: &str) -> Vec<SigningTableEntry> {
    let mut entries = Vec::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        // Split comment
        let (data, comment) = if let Some(pos) = line.find('#') {
            (&line[..pos], Some(line[pos + 1..].trim().to_string()))
        } else {
            (line, None)
        };
        let parts: Vec<&str> = data.split_whitespace().collect();
        if parts.len() >= 2 {
            entries.push(SigningTableEntry {
                pattern: parts[0].to_string(),
                key_name: parts[1].to_string(),
                comment,
            });
        }
    }
    entries
}

fn format_signing_entry(entry: &SigningTableEntry) -> String {
    let mut line = format!("{}\t{}", entry.pattern, entry.key_name);
    if let Some(ref c) = entry.comment {
        line.push_str(&format!("\t# {}", c));
    }
    line
}

fn serialize_signing_table(entries: &[SigningTableEntry]) -> String {
    let mut out = String::new();
    for entry in entries {
        out.push_str(&format_signing_entry(entry));
        out.push('\n');
    }
    out
}
