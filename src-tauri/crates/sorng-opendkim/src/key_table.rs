// ── OpenDKIM key table management ────────────────────────────────────────────
//! Manages the KeyTable file, which maps key names to domain:selector:keypath.
//! Format per line:  key_name  domain:selector:/path/to/key.private  [# comment]

use crate::client::OpendkimClient;
use crate::error::{OpendkimError, OpendkimResult};
use crate::types::KeyTableEntry;

pub struct KeyTableManager;

impl KeyTableManager {
    /// Resolve the KeyTable file path from opendkim.conf.
    async fn table_path(client: &OpendkimClient) -> OpendkimResult<String> {
        let conf = client.read_remote_file(client.config_path()).await?;
        for line in conf.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("KeyTable") {
                let value = trimmed
                    .splitn(2, char::is_whitespace)
                    .nth(1)
                    .unwrap_or("")
                    .trim();
                let path = value
                    .strip_prefix("refile:")
                    .or_else(|| value.strip_prefix("file:"))
                    .unwrap_or(value);
                return Ok(path.to_string());
            }
        }
        Ok("/etc/opendkim/key.table".to_string())
    }

    /// Parse all entries from the key table file.
    pub async fn list(client: &OpendkimClient) -> OpendkimResult<Vec<KeyTableEntry>> {
        let path = Self::table_path(client).await?;
        let content = client.read_remote_file(&path).await?;
        Ok(parse_key_table(&content))
    }

    /// Get a single key table entry by key_name.
    pub async fn get(
        client: &OpendkimClient,
        key_name: &str,
    ) -> OpendkimResult<KeyTableEntry> {
        let all = Self::list(client).await?;
        all.into_iter()
            .find(|e| e.key_name == key_name)
            .ok_or_else(|| {
                OpendkimError::key_table(format!("key_name not found: {}", key_name))
            })
    }

    /// Add a new entry to the key table.
    pub async fn add(
        client: &OpendkimClient,
        entry: &KeyTableEntry,
    ) -> OpendkimResult<()> {
        let path = Self::table_path(client).await?;
        let content = client.read_remote_file(&path).await.unwrap_or_default();
        let existing = parse_key_table(&content);
        if existing.iter().any(|e| e.key_name == entry.key_name) {
            return Err(OpendkimError::key_table(format!(
                "key_name already exists: {}",
                entry.key_name
            )));
        }
        let mut new_content = content;
        if !new_content.ends_with('\n') && !new_content.is_empty() {
            new_content.push('\n');
        }
        new_content.push_str(&format_key_entry(entry));
        new_content.push('\n');
        client.write_remote_file(&path, &new_content).await
    }

    /// Update an existing entry (matched by key_name).
    pub async fn update(
        client: &OpendkimClient,
        key_name: &str,
        entry: &KeyTableEntry,
    ) -> OpendkimResult<()> {
        let path = Self::table_path(client).await?;
        let content = client.read_remote_file(&path).await?;
        let mut entries = parse_key_table(&content);
        let idx = entries
            .iter()
            .position(|e| e.key_name == key_name)
            .ok_or_else(|| {
                OpendkimError::key_table(format!("key_name not found: {}", key_name))
            })?;
        entries[idx] = entry.clone();
        let new_content = serialize_key_table(&entries);
        client.write_remote_file(&path, &new_content).await
    }

    /// Remove an entry from the key table by key_name.
    pub async fn remove(client: &OpendkimClient, key_name: &str) -> OpendkimResult<()> {
        let path = Self::table_path(client).await?;
        let content = client.read_remote_file(&path).await?;
        let entries = parse_key_table(&content);
        if !entries.iter().any(|e| e.key_name == key_name) {
            return Err(OpendkimError::key_table(format!(
                "key_name not found: {}",
                key_name
            )));
        }
        let filtered: Vec<_> = entries
            .into_iter()
            .filter(|e| e.key_name != key_name)
            .collect();
        let new_content = serialize_key_table(&filtered);
        client.write_remote_file(&path, &new_content).await
    }

    /// Rebuild the key table from keys found on disk.
    pub async fn rebuild(client: &OpendkimClient) -> OpendkimResult<()> {
        let path = Self::table_path(client).await?;
        let key_dir = client.key_dir();
        let domains = client.list_remote_dir(key_dir).await?;
        let mut entries = Vec::new();
        for domain in &domains {
            let domain_dir = format!("{}/{}", key_dir, domain);
            let files = client.list_remote_dir(&domain_dir).await.unwrap_or_default();
            for file in &files {
                if !file.ends_with(".private") {
                    continue;
                }
                let selector = file.trim_end_matches(".private");
                let key_name = format!("{}._domainkey.{}", selector, domain);
                let private_key_path = format!("{}/{}", domain_dir, file);
                entries.push(KeyTableEntry {
                    key_name,
                    domain: domain.clone(),
                    selector: selector.to_string(),
                    private_key_path,
                });
            }
        }
        let new_content = serialize_key_table(&entries);
        client.write_remote_file(&path, &new_content).await
    }
}

// ─── Parsing helpers ─────────────────────────────────────────────────────────

fn parse_key_table(content: &str) -> Vec<KeyTableEntry> {
    let mut entries = Vec::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        // Strip trailing comment
        let data = if let Some(pos) = line.find('#') {
            &line[..pos]
        } else {
            line
        };
        let parts: Vec<&str> = data.split_whitespace().collect();
        if parts.len() >= 2 {
            let key_name = parts[0].to_string();
            // Value format: domain:selector:/path/to/key.private
            let value_parts: Vec<&str> = parts[1].splitn(3, ':').collect();
            if value_parts.len() >= 3 {
                entries.push(KeyTableEntry {
                    key_name,
                    domain: value_parts[0].to_string(),
                    selector: value_parts[1].to_string(),
                    private_key_path: value_parts[2].to_string(),
                });
            }
        }
    }
    entries
}

fn format_key_entry(entry: &KeyTableEntry) -> String {
    format!(
        "{}\t{}:{}:{}",
        entry.key_name, entry.domain, entry.selector, entry.private_key_path
    )
}

fn serialize_key_table(entries: &[KeyTableEntry]) -> String {
    let mut out = String::new();
    for entry in entries {
        out.push_str(&format_key_entry(entry));
        out.push('\n');
    }
    out
}
