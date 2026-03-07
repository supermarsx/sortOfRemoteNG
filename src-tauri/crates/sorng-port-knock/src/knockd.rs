use crate::error::PortKnockError;
use crate::types::{KnockProtocol, KnockSequence, KnockStep, KnockdConfig, KnockdSection};

/// A parsed knockd log entry.
#[derive(Debug, Clone)]
pub struct KnockdLogEntry {
    pub timestamp: String,
    pub source_ip: String,
    pub sequence_name: String,
    pub stage: String,
    pub message: String,
}

/// knockd (knock daemon) configuration management.
pub struct KnockdManager;

impl KnockdManager {
    pub fn new() -> Self {
        Self
    }

    /// Parses knockd.conf format (INI-like with [options] and [sectionName] sections).
    pub fn parse_config(content: &str) -> Result<KnockdConfig, PortKnockError> {
        let mut use_syslog = false;
        let mut log_file: Option<String> = None;
        let mut pid_file = "/var/run/knockd.pid".to_string();
        let mut interface = "eth0".to_string();
        let mut sections: Vec<KnockdSection> = Vec::new();

        let mut current_section: Option<String> = None;
        let mut section_map: std::collections::HashMap<String, std::collections::HashMap<String, String>> =
            std::collections::HashMap::new();

        for (line_idx, raw_line) in content.lines().enumerate() {
            let line = raw_line.trim();

            // Skip empty lines and comments
            if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
                continue;
            }

            // Section header
            if line.starts_with('[') && line.ends_with(']') {
                let name = line[1..line.len() - 1].trim().to_string();
                current_section = Some(name.clone());
                section_map.entry(name).or_default();
                continue;
            }

            // Key = Value or Key: Value
            let (key, value) = if let Some(eq_pos) = line.find('=') {
                (
                    line[..eq_pos].trim().to_string(),
                    line[eq_pos + 1..].trim().to_string(),
                )
            } else {
                return Err(PortKnockError::KnockdParseError {
                    line: line_idx + 1,
                    message: format!("Expected key = value, got: {}", line),
                });
            };

            match &current_section {
                Some(sec) => {
                    section_map
                        .entry(sec.clone())
                        .or_default()
                        .insert(key.to_lowercase(), value);
                }
                None => {
                    return Err(PortKnockError::KnockdParseError {
                        line: line_idx + 1,
                        message: "Key-value pair outside of any section".to_string(),
                    });
                }
            }
        }

        // Process [options] section
        if let Some(opts) = section_map.remove("options") {
            if let Some(v) = opts.get("usesyslog") {
                use_syslog = v.trim() == "1" || v.eq_ignore_ascii_case("yes") || v.eq_ignore_ascii_case("true");
            }
            if let Some(v) = opts.get("logfile") {
                log_file = Some(v.clone());
            }
            if let Some(v) = opts.get("pidfile") {
                pid_file = v.clone();
            }
            if let Some(v) = opts.get("interface") {
                interface = v.clone();
            }
        }

        // Process named sections
        for (name, map) in &section_map {
            let sequence_str = map.get("sequence").ok_or_else(|| {
                PortKnockError::KnockdConfigError(format!(
                    "Section [{}] missing Sequence field",
                    name
                ))
            })?;

            let steps = parse_knockd_sequence(sequence_str)?;

            let seq_timeout = map
                .get("seq_timeout")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(15);

            let tcpflags = map.get("tcpflags").cloned();

            let start_command = map.get("start_command").cloned().ok_or_else(|| {
                PortKnockError::KnockdConfigError(format!(
                    "Section [{}] missing Start_Command field",
                    name
                ))
            })?;

            let stop_command = map.get("stop_command").cloned();

            let cmd_timeout = map
                .get("cmd_timeout")
                .and_then(|v| v.parse::<u32>().ok())
                .unwrap_or(10);

            let one_time = map
                .get("one_time_sequences")
                .map(|v| !v.is_empty())
                .unwrap_or(false);

            let iface = map.get("interface").cloned();

            sections.push(KnockdSection {
                name: name.clone(),
                sequence: steps,
                seq_timeout,
                tcpflags,
                start_command,
                stop_command,
                cmd_timeout,
                one_time,
                interface: iface,
            });
        }

        Ok(KnockdConfig {
            use_syslog,
            log_file,
            pid_file,
            interface,
            sections,
        })
    }

    /// Generates knockd.conf content from struct.
    pub fn generate_config(config: &KnockdConfig) -> String {
        let mut out = String::new();

        // [options]
        out.push_str("[options]\n");
        if config.use_syslog {
            out.push_str("    UseSyslog\n");
        }
        if let Some(ref lf) = config.log_file {
            out.push_str(&format!("    LogFile = {}\n", lf));
        }
        out.push_str(&format!("    PidFile = {}\n", config.pid_file));
        out.push_str(&format!("    Interface = {}\n", config.interface));
        out.push('\n');

        // Named sections
        for section in &config.sections {
            out.push_str(&format!("[{}]\n", section.name));

            let seq_str: Vec<String> = section
                .sequence
                .iter()
                .map(|s| {
                    let proto = match s.protocol {
                        KnockProtocol::Tcp => "tcp",
                        KnockProtocol::Udp => "udp",
                    };
                    format!("{}:{}", s.port, proto)
                })
                .collect();
            out.push_str(&format!("    Sequence      = {}\n", seq_str.join(",")));
            out.push_str(&format!("    Seq_Timeout   = {}\n", section.seq_timeout));

            if let Some(ref flags) = section.tcpflags {
                out.push_str(&format!("    TCPFlags      = {}\n", flags));
            }

            out.push_str(&format!("    Start_Command = {}\n", section.start_command));

            if let Some(ref stop) = section.stop_command {
                out.push_str(&format!("    Stop_Command  = {}\n", stop));
            }

            out.push_str(&format!("    Cmd_Timeout   = {}\n", section.cmd_timeout));

            if section.one_time {
                out.push_str("    One_Time_Sequences = /etc/knockd/one_time_sequences\n");
            }

            if let Some(ref iface) = section.interface {
                out.push_str(&format!("    Interface     = {}\n", iface));
            }

            out.push('\n');
        }

        out
    }

    /// Creates a new knockd section from the given parameters.
    pub fn create_section(
        name: &str,
        sequence: &KnockSequence,
        open_command: &str,
        close_command: Option<&str>,
        timeout: u32,
    ) -> KnockdSection {
        KnockdSection {
            name: name.to_string(),
            sequence: sequence.steps.clone(),
            seq_timeout: timeout,
            tcpflags: Some("syn".to_string()),
            start_command: open_command.to_string(),
            stop_command: close_command.map(|s| s.to_string()),
            cmd_timeout: 10,
            one_time: false,
            interface: None,
        }
    }

    /// Validates all fields in a KnockdConfig.
    pub fn validate_config(config: &KnockdConfig) -> Result<(), PortKnockError> {
        if config.interface.is_empty() {
            return Err(PortKnockError::KnockdConfigError(
                "Interface must not be empty".to_string(),
            ));
        }

        if config.pid_file.is_empty() {
            return Err(PortKnockError::KnockdConfigError(
                "PidFile must not be empty".to_string(),
            ));
        }

        if config.sections.is_empty() {
            return Err(PortKnockError::KnockdConfigError(
                "At least one knock section is required".to_string(),
            ));
        }

        for section in &config.sections {
            if section.name.is_empty() {
                return Err(PortKnockError::KnockdConfigError(
                    "Section name must not be empty".to_string(),
                ));
            }

            if section.sequence.is_empty() {
                return Err(PortKnockError::KnockdConfigError(format!(
                    "Section [{}] must have at least one knock step",
                    section.name
                )));
            }

            for step in &section.sequence {
                if step.port == 0 {
                    return Err(PortKnockError::KnockdConfigError(format!(
                        "Section [{}] has invalid port 0",
                        section.name
                    )));
                }
            }

            if section.start_command.is_empty() {
                return Err(PortKnockError::KnockdConfigError(format!(
                    "Section [{}] missing Start_Command",
                    section.name
                )));
            }

            if section.seq_timeout == 0 {
                return Err(PortKnockError::KnockdConfigError(format!(
                    "Section [{}] seq_timeout must be > 0",
                    section.name
                )));
            }
        }

        Ok(())
    }

    /// Returns the command to check knockd service status.
    pub fn get_status_command() -> String {
        "systemctl status knockd 2>/dev/null || service knockd status".to_string()
    }

    /// Returns the command to start knockd.
    pub fn get_start_command() -> String {
        "systemctl start knockd 2>/dev/null || service knockd start".to_string()
    }

    /// Returns the command to stop knockd.
    pub fn get_stop_command() -> String {
        "systemctl stop knockd 2>/dev/null || service knockd stop".to_string()
    }

    /// Returns the command to restart knockd.
    pub fn get_restart_command() -> String {
        "systemctl restart knockd 2>/dev/null || service knockd restart".to_string()
    }

    /// Returns the default knockd config path.
    pub fn get_config_path() -> &'static str {
        "/etc/knockd.conf"
    }

    /// Returns a command to tail knockd log.
    pub fn get_log_command(lines: u32) -> String {
        format!(
            "journalctl -u knockd -n {} --no-pager 2>/dev/null || tail -n {} /var/log/knockd.log",
            lines, lines
        )
    }

    /// Parses a knockd log line into a structured entry.
    ///
    /// Expected format examples:
    /// ```text
    /// [2025-01-15 10:30:45] 192.168.1.100: openSSH: Stage 1
    /// [2025-01-15 10:30:46] 192.168.1.100: openSSH: Stage 2
    /// [2025-01-15 10:30:47] 192.168.1.100: openSSH: OPEN SESAME
    /// ```
    pub fn parse_log_line(line: &str) -> Option<KnockdLogEntry> {
        let trimmed = line.trim();

        // Try bracketed timestamp format: [YYYY-MM-DD HH:MM:SS]
        if trimmed.starts_with('[') {
            let close_bracket = trimmed.find(']')?;
            let timestamp = trimmed[1..close_bracket].to_string();
            let rest = trimmed[close_bracket + 1..].trim();

            // rest: "192.168.1.100: openSSH: Stage 1"
            let colon_pos = rest.find(':')?;
            let source_ip = rest[..colon_pos].trim().to_string();
            let after_ip = rest[colon_pos + 1..].trim();

            let second_colon = after_ip.find(':')?;
            let sequence_name = after_ip[..second_colon].trim().to_string();
            let message = after_ip[second_colon + 1..].trim().to_string();

            let stage = if message.to_lowercase().contains("stage") {
                message.clone()
            } else if message.to_lowercase().contains("open") {
                "COMPLETE".to_string()
            } else {
                message.clone()
            };

            return Some(KnockdLogEntry {
                timestamp,
                source_ip,
                sequence_name,
                stage,
                message,
            });
        }

        // Try syslog format: "Mon DD HH:MM:SS hostname knockd[pid]: ..."
        // Example: "Jan 15 10:30:45 myhost knockd[1234]: 192.168.1.100: openSSH: Stage 1"
        if let Some(knockd_pos) = trimmed.find("knockd[") {
            // Timestamp is everything before "hostname"
            let parts_before: Vec<&str> = trimmed[..knockd_pos].split_whitespace().collect();
            let timestamp = if parts_before.len() >= 3 {
                parts_before[..3].join(" ")
            } else {
                trimmed[..knockd_pos].trim().to_string()
            };

            // Find the message after "knockd[pid]: "
            let after_knockd = &trimmed[knockd_pos..];
            let msg_start = after_knockd.find("]: ")?;
            let msg = after_knockd[msg_start + 3..].trim();

            let colon_pos = msg.find(':')?;
            let source_ip = msg[..colon_pos].trim().to_string();
            let after_ip = msg[colon_pos + 1..].trim();

            let (sequence_name, message) = if let Some(pos) = after_ip.find(':') {
                (
                    after_ip[..pos].trim().to_string(),
                    after_ip[pos + 1..].trim().to_string(),
                )
            } else {
                (String::new(), after_ip.to_string())
            };

            let stage = if message.to_lowercase().contains("stage") {
                message.clone()
            } else {
                message.clone()
            };

            return Some(KnockdLogEntry {
                timestamp,
                source_ip,
                sequence_name,
                stage,
                message,
            });
        }

        None
    }

    /// Returns the package install command for knockd on a given distro.
    pub fn install_command(distro: &str) -> String {
        match distro.to_lowercase().as_str() {
            "debian" | "ubuntu" | "mint" | "pop" => {
                "apt-get install -y knockd".to_string()
            }
            "rhel" | "centos" | "rocky" | "alma" | "fedora" => {
                "dnf install -y knock-server 2>/dev/null || yum install -y knock-server".to_string()
            }
            "arch" | "manjaro" => {
                "pacman -S --noconfirm knock".to_string()
            }
            "suse" | "opensuse" => {
                "zypper install -y knockd".to_string()
            }
            "alpine" => {
                "apk add knock".to_string()
            }
            "gentoo" => {
                "emerge net-misc/knock".to_string()
            }
            _ => {
                format!(
                    "echo 'Unknown distro: {}. Try: apt-get install knockd / dnf install knock-server / pacman -S knock'",
                    distro
                )
            }
        }
    }
}

/// Parses a knockd sequence string like "7000:tcp,8000:udp,9000:tcp" into KnockStep vec.
fn parse_knockd_sequence(seq_str: &str) -> Result<Vec<KnockStep>, PortKnockError> {
    let mut steps = Vec::new();

    for part in seq_str.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }

        let (port_str, protocol) = if let Some(colon) = part.find(':') {
            let p = part[..colon].trim();
            let proto_str = part[colon + 1..].trim().to_lowercase();
            let proto = match proto_str.as_str() {
                "tcp" => KnockProtocol::Tcp,
                "udp" => KnockProtocol::Udp,
                other => {
                    return Err(PortKnockError::KnockdConfigError(format!(
                        "Invalid protocol '{}' in sequence",
                        other
                    )));
                }
            };
            (p, proto)
        } else {
            // Default to TCP if no protocol specified
            (part, KnockProtocol::Tcp)
        };

        let port: u16 = port_str.parse().map_err(|_| {
            PortKnockError::KnockdConfigError(format!("Invalid port '{}' in sequence", port_str))
        })?;

        steps.push(KnockStep {
            port,
            protocol,
            payload: None,
            delay_after_ms: 0,
        });
    }

    if steps.is_empty() {
        return Err(PortKnockError::KnockdConfigError(
            "Empty sequence".to_string(),
        ));
    }

    Ok(steps)
}
