//! Remote log forwarding configuration.
use crate::client;
use crate::error::SyslogError;
use crate::types::*;

pub async fn configure_forwarding(host: &SyslogHost, config: &RemoteLoggingConfig) -> Result<(), SyslogError> {
    let proto_prefix = match config.protocol {
        RemoteLogProtocol::Udp => "@",
        RemoteLogProtocol::Tcp => "@@",
        RemoteLogProtocol::Relp => "@@", // RELP uses different module
    };
    let rule = format!("*.* {proto_prefix}{}:{}", config.target_host, config.target_port);
    let filename = format!("/etc/rsyslog.d/99-remote-{}.conf", config.target_host.replace('.', "-"));
    let escaped = rule.replace('\'', "'\\''");
    client::exec_ok(host, "sh", &["-c", &format!("echo '{escaped}' > {filename}")]).await?;
    Ok(())
}

pub async fn remove_forwarding(host: &SyslogHost, target_host: &str) -> Result<(), SyslogError> {
    let filename = format!("/etc/rsyslog.d/99-remote-{}.conf", target_host.replace('.', "-"));
    client::exec_ok(host, "rm", &["-f", &filename]).await?;
    Ok(())
}

#[cfg(test)]
mod tests { #[test] fn test_module_loads() {} }
