// ── amavis whitelist / blacklist management ──────────────────────────────────

use crate::client::AmavisClient;
use crate::error::{AmavisError, AmavisResult};
use crate::types::*;

const LISTS_CONF: &str = "/etc/amavis/conf.d/50-user";

pub struct ListManager;

impl ListManager {
    /// List all entries of a given list type.
    pub async fn list_entries(
        client: &AmavisClient,
        list_type: &AmavisListType,
    ) -> AmavisResult<Vec<AmavisListEntry>> {
        let content = client.read_file(LISTS_CONF).await.unwrap_or_default();
        let var_name = list_type_to_var(list_type);
        let entries = parse_list_entries(&content, &var_name, list_type);
        Ok(entries)
    }

    /// Get a single list entry by ID.
    pub async fn get_entry(client: &AmavisClient, id: &str) -> AmavisResult<AmavisListEntry> {
        let content = client.read_file(LISTS_CONF).await.unwrap_or_default();
        // Search all list types
        for lt in &[
            AmavisListType::SenderWhitelist,
            AmavisListType::SenderBlacklist,
            AmavisListType::RecipientWhitelist,
        ] {
            let var_name = list_type_to_var(lt);
            let entries = parse_list_entries(&content, &var_name, lt);
            if let Some(entry) = entries.into_iter().find(|e| e.id == id) {
                return Ok(entry);
            }
        }
        Err(AmavisError::whitelist_not_found(id))
    }

    /// Add a new entry to a list.
    pub async fn add_entry(
        client: &AmavisClient,
        req: &CreateListEntryRequest,
    ) -> AmavisResult<AmavisListEntry> {
        let id = uuid::Uuid::new_v4().to_string();
        let entry = AmavisListEntry {
            id: id.clone(),
            list_type: req.list_type.clone(),
            address: req.address.clone(),
            description: req.description.clone(),
            enabled: true,
        };
        let var_name = list_type_to_var(&req.list_type);
        let mut content = client.read_file(LISTS_CONF).await.unwrap_or_default();
        let line = render_list_entry(&entry);

        // Find or create the list hash
        let hash_marker = format!("%{}", var_name);
        if content.contains(&hash_marker) {
            // Insert before the closing ");
            if let Some(pos) = content.rfind(");") {
                let before_idx = content[..pos].rfind(&hash_marker).unwrap_or(0);
                // Find the closing of this particular hash
                let search_area = &content[before_idx..];
                if let Some(close_pos) = find_hash_close(search_area) {
                    let abs_close = before_idx + close_pos;
                    let before = &content[..abs_close];
                    let after = &content[abs_close..];
                    content = format!("{}\n  {}\n{}", before.trim_end(), line, after);
                } else {
                    content.push_str(&format!("\n  {}\n", line));
                }
            }
        } else {
            // Create the entire hash block
            content.push_str(&format!("\n{} = new_RE(\n  {}\n);\n", hash_marker, line));
        }

        client.write_file(LISTS_CONF, &content).await?;
        Ok(entry)
    }

    /// Update a list entry.
    pub async fn update_entry(
        client: &AmavisClient,
        id: &str,
        req: &UpdateListEntryRequest,
    ) -> AmavisResult<AmavisListEntry> {
        let mut entry = Self::get_entry(client, id).await?;
        if let Some(ref lt) = req.list_type {
            entry.list_type = lt.clone();
        }
        if let Some(ref addr) = req.address {
            entry.address = addr.clone();
        }
        if let Some(ref desc) = req.description {
            entry.description = Some(desc.clone());
        }
        if let Some(e) = req.enabled {
            entry.enabled = e;
        }

        // Remove old entry and re-add
        let content = client.read_file(LISTS_CONF).await.unwrap_or_default();
        let cleaned = remove_entry_by_id(&content, id);
        let line = render_list_entry(&entry);
        let var_name = list_type_to_var(&entry.list_type);
        let hash_marker = format!("%{}", var_name);

        let new_content = if cleaned.contains(&hash_marker) {
            if let Some(pos) = cleaned.rfind(");") {
                let before = &cleaned[..pos];
                let after = &cleaned[pos..];
                format!("{}\n  {}\n{}", before.trim_end(), line, after)
            } else {
                format!("{}\n  {}\n", cleaned, line)
            }
        } else {
            format!("{}\n{} = new_RE(\n  {}\n);\n", cleaned, hash_marker, line)
        };

        client.write_file(LISTS_CONF, &new_content).await?;
        Ok(entry)
    }

    /// Remove a list entry by ID.
    pub async fn remove_entry(client: &AmavisClient, id: &str) -> AmavisResult<()> {
        let content = client.read_file(LISTS_CONF).await?;
        let cleaned = remove_entry_by_id(&content, id);
        if cleaned.len() == content.len() {
            return Err(AmavisError::whitelist_not_found(id));
        }
        client.write_file(LISTS_CONF, &cleaned).await
    }

    /// Check whether a sender address is whitelisted or blacklisted.
    pub async fn check_sender(
        client: &AmavisClient,
        sender_address: &str,
    ) -> AmavisResult<AmavisListCheckResult> {
        let content = client.read_file(LISTS_CONF).await.unwrap_or_default();
        let addr_lower = sender_address.to_lowercase();

        let whitelist_entries = parse_list_entries(
            &content,
            &list_type_to_var(&AmavisListType::SenderWhitelist),
            &AmavisListType::SenderWhitelist,
        );
        let blacklist_entries = parse_list_entries(
            &content,
            &list_type_to_var(&AmavisListType::SenderBlacklist),
            &AmavisListType::SenderBlacklist,
        );

        let whitelisted = whitelist_entries
            .iter()
            .any(|e| e.enabled && addr_lower.contains(&e.address.to_lowercase()));
        let blacklisted = blacklist_entries
            .iter()
            .any(|e| e.enabled && addr_lower.contains(&e.address.to_lowercase()));

        let score_modifier = if whitelisted {
            -100.0
        } else if blacklisted {
            100.0
        } else {
            0.0
        };

        Ok(AmavisListCheckResult {
            whitelisted,
            blacklisted,
            score_modifier,
        })
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn list_type_to_var(lt: &AmavisListType) -> String {
    match lt {
        AmavisListType::SenderWhitelist => "whitelist_sender".to_string(),
        AmavisListType::SenderBlacklist => "blacklist_sender".to_string(),
        AmavisListType::RecipientWhitelist => "whitelist_recipient".to_string(),
    }
}

fn parse_list_entries(
    content: &str,
    var_name: &str,
    list_type: &AmavisListType,
) -> Vec<AmavisListEntry> {
    let mut entries = Vec::new();
    let hash_marker = format!("%{}", var_name);
    let mut in_block = false;
    let mut entry_index = 0u32;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.contains(&hash_marker) && (trimmed.contains('(') || trimmed.contains('=')) {
            in_block = true;
            continue;
        }
        if in_block {
            if trimmed == ");" || trimmed.starts_with(");") {
                in_block = false;
                continue;
            }
            if trimmed.is_empty() || trimmed == "#" {
                continue;
            }
            let is_commented = trimmed.starts_with('#');
            let effective = if is_commented {
                trimmed.trim_start_matches('#').trim()
            } else {
                trimmed
            };

            // Parse entries like: qr'^sender@example\.com$'i => 'OK',
            // or simple: 'sender@example.com' => 1,
            let address = extract_address(effective);
            if let Some(addr) = address {
                // Extract ID from comment if present
                let id = if let Some(id_pos) = effective.rfind("id:") {
                    effective[id_pos + 3..]
                        .trim()
                        .trim_end_matches(',')
                        .to_string()
                } else {
                    entry_index += 1;
                    format!("{}-{}", var_name, entry_index)
                };
                let description = extract_list_comment(effective);
                entries.push(AmavisListEntry {
                    id,
                    list_type: list_type.clone(),
                    address: addr,
                    description,
                    enabled: !is_commented,
                });
            }
        }
    }
    entries
}

fn extract_address(s: &str) -> Option<String> {
    // Try to extract from qr'...'
    if let Some(start) = s.find("qr'") {
        let after = &s[start + 3..];
        if let Some(end) = after.find('\'') {
            let raw = &after[..end];
            // Strip regex anchors and escapes
            let addr = raw
                .trim_start_matches('^')
                .trim_end_matches('$')
                .replace("\\.", ".")
                .replace("\\@", "@");
            return Some(addr);
        }
    }
    // Try to extract from 'addr' => ...
    if let Some(start) = s.find('\'') {
        let after = &s[start + 1..];
        if let Some(end) = after.find('\'') {
            let addr = after[..end].to_string();
            if addr.contains('@') || addr.contains('.') {
                return Some(addr);
            }
        }
    }
    None
}

fn extract_list_comment(s: &str) -> Option<String> {
    if let Some(hash_pos) = s.rfind('#') {
        let comment = s[hash_pos + 1..].trim();
        // Don't return the id: marker as description
        if comment.starts_with("id:") {
            return None;
        }
        if !comment.is_empty() {
            return Some(comment.to_string());
        }
    }
    None
}

fn render_list_entry(entry: &AmavisListEntry) -> String {
    let prefix = if entry.enabled { "" } else { "# " };
    let comment = entry
        .description
        .as_ref()
        .map(|d| format!("  # {}", d))
        .unwrap_or_default();
    let escaped_addr = entry.address.replace('.', "\\.").replace('@', "\\@");
    format!(
        "{}qr'^{}$'i => 1,{} # id:{}",
        prefix, escaped_addr, comment, entry.id
    )
}

fn remove_entry_by_id(content: &str, id: &str) -> String {
    let marker = format!("id:{}", id);
    content
        .lines()
        .filter(|line| !line.contains(&marker))
        .collect::<Vec<_>>()
        .join("\n")
}

fn find_hash_close(s: &str) -> Option<usize> {
    let mut depth = 0i32;
    for (i, ch) in s.char_indices() {
        if ch == '(' {
            depth += 1;
        } else if ch == ')' {
            depth -= 1;
            if depth <= 0 {
                return Some(i);
            }
        }
    }
    None
}
