// ── sorng-mac/src/audit.rs ────────────────────────────────────────────────────
//! Parse and filter SELinux/AppArmor audit logs (audit2allow, audit2why).

use crate::client::MacClient;
use crate::error::MacResult;
use crate::types::*;

/// Run audit2allow on recent AVC denials and return suggested policy.
pub async fn audit2allow(client: &MacClient, audit_lines: &str) -> MacResult<String> {
    let cmd = format!(
        "echo '{}' | audit2allow",
        audit_lines.replace('\'', "'\\''")
    );
    client.run_command(&cmd).await
}

/// Run audit2why on recent AVC denials and return explanations.
pub async fn audit2why(client: &MacClient, audit_lines: &str) -> MacResult<String> {
    let cmd = format!(
        "echo '{}' | audit2why",
        audit_lines.replace('\'', "'\\''")
    );
    client.run_command(&cmd).await
}

/// Fetch the last N SELinux AVC audit entries.
pub async fn selinux_audit(client: &MacClient, limit: u32) -> MacResult<Vec<SelinuxAuditEntry>> {
    crate::selinux::audit_log(client, limit).await
}

/// Fetch the last N AppArmor audit entries.
pub async fn apparmor_audit(
    client: &MacClient,
    limit: u32,
) -> MacResult<Vec<AppArmorLogEntry>> {
    crate::apparmor::audit_log(client, limit).await
}
