//! rsyslog configuration management.
use crate::client;
use crate::error::SyslogError;
use crate::types::*;
use std::collections::HashMap;

pub async fn get_config(host: &SyslogHost) -> Result<RsyslogConfig, SyslogError> {
    let content = client::read_file(host, "/etc/rsyslog.conf").await?;
    parse_rsyslog_conf(&content)
}

pub async fn restart(host: &SyslogHost) -> Result<(), SyslogError> {
    client::exec_ok(host, "systemctl", &["restart", "rsyslog"]).await?;
    Ok(())
}

pub async fn check_config(host: &SyslogHost) -> Result<bool, SyslogError> {
    let (_, _, code) = client::exec(host, "rsyslogd", &["-N1"]).await?;
    Ok(code == 0)
}

pub fn parse_rsyslog_conf(content: &str) -> Result<RsyslogConfig, SyslogError> {
    let mut modules = Vec::new();
    let mut rules = Vec::new();
    let mut global = HashMap::new();
    let mut templates = Vec::new();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with("module(") || line.starts_with("$ModLoad") {
            modules.push(line.to_string());
        } else if line.starts_with("template(") {
            templates.push(RsyslogTemplate {
                name: String::new(),
                template_type: String::new(),
                content: line.to_string(),
            });
        } else if line.starts_with("$") {
            if let Some((k, v)) = line[1..].split_once(' ') {
                global.insert(k.trim().to_string(), v.trim().to_string());
            }
        } else if line.contains('.') && !line.starts_with("&") {
            if let Some(rule) = parse_rule_line(line) {
                rules.push(rule);
            }
        }
    }

    Ok(RsyslogConfig {
        version: None,
        modules,
        global_directives: global,
        rules,
        templates,
    })
}

fn parse_rule_line(line: &str) -> Option<RsyslogRule> {
    let parts: Vec<&str> = line.splitn(2, char::is_whitespace).collect();
    if parts.len() < 2 {
        return None;
    }
    let selector = parts[0];
    let action = parts[1].trim().to_string();
    let (fac_str, sev_str) = selector.split_once('.')?;

    let facility = match fac_str {
        "kern" => SyslogFacility::Kern,
        "user" => SyslogFacility::User,
        "mail" => SyslogFacility::Mail,
        "daemon" => SyslogFacility::Daemon,
        "auth" => SyslogFacility::Auth,
        "syslog" => SyslogFacility::Syslog,
        "cron" => SyslogFacility::Cron,
        "authpriv" => SyslogFacility::Authpriv,
        "*" => SyslogFacility::Any,
        _ => SyslogFacility::User,
    };
    let severity = match sev_str {
        "emerg" => SyslogSeverity::Emergency,
        "alert" => SyslogSeverity::Alert,
        "crit" => SyslogSeverity::Critical,
        "err" | "error" => SyslogSeverity::Error,
        "warning" | "warn" => SyslogSeverity::Warning,
        "notice" => SyslogSeverity::Notice,
        "info" => SyslogSeverity::Info,
        "debug" => SyslogSeverity::Debug,
        "*" => SyslogSeverity::Any,
        _ => SyslogSeverity::Info,
    };

    Some(RsyslogRule {
        facility,
        severity,
        action,
        template: None,
        raw_line: line.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_parse_rule() {
        let r = parse_rule_line("auth.* /var/log/auth.log").unwrap();
        assert_eq!(r.facility, SyslogFacility::Auth);
        assert_eq!(r.severity, SyslogSeverity::Any);
        assert_eq!(r.action, "/var/log/auth.log");
    }
    #[test]
    fn test_parse_config() {
        let conf =
            "# comment\n$ModLoad imuxsock\nauth.* /var/log/auth.log\n*.err /var/log/errors\n";
        let cfg = parse_rsyslog_conf(conf).unwrap();
        assert_eq!(cfg.modules.len(), 1);
        assert_eq!(cfg.rules.len(), 2);
    }
}
