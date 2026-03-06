//! Unit file management — read, create, validate unit files.

use crate::client;
use crate::error::SystemdError;
use crate::types::*;

/// Read a unit file's content.
pub async fn read_unit_file(host: &SystemdHost, unit: &str) -> Result<UnitFileContent, SystemdError> {
    let stdout = client::exec_ok(host, "systemctl", &["cat", unit, "--no-pager"]).await?;
    parse_unit_file(&stdout, unit)
}

/// Write a new unit file.
pub async fn write_unit_file(host: &SystemdHost, path: &str, content: &str) -> Result<(), SystemdError> {
    let escaped = content.replace('\'', "'\\''");
    client::exec_ok(host, "sh", &["-c", &format!("printf '%s' '{escaped}' > {path}")]).await?;
    Ok(())
}

fn parse_unit_file(content: &str, _unit: &str) -> Result<UnitFileContent, SystemdError> {
    let mut sections = Vec::new();
    let mut current_section: Option<(String, Vec<UnitFileDirective>)> = None;

    for line in content.lines() {
        let line = line.trim();
        if line.starts_with('#') && line.contains('/') {
            // File header comment from systemctl cat
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            if let Some((name, directives)) = current_section.take() {
                sections.push(UnitFileSection { name, directives });
            }
            current_section = Some((line[1..line.len()-1].to_string(), Vec::new()));
        } else if let Some((_, ref mut directives)) = current_section {
            if let Some((key, value)) = line.split_once('=') {
                directives.push(UnitFileDirective {
                    key: key.trim().to_string(),
                    value: value.trim().to_string(),
                });
            }
        }
    }

    if let Some((name, directives)) = current_section {
        sections.push(UnitFileSection { name, directives });
    }

    Ok(UnitFileContent { path: String::new(), sections })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_unit_file() {
        let content = "[Unit]\nDescription=My Service\nAfter=network.target\n\n[Service]\nExecStart=/usr/bin/myapp\nRestart=always\n\n[Install]\nWantedBy=multi-user.target\n";
        let uf = parse_unit_file(content, "myapp.service").unwrap();
        assert_eq!(uf.sections.len(), 3);
        assert_eq!(uf.sections[0].name, "Unit");
        assert_eq!(uf.sections[0].directives[0].key, "Description");
        assert_eq!(uf.sections[1].name, "Service");
        assert_eq!(uf.sections[2].name, "Install");
    }
}
