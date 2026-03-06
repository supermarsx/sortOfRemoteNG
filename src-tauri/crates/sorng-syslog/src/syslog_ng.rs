//! syslog-ng configuration management.
use crate::client;
use crate::error::SyslogError;
use crate::types::*;

pub async fn get_config(host: &SyslogHost) -> Result<SyslogNgConfig, SyslogError> {
    let content = client::read_file(host, "/etc/syslog-ng/syslog-ng.conf").await?;
    Ok(parse_syslog_ng_conf(&content))
}

pub async fn restart(host: &SyslogHost) -> Result<(), SyslogError> {
    client::exec_ok(host, "systemctl", &["restart", "syslog-ng"]).await?; Ok(())
}

pub async fn check_config(host: &SyslogHost) -> Result<bool, SyslogError> {
    let (_, _, code) = client::exec(host, "syslog-ng", &["--syntax-only"]).await?;
    Ok(code == 0)
}

fn parse_syslog_ng_conf(_content: &str) -> SyslogNgConfig {
    // TODO: implement full syslog-ng.conf parser
    SyslogNgConfig { version: None, sources: Vec::new(), destinations: Vec::new(), filters: Vec::new(), log_paths: Vec::new() }
}

#[cfg(test)]
mod tests { #[test] fn test_module_loads() {} }
