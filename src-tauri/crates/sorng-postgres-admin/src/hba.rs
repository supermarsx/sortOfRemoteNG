// ── sorng-postgres-admin – HBA management ────────────────────────────────────
//! Parse, edit, and manage pg_hba.conf and pg_ident.conf.

use crate::client::{shell_escape, PgAdminClient};
use crate::error::{PgAdminError, PgAdminResult};
use crate::types::*;

pub struct HbaManager;

impl HbaManager {
    /// List entries from pg_hba.conf.
    pub async fn list_entries(client: &PgAdminClient) -> PgAdminResult<Vec<PgHbaEntry>> {
        let hba_path = Self::hba_file_path(client).await?;
        let content = client.read_remote_file(&hba_path).await?;

        let mut entries = Vec::new();
        for (i, line) in content.lines().enumerate() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some(entry) = parse_hba_line(line, (i + 1) as u32) {
                entries.push(entry);
            }
        }
        Ok(entries)
    }

    /// Add an entry to pg_hba.conf.
    pub async fn add_entry(client: &PgAdminClient, req: &AddHbaEntryRequest) -> PgAdminResult<PgHbaEntry> {
        let hba_path = Self::hba_file_path(client).await?;
        let content = client.read_remote_file(&hba_path).await?;

        let new_line = format_hba_entry(req);
        let mut lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();

        if let Some(pos) = req.position {
            let idx = (pos as usize).min(lines.len());
            lines.insert(idx, new_line.clone());
        } else {
            lines.push(new_line.clone());
        }

        let new_content = lines.join("\n") + "\n";
        client.write_remote_file(&hba_path, &new_content).await?;

        let line_number = req.position.unwrap_or(lines.len() as u32);
        Ok(PgHbaEntry {
            type_: req.type_.clone(),
            database: req.database.clone(),
            user: req.user.clone(),
            address: req.address.clone(),
            auth_method: req.auth_method.clone(),
            options: req.options.clone(),
            line_number,
        })
    }

    /// Remove an entry by line number.
    pub async fn remove_entry(client: &PgAdminClient, line_number: u32) -> PgAdminResult<()> {
        let hba_path = Self::hba_file_path(client).await?;
        let content = client.read_remote_file(&hba_path).await?;

        let lines: Vec<String> = content.lines()
            .enumerate()
            .filter(|(i, _)| (*i + 1) as u32 != line_number)
            .map(|(_, l)| l.to_string())
            .collect();

        let new_content = lines.join("\n") + "\n";
        client.write_remote_file(&hba_path, &new_content).await?;
        Ok(())
    }

    /// Update an entry at a specific line number.
    pub async fn update_entry(client: &PgAdminClient, line_number: u32, req: &AddHbaEntryRequest) -> PgAdminResult<PgHbaEntry> {
        let hba_path = Self::hba_file_path(client).await?;
        let content = client.read_remote_file(&hba_path).await?;

        let new_line = format_hba_entry(req);
        let mut lines: Vec<String> = content.lines().map(|l| l.to_string()).collect();

        let idx = (line_number as usize).saturating_sub(1);
        if idx < lines.len() {
            lines[idx] = new_line;
        } else {
            return Err(PgAdminError::hba(format!("Line number {} out of range", line_number)));
        }

        let new_content = lines.join("\n") + "\n";
        client.write_remote_file(&hba_path, &new_content).await?;

        Ok(PgHbaEntry {
            type_: req.type_.clone(),
            database: req.database.clone(),
            user: req.user.clone(),
            address: req.address.clone(),
            auth_method: req.auth_method.clone(),
            options: req.options.clone(),
            line_number,
        })
    }

    /// Reload HBA configuration.
    pub async fn reload(client: &PgAdminClient) -> PgAdminResult<()> {
        client.exec_psql("SELECT pg_reload_conf();").await?;
        Ok(())
    }

    /// Get pg_ident.conf mappings.
    pub async fn get_ident_map(client: &PgAdminClient) -> PgAdminResult<Vec<PgIdentMap>> {
        let ident_path = Self::ident_file_path(client).await?;
        let content = client.read_remote_file(&ident_path).await?;

        let mut maps = Vec::new();
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 3 {
                maps.push(PgIdentMap {
                    map_name: parts[0].to_string(),
                    system_username: parts[1].to_string(),
                    pg_username: parts[2].to_string(),
                });
            }
        }
        Ok(maps)
    }

    /// Validate pg_hba.conf syntax using pg_hba_file_rules().
    pub async fn validate(client: &PgAdminClient) -> PgAdminResult<Vec<String>> {
        let raw = client.exec_psql(
            "SELECT line_number, error FROM pg_hba_file_rules WHERE error IS NOT NULL;"
        ).await?;

        let mut errors = Vec::new();
        for line in raw.lines() {
            let line = line.trim();
            if !line.is_empty() {
                errors.push(line.to_string());
            }
        }
        Ok(errors)
    }

    // ── Helpers ──────────────────────────────────────────────────

    async fn hba_file_path(client: &PgAdminClient) -> PgAdminResult<String> {
        let raw = client.exec_psql("SHOW hba_file;").await?;
        let path = raw.trim();
        if path.is_empty() {
            return Err(PgAdminError::hba("Could not determine pg_hba.conf path"));
        }
        Ok(path.to_string())
    }

    async fn ident_file_path(client: &PgAdminClient) -> PgAdminResult<String> {
        let raw = client.exec_psql("SHOW ident_file;").await?;
        let path = raw.trim();
        if path.is_empty() {
            return Err(PgAdminError::hba("Could not determine pg_ident.conf path"));
        }
        Ok(path.to_string())
    }
}

fn parse_hba_type(s: &str) -> Option<HbaType> {
    match s.to_lowercase().as_str() {
        "local" => Some(HbaType::Local),
        "host" => Some(HbaType::Host),
        "hostssl" => Some(HbaType::Hostssl),
        "hostnossl" => Some(HbaType::Hostnossl),
        "hostgssenc" => Some(HbaType::Hostgssenc),
        "hostnogssenc" => Some(HbaType::Hostnogssenc),
        _ => None,
    }
}

fn parse_hba_line(line: &str, line_number: u32) -> Option<PgHbaEntry> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 4 {
        return None;
    }

    let type_ = parse_hba_type(parts[0])?;
    let is_local = matches!(type_, HbaType::Local);

    let (database, user, address, auth_method, options_start) = if is_local {
        // local  database  user  auth-method  [options]
        if parts.len() < 4 { return None; }
        (parts[1], parts[2], None, parts[3], 4)
    } else {
        // host  database  user  address  auth-method  [options]
        if parts.len() < 5 { return None; }
        (parts[1], parts[2], Some(parts[3]), parts[4], 5)
    };

    let options = if options_start < parts.len() {
        Some(parts[options_start..].join(" "))
    } else {
        None
    };

    Some(PgHbaEntry {
        type_,
        database: database.to_string(),
        user: user.to_string(),
        address: address.map(|s| s.to_string()),
        auth_method: auth_method.to_string(),
        options,
        line_number,
    })
}

fn format_hba_entry(req: &AddHbaEntryRequest) -> String {
    let mut parts = vec![
        req.type_.to_string(),
        req.database.clone(),
        req.user.clone(),
    ];
    if let Some(ref addr) = req.address {
        parts.push(addr.clone());
    }
    parts.push(req.auth_method.clone());
    if let Some(ref opts) = req.options {
        parts.push(opts.clone());
    }
    parts.join("\t")
}
