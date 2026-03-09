//! LDAP replication status.
use crate::client;
use crate::error::LdapError;
use crate::types::*;

pub async fn get_replication_status(host: &LdapHost) -> Result<Vec<ReplicationStatus>, LdapError> {
    let stdout = client::exec_ok(
        host,
        "ldapsearch",
        &[
            "-x",
            "-H",
            &host.ldap_uri,
            "-b",
            "cn=config",
            "(objectClass=olcSyncReplConfig)",
        ],
    )
    .await?;
    let _ = stdout; // TODO: parse replication config
    Ok(Vec::new())
}
