//! Disk quota management — repquota, setquota, quota.

use crate::client;
use crate::error::UserMgmtError;
use crate::types::*;

/// List all user quotas for a filesystem.
pub async fn list_quotas(
    host: &UserMgmtHost,
    filesystem: &str,
) -> Result<Vec<DiskQuota>, UserMgmtError> {
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

    client::exec_ok(
        host,
        "setquota",
        &[flag, name, &bs, &bh, &is, &ih, &opts.filesystem],
    )
    .await?;
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

fn parse_repquota(output: &str, filesystem: &str) -> Vec<DiskQuota> {
    // repquota -u -p output format (machine-parseable with -p):
    //   user--block_used-block_soft-block_hard-block_grace-inode_used-inode_soft-inode_hard-inode_grace
    //
    // Without -p, traditional format:
    //   Block limits                File limits
    //   User            used    soft    hard  grace    used  soft  hard  grace
    //   root      --  123456       0       0             1234     0     0
    //
    // The -p flag produces: user status block_used block_soft block_hard block_grace inode_used inode_soft inode_hard inode_grace
    let mut quotas = Vec::new();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty()
            || line.starts_with('#')
            || line.starts_with("***")
            || line.starts_with("Block")
            || line.starts_with("User")
            || line.starts_with("Group")
            || line.contains("Report for")
            || line.contains("report for")
        {
            continue;
        }

        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 8 {
            continue;
        }

        let username = parts[0];
        let status = parts[1]; // "--", "+-", "-+", "++"

        // Parse numeric fields. With -p flag the fields start at index 2.
        // Without -p, they also start at index 2 after the status flags.
        let block_used: u64 = parts.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
        let block_soft: u64 = parts.get(3).and_then(|s| s.parse().ok()).unwrap_or(0);
        let block_hard: u64 = parts.get(4).and_then(|s| s.parse().ok()).unwrap_or(0);
        let block_grace = parts.get(5).and_then(|s| {
            if s.parse::<u64>().is_ok() || *s == "none" {
                None
            } else {
                Some(s.to_string())
            }
        });

        // Inode fields — their position depends on whether grace is present
        let inode_offset = if block_grace.is_some() { 6 } else { 5 };
        let inode_used: u64 = parts
            .get(inode_offset)
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let inode_soft: u64 = parts
            .get(inode_offset + 1)
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let inode_hard: u64 = parts
            .get(inode_offset + 2)
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let inode_grace = parts.get(inode_offset + 3).and_then(|s| {
            if s.parse::<u64>().is_ok() || *s == "none" {
                None
            } else {
                Some(s.to_string())
            }
        });

        let over_block = status.starts_with('+');
        let over_inode = status.ends_with('+');

        quotas.push(DiskQuota {
            filesystem: filesystem.to_string(),
            principal: QuotaPrincipal::User {
                name: username.to_string(),
                uid: 0, // uid not available in repquota text output
            },
            block_usage_kb: block_used,
            block_soft_limit_kb: block_soft,
            block_hard_limit_kb: block_hard,
            inode_usage: inode_used,
            inode_soft_limit: inode_soft,
            inode_hard_limit: inode_hard,
            block_grace_remaining: block_grace,
            inode_grace_remaining: inode_grace,
            over_block_soft: over_block,
            over_inode_soft: over_inode,
        });
    }
    quotas
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_repquota_basic() {
        let input = "\
*** Report for user quotas on device /dev/sda1
Block grace time: 7days; Inode grace time: 7days
                        Block limits                File limits
User            used    soft    hard  grace    used  soft  hard  grace
----------------------------------------------------------------------
root      --  123456       0       0              1234     0     0
alice     +-  500000  400000  600000  6days      800  1000  2000
bob       --    1024    2048    4096               10    20    40";

        let quotas = parse_repquota(input, "/dev/sda1");
        assert_eq!(quotas.len(), 3);

        assert_eq!(quotas[0].block_usage_kb, 123456);
        assert!(!quotas[0].over_block_soft);

        assert_eq!(quotas[1].block_usage_kb, 500000);
        assert!(quotas[1].over_block_soft);
        assert!(!quotas[1].over_inode_soft);

        assert_eq!(quotas[2].block_usage_kb, 1024);
        assert_eq!(quotas[2].filesystem, "/dev/sda1");
    }
}
