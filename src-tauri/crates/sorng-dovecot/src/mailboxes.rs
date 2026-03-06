// ── dovecot mailbox management ───────────────────────────────────────────────

use crate::client::{shell_escape, DovecotClient};
use crate::error::{DovecotError, DovecotResult};
use crate::types::*;

pub struct MailboxManager;

impl MailboxManager {
    /// List all mailboxes for a user via `doveadm mailbox list`.
    pub async fn list(client: &DovecotClient, user: &str) -> DovecotResult<Vec<DovecotMailbox>> {
        let out = client
            .doveadm(&format!("mailbox list -u {}", shell_escape(user)))
            .await?;
        let mut mailboxes = Vec::new();
        for line in out.stdout.lines() {
            let name = line.trim();
            if name.is_empty() {
                continue;
            }
            // Get status for each mailbox
            let status = Self::status(client, user, name).await.ok();
            mailboxes.push(DovecotMailbox {
                user: user.to_string(),
                name: name.to_string(),
                messages: status.as_ref().map(|s| s.messages).unwrap_or(0),
                unseen: status.as_ref().map(|s| s.unseen).unwrap_or(0),
                recent: status.as_ref().map(|s| s.recent).unwrap_or(0),
                uidvalidity: status.as_ref().map(|s| s.uidvalidity).unwrap_or(0),
                uidnext: status.as_ref().map(|s| s.uidnext).unwrap_or(0),
                vsize: 0,
                guid: None,
            });
        }
        Ok(mailboxes)
    }

    /// Get status of a specific mailbox via `doveadm mailbox status`.
    pub async fn status(
        client: &DovecotClient,
        user: &str,
        mailbox: &str,
    ) -> DovecotResult<DovecotMailboxStatus> {
        let out = client
            .doveadm(&format!(
                "mailbox status -u {} \"messages recent unseen uidvalidity uidnext highestmodseq\" {}",
                shell_escape(user),
                shell_escape(mailbox)
            ))
            .await?;
        let raw = out.stdout.trim();
        let mut messages = 0u64;
        let mut recent = 0u64;
        let mut unseen = 0u64;
        let mut uidvalidity = 0u64;
        let mut uidnext = 0u64;
        let mut highestmodseq = 0u64;

        for part in raw.split_whitespace() {
            if let Some(val) = part.strip_prefix("messages=") {
                messages = val.parse().unwrap_or(0);
            } else if let Some(val) = part.strip_prefix("recent=") {
                recent = val.parse().unwrap_or(0);
            } else if let Some(val) = part.strip_prefix("unseen=") {
                unseen = val.parse().unwrap_or(0);
            } else if let Some(val) = part.strip_prefix("uidvalidity=") {
                uidvalidity = val.parse().unwrap_or(0);
            } else if let Some(val) = part.strip_prefix("uidnext=") {
                uidnext = val.parse().unwrap_or(0);
            } else if let Some(val) = part.strip_prefix("highestmodseq=") {
                highestmodseq = val.parse().unwrap_or(0);
            }
        }

        Ok(DovecotMailboxStatus {
            mailbox: mailbox.to_string(),
            messages,
            recent,
            unseen,
            uidvalidity,
            uidnext,
            highestmodseq,
        })
    }

    /// Create a mailbox for a user via `doveadm mailbox create`.
    pub async fn create(client: &DovecotClient, user: &str, name: &str) -> DovecotResult<()> {
        let out = client
            .doveadm(&format!(
                "mailbox create -u {} {}",
                shell_escape(user),
                shell_escape(name)
            ))
            .await?;
        if out.exit_code != 0 {
            return Err(DovecotError::new(
                crate::error::DovecotErrorKind::InternalError,
                format!("Failed to create mailbox '{}': {}", name, out.stderr),
            ));
        }
        Ok(())
    }

    /// Delete a mailbox for a user via `doveadm mailbox delete`.
    pub async fn delete(client: &DovecotClient, user: &str, name: &str) -> DovecotResult<()> {
        let out = client
            .doveadm(&format!(
                "mailbox delete -u {} {}",
                shell_escape(user),
                shell_escape(name)
            ))
            .await?;
        if out.exit_code != 0 {
            return Err(DovecotError::mailbox_not_found(name));
        }
        Ok(())
    }

    /// Rename a mailbox via `doveadm mailbox rename`.
    pub async fn rename(
        client: &DovecotClient,
        user: &str,
        old_name: &str,
        new_name: &str,
    ) -> DovecotResult<()> {
        let out = client
            .doveadm(&format!(
                "mailbox rename -u {} {} {}",
                shell_escape(user),
                shell_escape(old_name),
                shell_escape(new_name)
            ))
            .await?;
        if out.exit_code != 0 {
            return Err(DovecotError::mailbox_not_found(old_name));
        }
        Ok(())
    }

    /// Subscribe to a mailbox via `doveadm mailbox subscribe`.
    pub async fn subscribe(client: &DovecotClient, user: &str, name: &str) -> DovecotResult<()> {
        let out = client
            .doveadm(&format!(
                "mailbox subscribe -u {} {}",
                shell_escape(user),
                shell_escape(name)
            ))
            .await?;
        if out.exit_code != 0 {
            return Err(DovecotError::mailbox_not_found(name));
        }
        Ok(())
    }

    /// Unsubscribe from a mailbox via `doveadm mailbox unsubscribe`.
    pub async fn unsubscribe(
        client: &DovecotClient,
        user: &str,
        name: &str,
    ) -> DovecotResult<()> {
        let out = client
            .doveadm(&format!(
                "mailbox unsubscribe -u {} {}",
                shell_escape(user),
                shell_escape(name)
            ))
            .await?;
        if out.exit_code != 0 {
            return Err(DovecotError::mailbox_not_found(name));
        }
        Ok(())
    }

    /// List mailbox subscriptions via `doveadm mailbox list -s`.
    pub async fn list_subscriptions(
        client: &DovecotClient,
        user: &str,
    ) -> DovecotResult<Vec<String>> {
        let out = client
            .doveadm(&format!("mailbox list -s -u {}", shell_escape(user)))
            .await?;
        Ok(out
            .stdout
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect())
    }

    /// Sync user's mailboxes via `doveadm sync`.
    pub async fn sync(client: &DovecotClient, user: &str) -> DovecotResult<()> {
        let out = client
            .doveadm(&format!("sync -u {}", shell_escape(user)))
            .await?;
        if out.exit_code != 0 {
            return Err(DovecotError::process(format!(
                "sync failed for '{}': {}",
                user, out.stderr
            )));
        }
        Ok(())
    }

    /// Force resync of a specific mailbox via `doveadm force-resync`.
    pub async fn force_resync(
        client: &DovecotClient,
        user: &str,
        mailbox: &str,
    ) -> DovecotResult<()> {
        let out = client
            .doveadm(&format!(
                "force-resync -u {} {}",
                shell_escape(user),
                shell_escape(mailbox)
            ))
            .await?;
        if out.exit_code != 0 {
            return Err(DovecotError::process(format!(
                "force-resync failed for '{}': {}",
                mailbox, out.stderr
            )));
        }
        Ok(())
    }
}
