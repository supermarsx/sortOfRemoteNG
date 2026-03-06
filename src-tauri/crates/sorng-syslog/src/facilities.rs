//! Syslog facility/severity utility functions.
use crate::types::{SyslogFacility, SyslogSeverity};

pub fn facility_code(f: &SyslogFacility) -> u8 {
    match f {
        SyslogFacility::Kern => 0, SyslogFacility::User => 1, SyslogFacility::Mail => 2,
        SyslogFacility::Daemon => 3, SyslogFacility::Auth => 4, SyslogFacility::Syslog => 5,
        SyslogFacility::Lpr => 6, SyslogFacility::News => 7, SyslogFacility::Uucp => 8,
        SyslogFacility::Cron => 9, SyslogFacility::Authpriv => 10, SyslogFacility::Ftp => 11,
        SyslogFacility::Local0 => 16, SyslogFacility::Local1 => 17, SyslogFacility::Local2 => 18,
        SyslogFacility::Local3 => 19, SyslogFacility::Local4 => 20, SyslogFacility::Local5 => 21,
        SyslogFacility::Local6 => 22, SyslogFacility::Local7 => 23, SyslogFacility::Any => 255,
    }
}

pub fn severity_code(s: &SyslogSeverity) -> u8 {
    match s {
        SyslogSeverity::Emergency => 0, SyslogSeverity::Alert => 1, SyslogSeverity::Critical => 2,
        SyslogSeverity::Error => 3, SyslogSeverity::Warning => 4, SyslogSeverity::Notice => 5,
        SyslogSeverity::Info => 6, SyslogSeverity::Debug => 7, SyslogSeverity::Any => 255,
    }
}

pub fn priority(facility: &SyslogFacility, severity: &SyslogSeverity) -> u16 {
    (facility_code(facility) as u16) * 8 + severity_code(severity) as u16
}

pub fn facility_name(f: &SyslogFacility) -> &'static str {
    match f {
        SyslogFacility::Kern => "kern", SyslogFacility::User => "user", SyslogFacility::Mail => "mail",
        SyslogFacility::Daemon => "daemon", SyslogFacility::Auth => "auth", SyslogFacility::Syslog => "syslog",
        SyslogFacility::Lpr => "lpr", SyslogFacility::News => "news", SyslogFacility::Uucp => "uucp",
        SyslogFacility::Cron => "cron", SyslogFacility::Authpriv => "authpriv", SyslogFacility::Ftp => "ftp",
        SyslogFacility::Local0 => "local0", SyslogFacility::Local1 => "local1", SyslogFacility::Local2 => "local2",
        SyslogFacility::Local3 => "local3", SyslogFacility::Local4 => "local4", SyslogFacility::Local5 => "local5",
        SyslogFacility::Local6 => "local6", SyslogFacility::Local7 => "local7", SyslogFacility::Any => "*",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_facility_codes() { assert_eq!(facility_code(&SyslogFacility::Kern), 0); assert_eq!(facility_code(&SyslogFacility::Local7), 23); }
    #[test]
    fn test_severity_codes() { assert_eq!(severity_code(&SyslogSeverity::Emergency), 0); assert_eq!(severity_code(&SyslogSeverity::Debug), 7); }
    #[test]
    fn test_priority() { assert_eq!(priority(&SyslogFacility::Auth, &SyslogSeverity::Warning), 4 * 8 + 4); }
}
