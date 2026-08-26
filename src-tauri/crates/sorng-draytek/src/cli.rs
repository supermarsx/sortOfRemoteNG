//! DrayOS CLI helpers: pure command-string builders and output parsers.
//! Execution is delegated to `sorng-ssh` / `sorng-telnet` at the command
//! layer; this crate never opens a shell itself.

use crate::types::{DraytekCliVerb, DraytekCliVersion, WanStatus};
use regex::Regex;
use std::sync::OnceLock;

pub const SYS_VERSION: &str = "sys version";
pub const WAN_STATUS: &str = "wan status";
pub const SYS_REBOOT: &str = "sys reboot";

/// Build the command string for a whitelisted verb.
pub fn command_for(verb: DraytekCliVerb) -> &'static str {
    match verb {
        DraytekCliVerb::SysVersion => SYS_VERSION,
        DraytekCliVerb::WanStatus => WAN_STATUS,
        DraytekCliVerb::SysReboot => SYS_REBOOT,
    }
}

pub fn sys_version_command() -> &'static str {
    SYS_VERSION
}

pub fn wan_status_command() -> &'static str {
    WAN_STATUS
}

pub fn reboot_command() -> &'static str {
    SYS_REBOOT
}

/// Resolve a user-supplied verb name (`"sys version"`, `"sys_version"`, …)
/// to the whitelist. Unknown strings are rejected — never pass through.
pub fn parse_verb(raw: &str) -> Option<DraytekCliVerb> {
    let normalised = raw.trim().to_ascii_lowercase().replace(['_', '-'], " ");
    let normalised = normalised.split_whitespace().collect::<Vec<_>>().join(" ");
    match normalised.as_str() {
        "sys version" | "version" => Some(DraytekCliVerb::SysVersion),
        "wan status" | "show wan" => Some(DraytekCliVerb::WanStatus),
        "sys reboot" | "reboot" => Some(DraytekCliVerb::SysReboot),
        _ => None,
    }
}

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("static regex"))
}

fn clean(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_matches(|c| c == ':' || c == ',').trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Parse `sys version` output, e.g.
///
/// ```text
/// Router Model: Vigor2862  Version: 3.9.7.1  English
/// Profile version: 4.0  Status: 1 (0x1a3f)
/// Router IP: 192.168.1.1  Netmask: 255.255.255.0
/// Firmware Build Date/Time: Feb 17 2022 12:21:04
/// ```
pub fn parse_sys_version(output: &str) -> DraytekCliVersion {
    static MODEL: OnceLock<Regex> = OnceLock::new();
    static VERSION: OnceLock<Regex> = OnceLock::new();
    static BUILD: OnceLock<Regex> = OnceLock::new();
    let model = re(
        &MODEL,
        r"(?im)(?:Router\s+)?Model(?:\s*Name)?\s*[:=]\s*([A-Za-z0-9][A-Za-z0-9\-\+ ]*?)\s*(?:$|\s{2,}|\t|Version|Firmware)",
    );
    let version = re(
        &VERSION,
        r"(?im)(?:Firmware\s+)?Version\s*[:=]\s*v?([0-9][0-9A-Za-z\._]*)",
    );
    let build = re(
        &BUILD,
        r"(?im)Build\s*(?:Date(?:\s*/?\s*Time)?)?\s*[:=]\s*(.+?)\s*$",
    );
    DraytekCliVersion {
        model: model
            .captures(output)
            .and_then(|c| clean(c.get(1)?.as_str())),
        firmware: version
            .captures(output)
            .and_then(|c| clean(c.get(1)?.as_str())),
        build: build
            .captures(output)
            .and_then(|c| clean(c.get(1)?.as_str())),
    }
}

/// Parse `wan status` / `show wan` output. Tolerant: each line mentioning a
/// `WANn` name starts a record; state / IP / gateway / mode / uptime are
/// filled from that line and any following indented continuation lines.
pub fn parse_wan_status(output: &str) -> Vec<WanStatus> {
    static NAME: OnceLock<Regex> = OnceLock::new();
    static STATE: OnceLock<Regex> = OnceLock::new();
    static IP: OnceLock<Regex> = OnceLock::new();
    static GATEWAY: OnceLock<Regex> = OnceLock::new();
    static MODE: OnceLock<Regex> = OnceLock::new();
    static UPTIME: OnceLock<Regex> = OnceLock::new();
    let name_re = re(&NAME, r"(?i)\b(WAN\s?\d+(?:\.\d+)?)\b");
    let state_re = re(
        &STATE,
        r"(?i)\b(?:Status|State|Link)\s*[:=]?\s*(Up|Down|Connected|Disconnected|Idle|Online|Offline|Connecting)\b|\b(Up|Down|Connected|Disconnected|Idle|Online|Offline)\b",
    );
    let ip_re = re(
        &IP,
        r"(?i)\bIP(?:\s*Address)?\s*[:=]?\s*((?:\d{1,3}\.){3}\d{1,3})",
    );
    let gateway_re = re(
        &GATEWAY,
        r"(?i)\b(?:Gateway|GW)(?:\s*IP)?\s*[:=]?\s*((?:\d{1,3}\.){3}\d{1,3})",
    );
    let mode_re = re(
        &MODE,
        r"(?i)\b(?:Mode|Access\s*Mode|Type)\s*[:=]?\s*(PPPoE|DHCP|Static(?:\s*IP)?|PPTP|L2TP|3G/4G|LTE|USB|Bridge)",
    );
    let uptime_re = re(
        &UPTIME,
        r"(?i)\bUp\s*Time\s*[:=]?\s*([0-9][0-9:dhms ]*?)(?:\s{2,}|$)",
    );

    let mut result: Vec<WanStatus> = Vec::new();
    for raw in output.lines() {
        let line = raw.trim_end();
        if line.trim().is_empty() {
            continue;
        }
        if let Some(cap) = name_re.captures(line) {
            let name = cap[1].to_ascii_uppercase().replace(' ', "");
            let existing = result.iter().position(|w| w.name == name);
            if existing.is_none() {
                result.push(WanStatus {
                    name,
                    ..WanStatus::default()
                });
            }
            let current = result.last_mut().expect("just pushed");
            fill(
                current, line, state_re, ip_re, gateway_re, mode_re, uptime_re,
            );
        } else if let Some(current) = result.last_mut() {
            // Continuation line for the most recent WAN record.
            fill(
                current, line, state_re, ip_re, gateway_re, mode_re, uptime_re,
            );
        }
    }
    result
}

#[allow(clippy::too_many_arguments)]
fn fill(
    wan: &mut WanStatus,
    line: &str,
    state_re: &Regex,
    ip_re: &Regex,
    gateway_re: &Regex,
    mode_re: &Regex,
    uptime_re: &Regex,
) {
    if wan.gateway.is_none() {
        if let Some(c) = gateway_re.captures(line) {
            wan.gateway = Some(c[1].to_string());
        }
    }
    if wan.ip.is_none() {
        // Strip the gateway token first so "Gateway IP: x" is not mistaken for the WAN IP.
        let without_gateway = gateway_re.replace_all(line, "");
        if let Some(c) = ip_re.captures(&without_gateway) {
            wan.ip = Some(c[1].to_string());
        }
    }
    if wan.state.is_none() {
        // Ignore the "Up Time" phrase when deciding link state.
        let without_uptime = uptime_re.replace_all(line, "");
        if let Some(c) = state_re.captures(&without_uptime) {
            let value = c.get(1).or_else(|| c.get(2)).map(|m| m.as_str());
            if let Some(value) = value {
                wan.state = Some(capitalise(value));
            }
        }
    }
    if wan.mode.is_none() {
        if let Some(c) = mode_re.captures(line) {
            wan.mode = Some(c[1].to_string());
        }
    }
    if wan.uptime.is_none() {
        if let Some(c) = uptime_re.captures(line) {
            wan.uptime = clean(&c[1]);
        }
    }
    // Positional fallback for unlabeled table rows: "WAN1 Up 1.2.3.4 1.2.3.1".
    if wan.ip.is_none() || wan.gateway.is_none() {
        static IPV4: OnceLock<Regex> = OnceLock::new();
        let ipv4 = re(&IPV4, r"\b((?:\d{1,3}\.){3}\d{1,3})\b");
        let ips: Vec<&str> = ipv4.find_iter(line).map(|m| m.as_str()).collect();
        if wan.ip.is_none() {
            wan.ip = ips.first().map(|s| s.to_string());
        }
        if wan.gateway.is_none() {
            if let Some(second) = ips.get(1) {
                if Some(*second) != wan.ip.as_deref() {
                    wan.gateway = Some(second.to_string());
                }
            }
        }
    }
}

fn capitalise(value: &str) -> String {
    let lower = value.to_ascii_lowercase();
    let mut chars = lower.chars();
    match chars.next() {
        Some(first) => first.to_ascii_uppercase().to_string() + chars.as_str(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verbs_map_to_whitelisted_commands() {
        assert_eq!(command_for(DraytekCliVerb::SysVersion), "sys version");
        assert_eq!(command_for(DraytekCliVerb::WanStatus), "wan status");
        assert_eq!(command_for(DraytekCliVerb::SysReboot), "sys reboot");
        assert_eq!(parse_verb("SYS_VERSION"), Some(DraytekCliVerb::SysVersion));
        assert_eq!(parse_verb("show wan"), Some(DraytekCliVerb::WanStatus));
        assert_eq!(parse_verb("rm -rf /"), None);
    }

    #[test]
    fn sys_version_parses_model_firmware_and_build() {
        let out = "Router Model: Vigor2862  Version: 3.9.7.1  English\r\nProfile version: 4.0  Status: 1 (0x1a3f)\r\nRouter IP: 192.168.1.1  Netmask: 255.255.255.0\r\nFirmware Build Date/Time: Feb 17 2022 12:21:04\r\n";
        let parsed = parse_sys_version(out);
        assert_eq!(parsed.model.as_deref(), Some("Vigor2862"));
        assert_eq!(parsed.firmware.as_deref(), Some("3.9.7.1"));
        assert_eq!(parsed.build.as_deref(), Some("Feb 17 2022 12:21:04"));
    }

    #[test]
    fn sys_version_tolerates_missing_fields() {
        let parsed = parse_sys_version("garbage output");
        assert_eq!(parsed, DraytekCliVersion::default());
    }

    #[test]
    fn wan_status_parses_multiple_wans() {
        let out = "WAN1: Online, stall=N\r\n Mode: PPPoE, Up Time=02:13:44\r\n IP=203.0.113.5, GW IP=203.0.113.1\r\nWAN2: Offline, stall=N\r\n Mode: DHCP, Up Time=00:00:00\r\n IP=---, GW IP=---\r\n";
        let wans = parse_wan_status(out);
        assert_eq!(wans.len(), 2);
        assert_eq!(wans[0].name, "WAN1");
        assert_eq!(wans[0].state.as_deref(), Some("Online"));
        assert!(wans[0].is_up());
        assert_eq!(wans[0].ip.as_deref(), Some("203.0.113.5"));
        assert_eq!(wans[0].gateway.as_deref(), Some("203.0.113.1"));
        assert_eq!(wans[0].mode.as_deref(), Some("PPPoE"));
        assert_eq!(wans[0].uptime.as_deref(), Some("02:13:44"));
        assert_eq!(wans[1].name, "WAN2");
        assert_eq!(wans[1].state.as_deref(), Some("Offline"));
        assert!(!wans[1].is_up());
        assert_eq!(wans[1].ip, None);
        assert_eq!(wans[1].mode.as_deref(), Some("DHCP"));
    }

    #[test]
    fn wan_status_single_line_table_form() {
        let out = "Interface  Status  IP Address      Gateway\nWAN1       Up      198.51.100.10   198.51.100.1\nWAN2       Down    ---             ---\n";
        let wans = parse_wan_status(out);
        assert_eq!(wans.len(), 2);
        assert_eq!(wans[0].state.as_deref(), Some("Up"));
        assert_eq!(wans[0].ip.as_deref(), Some("198.51.100.10"));
        assert_eq!(wans[1].state.as_deref(), Some("Down"));
    }
}
