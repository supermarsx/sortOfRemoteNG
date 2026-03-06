//! Logrotate configuration management.
use crate::client;
use crate::error::SyslogError;
use crate::types::*;

pub async fn list_configs(host: &SyslogHost) -> Result<Vec<String>, SyslogError> {
    let stdout = client::exec_ok(host, "ls", &["-1", "/etc/logrotate.d/"]).await?;
    Ok(stdout.lines().filter(|l| !l.trim().is_empty()).map(|l| l.trim().to_string()).collect())
}

pub async fn get_file_config(host: &SyslogHost, name: &str) -> Result<Vec<LogrotateFileConfig>, SyslogError> {
    let path = format!("/etc/logrotate.d/{name}");
    let content = client::read_file(host, &path).await?;
    Ok(parse_logrotate_file(&content))
}

pub async fn force_rotate(host: &SyslogHost, config_path: Option<&str>) -> Result<(), SyslogError> {
    let path = config_path.unwrap_or("/etc/logrotate.conf");
    client::exec_ok(host, "logrotate", &["-f", path]).await?;
    Ok(())
}

pub fn parse_logrotate_file(content: &str) -> Vec<LogrotateFileConfig> {
    let mut configs = Vec::new();
    let mut current_path: Option<String> = None;
    let mut in_block = false;
    let mut cfg = default_file_config("");
    let mut postrotate = false;
    let mut post_script = String::new();

    for line in content.lines() {
        let line = line.trim();
        if postrotate {
            if line == "endscript" {
                cfg.postrotate = Some(post_script.trim().to_string());
                post_script.clear();
                postrotate = false;
            } else {
                post_script.push_str(line);
                post_script.push('\n');
            }
            continue;
        }
        if line.is_empty() || line.starts_with('#') { continue; }
        if line.ends_with('{') {
            let path = line.trim_end_matches('{').trim().to_string();
            current_path = Some(path.clone());
            cfg = default_file_config(&path);
            in_block = true;
        } else if line == "}" {
            if let Some(ref p) = current_path {
                cfg.path = p.clone();
                configs.push(cfg.clone());
            }
            in_block = false;
            current_path = None;
        } else if in_block {
            apply_directive(&mut cfg, line);
            if line == "postrotate" { postrotate = true; }
        }
    }
    configs
}

fn default_file_config(path: &str) -> LogrotateFileConfig {
    LogrotateFileConfig {
        path: path.to_string(), frequency: None, rotate_count: None,
        compress: None, delay_compress: None, missing_ok: false,
        not_if_empty: false, create: None, postrotate: None, prerotate: None,
        max_size: None, min_size: None, max_age: None,
        copy_truncate: false, date_ext: false, shared_scripts: false,
    }
}

fn apply_directive(cfg: &mut LogrotateFileConfig, line: &str) {
    let parts: Vec<&str> = line.splitn(2, char::is_whitespace).collect();
    match parts[0] {
        "daily" => cfg.frequency = Some(LogrotateFrequency::Daily),
        "weekly" => cfg.frequency = Some(LogrotateFrequency::Weekly),
        "monthly" => cfg.frequency = Some(LogrotateFrequency::Monthly),
        "yearly" => cfg.frequency = Some(LogrotateFrequency::Yearly),
        "rotate" => cfg.rotate_count = parts.get(1).and_then(|v| v.parse().ok()),
        "compress" => cfg.compress = Some(true),
        "nocompress" => cfg.compress = Some(false),
        "delaycompress" => cfg.delay_compress = Some(true),
        "missingok" => cfg.missing_ok = true,
        "notifempty" => cfg.not_if_empty = true,
        "copytruncate" => cfg.copy_truncate = true,
        "dateext" => cfg.date_ext = true,
        "sharedscripts" => cfg.shared_scripts = true,
        "create" => cfg.create = parts.get(1).map(|s| s.to_string()),
        "maxsize" => cfg.max_size = parts.get(1).map(|s| s.to_string()),
        "minsize" => cfg.min_size = parts.get(1).map(|s| s.to_string()),
        "maxage" => cfg.max_age = parts.get(1).and_then(|v| v.parse().ok()),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_parse_logrotate() {
        let content = "/var/log/syslog {\n    daily\n    rotate 7\n    compress\n    delaycompress\n    missingok\n    notifempty\n    postrotate\n        /usr/lib/rsyslog/rsyslog-rotate\n    endscript\n}\n";
        let configs = parse_logrotate_file(content);
        assert_eq!(configs.len(), 1);
        assert_eq!(configs[0].path, "/var/log/syslog");
        assert_eq!(configs[0].frequency, Some(LogrotateFrequency::Daily));
        assert_eq!(configs[0].rotate_count, Some(7));
        assert_eq!(configs[0].compress, Some(true));
        assert!(configs[0].missing_ok);
        assert!(configs[0].postrotate.is_some());
    }
}
