//! Disk quota management — repquota, setquota, quota.

use crate::client;
use crate::error::UserMgmtError;
use crate::types::*;

/// List all user quotas for a filesystem.
pub async fn list_quotas(host: &UserMgmtHost, filesystem: &str) -> Result<Vec<DiskQuota>, UserMgmtError> {
    let stdout = client::exec_ok(host, "repquota", &["-u", "-p", filesystem]).await?;
    Ok(parse_repquota(&stdout, filesystem))
}

/// Set quota for a user or group.
pub async fn set_quota(host: &UserMgmtHost, opts: &SetQuotaOpts) -> Result<(), UserMgmtError> {
    let (flag, name) = match &opts.principal {
        QuotaPrincipal::User { name, .. } => ("-u", name.as_str()),
        QuotaPrincipal::Group { name, .. } => ("-g", name.as_str()),
    };

    let bs = opts.block_soft_kb.unwrap_or(0).to_string();
    let bh = opts.block_hard_kb.unwrap_or(0).to_string();
    let is = opts.inode_soft.unwrap_or(0).to_string();
    let ih = opts.inode_hard.unwrap_or(0).to_string();

    client::exec_ok(host, "setquota", &[
        flag, name, &bs, &bh, &is, &ih, &opts.filesystem,
    ]).await?;
    Ok(())
}

/// Enable quotas on a filesystem.
pub async fn enable_quotas(host: &UserMgmtHost, filesystem: &str) -> Result<(), UserMgmtError> {
    client::exec_ok(host, "quotaon", &[filesystem]).await?;
    Ok(())
}

/// Disable quotas on a filesystem.
pub async fn disable_quotas(host: &UserMgmtHost, filesystem: &str) -> Result<(), UserMgmtError> {
    client::exec_ok(host, "quotaoff", &[filesystem]).await?;
    Ok(())
}

fn parse_repquota(_output: &str, _filesystem: &str) -> Vec<DiskQuota> {
    // TODO: parse repquota output
    Vec::new()
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_module_loads() {}
}
