//! Samba share CRUD operations.
use crate::client;
use crate::error::FileSharingError;
use crate::types::*;

pub async fn list_shares(host: &FileSharingHost) -> Result<Vec<SambaShare>, FileSharingError> {
    let cfg = crate::samba_conf::get_config(host).await?;
    Ok(cfg.shares)
}

pub async fn add_share(host: &FileSharingHost, share: &SambaShare) -> Result<(), FileSharingError> {
    let block = share_to_conf(share);
    let escaped = block.replace('\'', "'\\''");
    client::exec_ok(
        host,
        "sh",
        &["-c", &format!("echo '{}' >> /etc/samba/smb.conf", escaped)],
    )
    .await?;
    Ok(())
}

pub fn share_to_conf(s: &SambaShare) -> String {
    let mut lines = vec![format!("[{}]", s.name), format!("   path = {}", s.path)];
    if let Some(ref c) = s.comment {
        lines.push(format!("   comment = {c}"));
    }
    lines.push(format!(
        "   browseable = {}",
        if s.browseable { "yes" } else { "no" }
    ));
    lines.push(format!(
        "   writable = {}",
        if s.writable { "yes" } else { "no" }
    ));
    lines.push(format!(
        "   guest ok = {}",
        if s.guest_ok { "yes" } else { "no" }
    ));
    if !s.valid_users.is_empty() {
        lines.push(format!("   valid users = {}", s.valid_users.join(", ")));
    }
    lines.join("\n")
}
