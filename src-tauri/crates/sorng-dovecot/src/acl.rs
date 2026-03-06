// ── dovecot ACL management ───────────────────────────────────────────────────

use crate::client::{shell_escape, DovecotClient};
use crate::error::{DovecotError, DovecotResult};
use crate::types::*;

pub struct AclManager;

impl AclManager {
    /// List ACLs for a user's mailbox via `doveadm acl get`.
    pub async fn list(
        client: &DovecotClient,
        user: &str,
        mailbox: &str,
    ) -> DovecotResult<Vec<DovecotAcl>> {
        let out = client
            .doveadm(&format!(
                "acl get -u {} {}",
                shell_escape(user),
                shell_escape(mailbox)
            ))
            .await?;
        if out.exit_code != 0 {
            return Err(DovecotError::mailbox_not_found(mailbox));
        }

        let mut acls = Vec::new();
        // Parse doveadm acl get output:
        // ID                   Global Rights
        // user=shared_user           lrwstipe
        for line in out.stdout.lines().skip(1) {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 2 {
                continue;
            }
            let identifier = parts[0].to_string();
            let rights_str = parts.last().unwrap_or(&"");
            let rights: Vec<String> = parse_acl_rights(rights_str);

            acls.push(DovecotAcl {
                mailbox: mailbox.to_string(),
                identifier,
                rights,
            });
        }
        Ok(acls)
    }

    /// Get ACL for a specific identifier on a mailbox via `doveadm acl get`.
    pub async fn get(
        client: &DovecotClient,
        user: &str,
        mailbox: &str,
        identifier: &str,
    ) -> DovecotResult<DovecotAcl> {
        let acls = Self::list(client, user, mailbox).await?;
        acls.into_iter()
            .find(|a| a.identifier == identifier)
            .ok_or_else(|| {
                DovecotError::new(
                    crate::error::DovecotErrorKind::InternalError,
                    format!("ACL not found for identifier '{}' on mailbox '{}'", identifier, mailbox),
                )
            })
    }

    /// Set ACL rights for an identifier on a mailbox via `doveadm acl set`.
    pub async fn set(
        client: &DovecotClient,
        user: &str,
        mailbox: &str,
        identifier: &str,
        rights: &[String],
    ) -> DovecotResult<()> {
        let rights_str = rights.join(" ");
        let out = client
            .doveadm(&format!(
                "acl set -u {} {} {} {}",
                shell_escape(user),
                shell_escape(mailbox),
                shell_escape(identifier),
                rights_str
            ))
            .await?;
        if out.exit_code != 0 {
            return Err(DovecotError::permission_denied(format!(
                "Failed to set ACL on '{}': {}",
                mailbox, out.stderr
            )));
        }
        Ok(())
    }

    /// Delete ACL for an identifier on a mailbox via `doveadm acl delete`.
    pub async fn delete(
        client: &DovecotClient,
        user: &str,
        mailbox: &str,
        identifier: &str,
    ) -> DovecotResult<()> {
        let out = client
            .doveadm(&format!(
                "acl delete -u {} {} {}",
                shell_escape(user),
                shell_escape(mailbox),
                shell_escape(identifier)
            ))
            .await?;
        if out.exit_code != 0 {
            return Err(DovecotError::permission_denied(format!(
                "Failed to delete ACL on '{}': {}",
                mailbox, out.stderr
            )));
        }
        Ok(())
    }
}

/// Parse single-character ACL rights string into descriptive right names.
/// l=lookup, r=read, w=write, s=write-seen, t=write-deleted, i=insert,
/// p=post, e=expunge, k=create, x=delete, a=admin
fn parse_acl_rights(rights_str: &str) -> Vec<String> {
    let mut rights = Vec::new();
    for ch in rights_str.chars() {
        let right = match ch {
            'l' => "lookup",
            'r' => "read",
            'w' => "write",
            's' => "write-seen",
            't' => "write-deleted",
            'i' => "insert",
            'p' => "post",
            'e' => "expunge",
            'k' => "create",
            'x' => "delete",
            'a' => "admin",
            _ => continue,
        };
        rights.push(right.to_string());
    }
    rights
}
