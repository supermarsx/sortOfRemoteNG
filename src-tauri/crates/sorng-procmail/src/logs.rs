// ── procmail log management ──────────────────────────────────────────────────
//! Query and manage procmail delivery logs.

use crate::client::ProcmailClient;
use crate::error::ProcmailResult;
use crate::types::*;

pub struct ProcmailLogManager;

impl ProcmailLogManager {
    /// Query the procmail log, returning parsed entries.
    ///
    /// - `lines`: maximum number of lines to tail (default 200).
    /// - `filter`: optional substring filter applied to each entry's raw text.
    pub async fn query(
        client: &ProcmailClient,
        user: &str,
        lines: Option<usize>,
        filter: Option<&str>,
    ) -> ProcmailResult<Vec<ProcmailLogEntry>> {
        let log_path = Self::resolve_log_path(client, user).await?;
        let limit = lines.unwrap_or(200);
        let cmd = format!(
            "tail -n {} {}",
            limit,
            crate::client::shell_escape(&log_path)
        );
        let out = client.exec_ssh(&cmd).await?;

        let entries: Vec<ProcmailLogEntry> = parse_log_entries(&out.stdout)
            .into_iter()
            .filter(|entry| {
                if let Some(f) = filter {
                    let raw = format!(
                        "{} {} {} {} {}",
                        entry.from_address.as_deref().unwrap_or(""),
                        entry.to_folder.as_deref().unwrap_or(""),
                        entry.subject.as_deref().unwrap_or(""),
                        entry.result.as_deref().unwrap_or(""),
                        entry.procmail_flags.as_deref().unwrap_or(""),
                    );
                    raw.contains(f)
                } else {
                    true
                }
            })
            .collect();

        Ok(entries)
    }

    /// List log files in the procmail log directory.
    pub async fn list_log_files(
        client: &ProcmailClient,
        user: &str,
    ) -> ProcmailResult<Vec<String>> {
        let log_path = Self::resolve_log_path(client, user).await?;
        // Find the directory of the log file
        let log_dir = if let Some(pos) = log_path.rfind('/') {
            &log_path[..pos]
        } else {
            "/var/log"
        };
        let cmd = format!(
            "ls -1 {} 2>/dev/null | grep -i procmail",
            crate::client::shell_escape(log_dir)
        );
        let out = client.exec_ssh(&cmd).await?;
        Ok(out
            .stdout
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| format!("{}/{}", log_dir, l))
            .collect())
    }

    /// Clear (truncate) the procmail log file.
    pub async fn clear_log(
        client: &ProcmailClient,
        user: &str,
    ) -> ProcmailResult<()> {
        let log_path = Self::resolve_log_path(client, user).await?;
        let cmd = format!(
            "sudo truncate -s 0 {}",
            crate::client::shell_escape(&log_path)
        );
        client.exec_ssh(&cmd).await?;
        Ok(())
    }

    /// Get the current LOGFILE path from the user's procmailrc.
    pub async fn get_log_path(
        client: &ProcmailClient,
        user: &str,
    ) -> ProcmailResult<String> {
        Self::resolve_log_path(client, user).await
    }

    /// Set the LOGFILE variable in the user's procmailrc.
    pub async fn set_log_path(
        client: &ProcmailClient,
        user: &str,
        path: &str,
    ) -> ProcmailResult<()> {
        crate::variables::VariableManager::set(client, user, "LOGFILE", path).await
    }

    /// Internal: resolve the actual log path from the procmailrc LOGFILE variable
    /// or fall back to the client config path.
    async fn resolve_log_path(
        client: &ProcmailClient,
        user: &str,
    ) -> ProcmailResult<String> {
        // Try to read LOGFILE from the user's procmailrc
        let content = client.get_procmailrc(user).await.unwrap_or_default();
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("LOGFILE=") || trimmed.starts_with("LOGFILE =") {
                if let Some(pos) = trimmed.find('=') {
                    let val = trimmed[pos + 1..]
                        .trim()
                        .trim_matches('"')
                        .trim_matches('\'');
                    if !val.is_empty() {
                        return Ok(val.to_string());
                    }
                }
            }
        }
        // Fall back to client default
        Ok(client.log_path().to_string())
    }
}

// ─── Parsing helpers ─────────────────────────────────────────────────────────

/// Parse procmail log output into structured entries.
///
/// Procmail log format (LOGABSTRACT=all) looks like:
/// ```text
/// From user@example.com  Mon Jan  1 12:00:00 2024
///  Subject: Test Subject
///  Folder: /home/user/Maildir/new/  1234
/// ```
fn parse_log_entries(raw: &str) -> Vec<ProcmailLogEntry> {
    let mut entries = Vec::new();
    let mut current: Option<ProcmailLogEntry> = None;

    for line in raw.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with("From ") && !trimmed.starts_with("From:") {
            // Start a new entry – flush previous
            if let Some(entry) = current.take() {
                entries.push(entry);
            }

            // Parse: From user@example.com  Mon Jan  1 12:00:00 2024
            let parts: Vec<&str> = trimmed.splitn(3, char::is_whitespace).collect();
            let from_address = parts.get(1).map(|s| s.to_string());
            let timestamp = parts.get(2).map(|s| s.trim().to_string());

            current = Some(ProcmailLogEntry {
                timestamp,
                from_address,
                to_folder: None,
                subject: None,
                size_bytes: None,
                procmail_flags: None,
                result: None,
            });
        } else if let Some(ref mut entry) = current {
            if trimmed.starts_with("Subject:") {
                entry.subject = Some(
                    trimmed
                        .trim_start_matches("Subject:")
                        .trim()
                        .to_string(),
                );
            } else if trimmed.starts_with("Folder:") {
                let folder_part = trimmed.trim_start_matches("Folder:").trim();
                // Folder line may end with size in bytes
                let parts: Vec<&str> = folder_part.rsplitn(2, char::is_whitespace).collect();
                if parts.len() == 2 {
                    if let Ok(size) = parts[0].parse::<u64>() {
                        entry.to_folder = Some(parts[1].trim().to_string());
                        entry.size_bytes = Some(size);
                    } else {
                        entry.to_folder = Some(folder_part.to_string());
                    }
                } else {
                    entry.to_folder = Some(folder_part.to_string());
                }
                entry.result = Some("delivered".to_string());
            } else if trimmed.starts_with("Strstrags:") || trimmed.starts_with("Strstrflags:") || trimmed.starts_with("Strstrags=") {
                entry.procmail_flags = Some(trimmed.to_string());
            } else if trimmed.contains("Error") || trimmed.contains("error") {
                entry.result = Some(trimmed.to_string());
            }
        }
    }

    // Flush the last entry
    if let Some(entry) = current {
        entries.push(entry);
    }

    entries
}
