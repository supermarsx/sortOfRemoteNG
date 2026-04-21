//! slapd service management for OpenLDAP.
use crate::client;
use crate::error::LdapError;
use crate::types::*;

pub async fn start(host: &LdapHost) -> Result<(), LdapError> {
    client::exec_ok(host, "systemctl", &["start", "slapd"]).await?;
    Ok(())
}
pub async fn stop(host: &LdapHost) -> Result<(), LdapError> {
    client::exec_ok(host, "systemctl", &["stop", "slapd"]).await?;
    Ok(())
}
pub async fn restart(host: &LdapHost) -> Result<(), LdapError> {
    client::exec_ok(host, "systemctl", &["restart", "slapd"]).await?;
    Ok(())
}
pub async fn status(host: &LdapHost) -> Result<bool, LdapError> {
    let (_, _, code) = client::exec(host, "systemctl", &["is-active", "slapd"]).await?;
    Ok(code == 0)
}
pub async fn test_config(host: &LdapHost) -> Result<bool, LdapError> {
    let (_, _, code) = client::exec(host, "slaptest", &["-u"]).await?;
    Ok(code == 0)
}
