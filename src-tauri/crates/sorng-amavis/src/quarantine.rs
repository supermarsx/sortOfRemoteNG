// ── amavis quarantine management ─────────────────────────────────────────────

use crate::client::{shell_escape, AmavisClient};
use crate::error::{AmavisError, AmavisResult};
use crate::types::*;

const QUARANTINE_DIR: &str = "/var/lib/amavis/virusmails";

pub struct QuarantineManager;

impl QuarantineManager {
    /// List quarantined items, optionally filtered by type.
    pub async fn list(
        client: &AmavisClient,
        request: &QuarantineListRequest,
    ) -> AmavisResult<Vec<AmavisQuarantineItem>> {
        let limit = request.limit.unwrap_or(100);
        let offset = request.offset.unwrap_or(0);

        let type_filter = request
            .quarantine_type
            .as_deref()
            .map(|t| format!(" | grep -i '{}'", t))
            .unwrap_or_default();

        let cmd = format!(
            "find {} -type f -printf '%f\\t%s\\t%T@\\n' 2>/dev/null{} | sort -t'\\t' -k3 -rn | tail -n +{} | head -n {}",
            shell_escape(QUARANTINE_DIR),
            type_filter,
            offset + 1,
            limit
        );
        let out = client.ssh_exec(&cmd).await?;

        let mut items = Vec::new();
        for line in out.stdout.lines() {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() < 3 {
                continue;
            }
            let mail_id = parts[0].to_string();
            let size_bytes = parts[1].parse::<u64>().unwrap_or(0);
            let timestamp = parts[2].parse::<f64>().unwrap_or(0.0);
            let time_iso = chrono::DateTime::from_timestamp(timestamp as i64, 0)
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_default();

            // Classify quarantine type from filename patterns
            let quarantine_type = classify_quarantine_type(&mail_id);

            // Attempt to extract headers from the quarantined message
            let headers = client
                .ssh_exec(&format!(
                    "head -50 {}/{} 2>/dev/null",
                    shell_escape(QUARANTINE_DIR),
                    shell_escape(&mail_id)
                ))
                .await
                .ok()
                .map(|o| o.stdout)
                .unwrap_or_default();

            let sender = extract_header(&headers, "From").unwrap_or_default();
            let recipients = extract_header(&headers, "To")
                .map(|to| to.split(',').map(|s| s.trim().to_string()).collect())
                .unwrap_or_default();
            let subject = extract_header(&headers, "Subject");
            let content_type = extract_header(&headers, "Content-Type");
            let spam_level =
                extract_header(&headers, "X-Spam-Score").and_then(|s| s.parse::<f64>().ok());

            items.push(AmavisQuarantineItem {
                mail_id,
                partition_tag: None,
                sender,
                recipients,
                subject,
                spam_level,
                content_type,
                time_iso,
                quarantine_type,
                size_bytes,
            });
        }
        Ok(items)
    }

    /// Get a single quarantined item by mail ID.
    pub async fn get(client: &AmavisClient, mail_id: &str) -> AmavisResult<AmavisQuarantineItem> {
        let path = format!("{}/{}", QUARANTINE_DIR, mail_id);
        let exists = client.file_exists(&path).await.unwrap_or(false);
        if !exists {
            return Err(AmavisError::quarantine(format!(
                "Quarantine item not found: {}",
                mail_id
            )));
        }

        let stat_out = client
            .ssh_exec(&format!(
                "stat -c '%s\\t%Y' {} 2>/dev/null",
                shell_escape(&path)
            ))
            .await?;
        let stat_parts: Vec<&str> = stat_out.stdout.trim().split('\t').collect();
        let size_bytes = stat_parts
            .first()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        let timestamp = stat_parts
            .get(1)
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);
        let time_iso = chrono::DateTime::from_timestamp(timestamp, 0)
            .map(|dt| dt.to_rfc3339())
            .unwrap_or_default();

        let headers = client
            .ssh_exec(&format!("head -50 {}", shell_escape(&path)))
            .await
            .ok()
            .map(|o| o.stdout)
            .unwrap_or_default();

        let sender = extract_header(&headers, "From").unwrap_or_default();
        let recipients = extract_header(&headers, "To")
            .map(|to| to.split(',').map(|s| s.trim().to_string()).collect())
            .unwrap_or_default();
        let subject = extract_header(&headers, "Subject");
        let content_type = extract_header(&headers, "Content-Type");
        let spam_level =
            extract_header(&headers, "X-Spam-Score").and_then(|s| s.parse::<f64>().ok());
        let quarantine_type = classify_quarantine_type(mail_id);

        Ok(AmavisQuarantineItem {
            mail_id: mail_id.to_string(),
            partition_tag: None,
            sender,
            recipients,
            subject,
            spam_level,
            content_type,
            time_iso,
            quarantine_type,
            size_bytes,
        })
    }

    /// Release a quarantined message (re-inject into the mail queue).
    pub async fn release(client: &AmavisClient, mail_id: &str) -> AmavisResult<()> {
        let out = client
            .ssh_exec(&format!(
                "amavisd-new release {} 2>&1 || amavisd release {} 2>&1",
                shell_escape(mail_id),
                shell_escape(mail_id)
            ))
            .await?;
        if out.exit_code != 0 {
            return Err(AmavisError::quarantine(format!(
                "Failed to release {}: {}",
                mail_id, out.stderr
            )));
        }
        Ok(())
    }

    /// Delete a quarantined message permanently.
    pub async fn delete(client: &AmavisClient, mail_id: &str) -> AmavisResult<()> {
        let path = format!("{}/{}", QUARANTINE_DIR, mail_id);
        let out = client
            .ssh_exec(&format!("sudo rm -f {}", shell_escape(&path)))
            .await?;
        if out.exit_code != 0 {
            return Err(AmavisError::quarantine(format!(
                "Failed to delete {}: {}",
                mail_id, out.stderr
            )));
        }
        Ok(())
    }

    /// Release all quarantined messages of a given type.
    pub async fn release_all(client: &AmavisClient, quarantine_type: &str) -> AmavisResult<()> {
        let items = Self::list(
            client,
            &QuarantineListRequest {
                quarantine_type: Some(quarantine_type.to_string()),
                limit: Some(10000),
                offset: None,
            },
        )
        .await?;
        for item in &items {
            if let Err(e) = Self::release(client, &item.mail_id).await {
                log::warn!("Failed to release {}: {}", item.mail_id, e);
            }
        }
        Ok(())
    }

    /// Delete all quarantined messages of a given type.
    pub async fn delete_all(client: &AmavisClient, quarantine_type: &str) -> AmavisResult<()> {
        let items = Self::list(
            client,
            &QuarantineListRequest {
                quarantine_type: Some(quarantine_type.to_string()),
                limit: Some(10000),
                offset: None,
            },
        )
        .await?;
        for item in &items {
            if let Err(e) = Self::delete(client, &item.mail_id).await {
                log::warn!("Failed to delete {}: {}", item.mail_id, e);
            }
        }
        Ok(())
    }

    /// Get quarantine statistics.
    pub async fn get_stats(client: &AmavisClient) -> AmavisResult<AmavisQuarantineStats> {
        let count_cmd = format!(
            "find {} -type f 2>/dev/null | wc -l",
            shell_escape(QUARANTINE_DIR)
        );
        let size_cmd = format!(
            "du -sb {} 2>/dev/null | cut -f1",
            shell_escape(QUARANTINE_DIR)
        );
        let oldest_cmd = format!(
            "find {} -type f -printf '%T@\\n' 2>/dev/null | sort -n | head -1",
            shell_escape(QUARANTINE_DIR)
        );

        let count_out = client.ssh_exec(&count_cmd).await?;
        let size_out = client.ssh_exec(&size_cmd).await?;
        let oldest_out = client.ssh_exec(&oldest_cmd).await?;

        let total_items = count_out.stdout.trim().parse::<u64>().unwrap_or(0);
        let total_size_bytes = size_out.stdout.trim().parse::<u64>().unwrap_or(0);
        let oldest_item_time = oldest_out.stdout.trim().parse::<f64>().ok().and_then(|ts| {
            chrono::DateTime::from_timestamp(ts as i64, 0).map(|dt| dt.to_rfc3339())
        });

        // Count by type using filename classification
        let ls_cmd = format!(
            "find {} -type f -printf '%f\\n' 2>/dev/null",
            shell_escape(QUARANTINE_DIR)
        );
        let ls_out = client.ssh_exec(&ls_cmd).await?;
        let mut spam_count = 0u64;
        let mut virus_count = 0u64;
        let mut banned_count = 0u64;
        for line in ls_out.stdout.lines() {
            match classify_quarantine_type(line.trim()).as_str() {
                "spam" => spam_count += 1,
                "virus" => virus_count += 1,
                "banned" => banned_count += 1,
                _ => {}
            }
        }

        Ok(AmavisQuarantineStats {
            total_items,
            total_size_bytes,
            spam_count,
            virus_count,
            banned_count,
            oldest_item_time,
        })
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn classify_quarantine_type(filename: &str) -> String {
    let lower = filename.to_lowercase();
    if lower.contains("spam") || lower.starts_with("spam-") {
        "spam".to_string()
    } else if lower.contains("virus") || lower.contains("banned") {
        if lower.contains("virus") {
            "virus".to_string()
        } else {
            "banned".to_string()
        }
    } else if lower.contains("badh") || lower.contains("bad-header") {
        "bad_header".to_string()
    } else {
        "unknown".to_string()
    }
}

fn extract_header(headers: &str, name: &str) -> Option<String> {
    let prefix = format!("{}:", name);
    for line in headers.lines() {
        if line.to_lowercase().starts_with(&prefix.to_lowercase()) {
            let value = line[prefix.len()..].trim().to_string();
            if !value.is_empty() {
                return Some(value);
            }
        }
    }
    None
}
