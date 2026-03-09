// ── postfix config management ────────────────────────────────────────────────

use crate::client::{shell_escape, PostfixClient};
use crate::error::{PostfixError, PostfixResult};
use crate::types::*;

pub struct PostfixConfigManager;

impl PostfixConfigManager {
    /// Retrieve all main.cf parameters via `postconf`.
    pub async fn get_main_cf(client: &PostfixClient) -> PostfixResult<Vec<PostfixMainCfParam>> {
        client.postconf_all().await
    }

    /// Retrieve a single main.cf parameter.
    pub async fn get_param(
        client: &PostfixClient,
        name: &str,
    ) -> PostfixResult<PostfixMainCfParam> {
        let value = client.postconf(name).await?;
        let default_out = client
            .exec_ssh(&format!("postconf -d {}", shell_escape(name)))
            .await
            .ok();
        let default_value =
            default_out.and_then(|o| o.stdout.split_once('=').map(|(_, v)| v.trim().to_string()));
        let is_default = default_value.as_deref() == Some(value.as_str());
        Ok(PostfixMainCfParam {
            name: name.to_string(),
            value,
            default_value,
            is_default,
        })
    }

    /// Set a main.cf parameter.
    pub async fn set_param(client: &PostfixClient, name: &str, value: &str) -> PostfixResult<()> {
        client.postconf_set(name, value).await
    }

    /// Delete (reset to default) a main.cf parameter.
    pub async fn delete_param(client: &PostfixClient, name: &str) -> PostfixResult<()> {
        let out = client
            .exec_ssh(&format!("sudo postconf -X {}", shell_escape(name)))
            .await?;
        if out.exit_code != 0 {
            return Err(PostfixError::config_syntax(&format!(
                "postconf -X {} failed: {}",
                name, out.stderr
            )));
        }
        Ok(())
    }

    /// Parse and return master.cf entries.
    pub async fn get_master_cf(client: &PostfixClient) -> PostfixResult<Vec<PostfixMasterCfEntry>> {
        let master_cf_path = format!("{}/master.cf", client.config_dir());
        let raw = client.read_remote_file(&master_cf_path).await?;
        let mut entries = Vec::new();
        for line in raw.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            // Continuation lines start with whitespace
            if line.starts_with(' ') || line.starts_with('\t') {
                if let Some(last) = entries.last_mut() {
                    let entry: &mut PostfixMasterCfEntry = last;
                    entry.command.push(' ');
                    entry.command.push_str(trimmed);
                }
                continue;
            }
            let fields: Vec<&str> = trimmed.split_whitespace().collect();
            if fields.len() >= 8 {
                entries.push(PostfixMasterCfEntry {
                    service_name: fields[0].to_string(),
                    service_type: fields[1].to_string(),
                    private_flag: normalize_field(fields[2]),
                    unpriv: normalize_field(fields[3]),
                    chroot: normalize_field(fields[4]),
                    wakeup: normalize_field(fields[5]),
                    maxproc: normalize_field(fields[6]),
                    command: fields[7..].join(" "),
                });
            }
        }
        Ok(entries)
    }

    /// Update or add a master.cf service entry.
    pub async fn update_master_cf(
        client: &PostfixClient,
        entry: &PostfixMasterCfEntry,
    ) -> PostfixResult<()> {
        let master_cf_path = format!("{}/master.cf", client.config_dir());
        let raw = client.read_remote_file(&master_cf_path).await?;
        let mut new_lines = Vec::new();
        let mut replaced = false;
        let entry_line = format!(
            "{} {} {} {} {} {} {} {}",
            entry.service_name,
            entry.service_type,
            entry.private_flag.as_deref().unwrap_or("-"),
            entry.unpriv.as_deref().unwrap_or("-"),
            entry.chroot.as_deref().unwrap_or("n"),
            entry.wakeup.as_deref().unwrap_or("-"),
            entry.maxproc.as_deref().unwrap_or("-"),
            entry.command
        );
        let mut skip_continuations = false;
        for line in raw.lines() {
            if skip_continuations {
                if line.starts_with(' ') || line.starts_with('\t') {
                    continue;
                }
                skip_continuations = false;
            }
            let fields: Vec<&str> = line.split_whitespace().collect();
            if fields.len() >= 2
                && fields[0] == entry.service_name
                && fields[1] == entry.service_type
            {
                new_lines.push(entry_line.clone());
                replaced = true;
                skip_continuations = true;
                continue;
            }
            new_lines.push(line.to_string());
        }
        if !replaced {
            new_lines.push(entry_line);
        }
        let content = new_lines.join("\n") + "\n";
        client.write_remote_file(&master_cf_path, &content).await
    }

    /// Run `postfix check` to validate configuration.
    pub async fn check_config(client: &PostfixClient) -> PostfixResult<ConfigTestResult> {
        client.check_config().await
    }

    /// List all lookup tables referenced in main.cf.
    pub async fn get_maps(client: &PostfixClient) -> PostfixResult<Vec<PostfixMap>> {
        let out = client.exec_ssh("postconf -m 2>/dev/null; postconf | grep -E '(hash|btree|regexp|pcre|lmdb):' 2>/dev/null").await?;
        let mut maps = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for line in out.stdout.lines() {
            let trimmed = line.trim();
            // Extract map references like hash:/etc/postfix/virtual
            for token in trimmed.split_whitespace() {
                let token = token.trim_matches(',');
                if let Some(idx) = token.find(":/") {
                    let type_str = &token[..idx];
                    let path = &token[idx + 1..];
                    let map_type = match type_str {
                        "hash" => MapType::Hash,
                        "btree" => MapType::Btree,
                        "regexp" => MapType::Regexp,
                        "pcre" => MapType::Pcre,
                        "lmdb" => MapType::Lmdb,
                        _ => continue,
                    };
                    let map_name = path.rsplit('/').next().unwrap_or(path).to_string();
                    if seen.insert(path.to_string()) {
                        let count = client
                            .exec_ssh(&format!(
                                "wc -l < {} 2>/dev/null || echo 0",
                                shell_escape(path)
                            ))
                            .await
                            .ok()
                            .and_then(|o| o.stdout.trim().parse::<u64>().ok())
                            .unwrap_or(0);
                        maps.push(PostfixMap {
                            name: map_name,
                            map_type,
                            path: path.to_string(),
                            entries_count: count,
                        });
                    }
                }
            }
        }
        Ok(maps)
    }

    /// Read entries from a Postfix lookup table file.
    pub async fn get_map_entries(
        client: &PostfixClient,
        name: &str,
    ) -> PostfixResult<Vec<PostfixMapEntry>> {
        let path = resolve_map_path(client, name);
        let content = client
            .read_remote_file(&path)
            .await
            .map_err(|_| PostfixError::map_not_found(name))?;
        let mut entries = Vec::new();
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            if let Some((key, value)) = trimmed.split_once(char::is_whitespace) {
                entries.push(PostfixMapEntry {
                    key: key.trim().to_string(),
                    value: value.trim().to_string(),
                });
            } else {
                entries.push(PostfixMapEntry {
                    key: trimmed.to_string(),
                    value: String::new(),
                });
            }
        }
        Ok(entries)
    }

    /// Set or update a single key in a lookup table and rebuild.
    pub async fn set_map_entry(
        client: &PostfixClient,
        name: &str,
        key: &str,
        value: &str,
    ) -> PostfixResult<()> {
        let path = resolve_map_path(client, name);
        let content = client.read_remote_file(&path).await.unwrap_or_default();
        let mut new_lines = Vec::new();
        let mut replaced = false;
        for line in content.lines() {
            let trimmed = line.trim();
            if !trimmed.is_empty() && !trimmed.starts_with('#') {
                if let Some((k, _)) = trimmed.split_once(char::is_whitespace) {
                    if k.trim() == key {
                        new_lines.push(format!("{}\t{}", key, value));
                        replaced = true;
                        continue;
                    }
                }
            }
            new_lines.push(line.to_string());
        }
        if !replaced {
            new_lines.push(format!("{}\t{}", key, value));
        }
        let new_content = new_lines.join("\n") + "\n";
        client.write_remote_file(&path, &new_content).await?;
        client.postmap(&path).await
    }

    /// Delete a key from a lookup table and rebuild.
    pub async fn delete_map_entry(
        client: &PostfixClient,
        name: &str,
        key: &str,
    ) -> PostfixResult<()> {
        let path = resolve_map_path(client, name);
        let content = client
            .read_remote_file(&path)
            .await
            .map_err(|_| PostfixError::map_not_found(name))?;
        let new_lines: Vec<&str> = content
            .lines()
            .filter(|line| {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') {
                    return true;
                }
                if let Some((k, _)) = trimmed.split_once(char::is_whitespace) {
                    k.trim() != key
                } else {
                    trimmed != key
                }
            })
            .collect();
        let new_content = new_lines.join("\n") + "\n";
        client.write_remote_file(&path, &new_content).await?;
        client.postmap(&path).await
    }

    /// Rebuild a postmap hash file.
    pub async fn rebuild_map(client: &PostfixClient, name: &str) -> PostfixResult<()> {
        let path = resolve_map_path(client, name);
        client.postmap(&path).await
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn normalize_field(f: &str) -> Option<String> {
    if f == "-" {
        None
    } else {
        Some(f.to_string())
    }
}

fn resolve_map_path(client: &PostfixClient, name: &str) -> String {
    if name.starts_with('/') {
        name.to_string()
    } else {
        format!("{}/{}", client.config_dir(), name)
    }
}
