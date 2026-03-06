// ── ClamAV database management ───────────────────────────────────────────────

use crate::client::{shell_escape, ClamavClient};
use crate::error::ClamavResult;
use crate::types::*;

pub struct DatabaseManager;

impl DatabaseManager {
    /// List all signature databases.
    pub async fn list(client: &ClamavClient) -> ClamavResult<Vec<DatabaseInfo>> {
        let out = client
            .exec_ssh("ls -1 /var/lib/clamav/*.{cvd,cld} 2>/dev/null || true")
            .await?;
        let mut databases = Vec::new();
        for line in out.stdout.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let name = line
                .rsplit('/')
                .next()
                .unwrap_or(line)
                .to_string();
            // Query sigtool for database info
            let info_out = client
                .exec_ssh(&format!("sigtool --info {} 2>&1", shell_escape(line)))
                .await;
            let (version, signatures, build_time) = match info_out {
                Ok(ref o) => parse_sigtool_info(&o.stdout),
                Err(_) => (None, None, None),
            };
            databases.push(DatabaseInfo {
                name,
                version,
                signatures,
                build_time,
                updated_at: None,
            });
        }
        Ok(databases)
    }

    /// Run freshclam to update all databases.
    pub async fn update(client: &ClamavClient) -> ClamavResult<Vec<DatabaseUpdateResult>> {
        let out = client
            .exec_ssh(&format!(
                "sudo {} --config-file={} 2>&1",
                client.freshclam_bin(),
                shell_escape(client.freshclam_conf())
            ))
            .await?;
        Ok(parse_freshclam_output(&out.stdout))
    }

    /// Update a specific database by name.
    pub async fn update_database(
        client: &ClamavClient,
        name: &str,
    ) -> ClamavResult<DatabaseUpdateResult> {
        let out = client
            .exec_ssh(&format!(
                "sudo {} --config-file={} --update-db={} 2>&1",
                client.freshclam_bin(),
                shell_escape(client.freshclam_conf()),
                shell_escape(name)
            ))
            .await?;
        let results = parse_freshclam_output(&out.stdout);
        results.into_iter().next().ok_or_else(|| {
            crate::error::ClamavError::database_error(format!(
                "No update result for database '{}'",
                name
            ))
        })
    }

    /// Check if updates are available (without downloading).
    pub async fn check_update(client: &ClamavClient) -> ClamavResult<bool> {
        let out = client
            .exec_ssh(&format!(
                "sudo {} --config-file={} --check 2>&1",
                client.freshclam_bin(),
                shell_escape(client.freshclam_conf())
            ))
            .await?;
        Ok(out.stdout.contains("is up-to-date")
            || out.stdout.contains("updated")
            || out.exit_code == 0)
    }

    /// Get list of configured database mirrors.
    pub async fn get_mirrors(client: &ClamavClient) -> ClamavResult<Vec<String>> {
        let content = client.read_remote_file(client.freshclam_conf()).await?;
        let mut mirrors = Vec::new();
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("DatabaseMirror ") || trimmed.starts_with("PrivateMirror ") {
                if let Some(url) = trimmed.split_whitespace().nth(1) {
                    mirrors.push(url.to_string());
                }
            }
        }
        Ok(mirrors)
    }

    /// Add a database mirror to freshclam.conf.
    pub async fn add_mirror(client: &ClamavClient, url: &str) -> ClamavResult<()> {
        let content = client.read_remote_file(client.freshclam_conf()).await?;
        let new_line = format!("DatabaseMirror {}", url);
        if content.contains(&new_line) {
            return Ok(());
        }
        let new_content = format!("{}\n{}\n", content.trim_end(), new_line);
        client
            .write_remote_file(client.freshclam_conf(), &new_content)
            .await
    }

    /// Remove a database mirror from freshclam.conf.
    pub async fn remove_mirror(client: &ClamavClient, url: &str) -> ClamavResult<()> {
        let content = client.read_remote_file(client.freshclam_conf()).await?;
        let filtered: Vec<&str> = content
            .lines()
            .filter(|line| {
                let trimmed = line.trim();
                !(trimmed == format!("DatabaseMirror {}", url)
                    || trimmed == format!("PrivateMirror {}", url))
            })
            .collect();
        let new_content = filtered.join("\n") + "\n";
        client
            .write_remote_file(client.freshclam_conf(), &new_content)
            .await
    }

    /// Get the freshclam/database version string.
    pub async fn get_version(client: &ClamavClient) -> ClamavResult<String> {
        let out = client
            .exec_ssh(&format!("{} --version 2>&1", client.freshclam_bin()))
            .await?;
        Ok(out.stdout.trim().to_string())
    }
}

// ─── Parsing helpers ─────────────────────────────────────────────────────────

fn parse_sigtool_info(output: &str) -> (Option<String>, Option<u64>, Option<String>) {
    let mut version = None;
    let mut signatures = None;
    let mut build_time = None;

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("Version:") {
            version = Some(
                trimmed
                    .trim_start_matches("Version:")
                    .trim()
                    .to_string(),
            );
        } else if trimmed.starts_with("Signatures:") {
            signatures = trimmed
                .trim_start_matches("Signatures:")
                .trim()
                .parse()
                .ok();
        } else if trimmed.starts_with("Build time:") {
            build_time = Some(
                trimmed
                    .trim_start_matches("Build time:")
                    .trim()
                    .to_string(),
            );
        }
    }

    (version, signatures, build_time)
}

fn parse_freshclam_output(output: &str) -> Vec<DatabaseUpdateResult> {
    let mut results = Vec::new();
    let databases = ["daily", "main", "bytecode"];

    for db in &databases {
        let db_str = *db;
        let mut found = false;
        let mut success = false;
        let mut new_version = None;
        let mut message = String::new();

        for line in output.lines() {
            let lower = line.to_lowercase();
            if lower.contains(db_str) {
                found = true;
                if lower.contains("is up-to-date") || lower.contains("up to date") {
                    success = true;
                    message = format!("{} is up to date", db_str);
                } else if lower.contains("updated") {
                    success = true;
                    message = format!("{} updated successfully", db_str);
                    // Try to extract version
                    if let Some(ver_part) = line.split("version").nth(1) {
                        new_version =
                            Some(ver_part.split_whitespace().next().unwrap_or("").to_string());
                    }
                } else if lower.contains("error") || lower.contains("failed") {
                    success = false;
                    message = line.trim().to_string();
                }
            }
        }

        if found {
            results.push(DatabaseUpdateResult {
                database: db_str.to_string(),
                success,
                new_version,
                message,
            });
        }
    }

    if results.is_empty() {
        results.push(DatabaseUpdateResult {
            database: "unknown".to_string(),
            success: false,
            new_version: None,
            message: output.trim().to_string(),
        });
    }

    results
}
