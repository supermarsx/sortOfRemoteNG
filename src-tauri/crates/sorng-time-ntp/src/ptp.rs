//! PTP (Precision Time Protocol) support — ptp4l/pmc status, config.
use crate::client;
use crate::error::TimeNtpError;
use crate::types::{PtpPort, PtpStatus, TimeHost};
use std::collections::HashMap;

/// Get PTP status from `pmc` or by parsing ptp4l log output.
/// Returns empty/default status if PTP is not available.
pub async fn get_ptp_status(host: &TimeHost) -> Result<PtpStatus, TimeNtpError> {
    // Try pmc (PTP management client) first
    let result = client::exec(
        host,
        "pmc",
        &["-u", "-b", "0", "GET", "CURRENT_DATA_SET"],
    )
    .await;

    match result {
        Ok((stdout, _, 0)) => parse_pmc_current_dataset(&stdout),
        _ => {
            // Try parsing ptp4l status from systemd journal
            let result = client::exec(
                host,
                "journalctl",
                &["-u", "ptp4l", "-n", "20", "--no-pager", "-o", "cat"],
            )
            .await;
            match result {
                Ok((stdout, _, 0)) => parse_ptp4l_journal(&stdout),
                _ => Ok(PtpStatus {
                    clock_id: String::new(),
                    port_state: "unavailable".into(),
                    master_offset_ns: 0.0,
                    path_delay_ns: 0.0,
                }),
            }
        }
    }
}

/// List PTP ports from `pmc GET PORT_DATA_SET`.
pub async fn list_ptp_ports(host: &TimeHost) -> Result<Vec<PtpPort>, TimeNtpError> {
    let (stdout, _, code) = client::exec(
        host,
        "pmc",
        &["-u", "-b", "0", "GET", "PORT_DATA_SET"],
    )
    .await?;

    if code != 0 {
        return Ok(Vec::new());
    }
    parse_pmc_port_dataset(&stdout)
}

/// Read PTP configuration from /etc/ptp4l.conf.
pub async fn get_ptp_config(host: &TimeHost) -> Result<HashMap<String, String>, TimeNtpError> {
    let content = client::read_file(host, "/etc/ptp4l.conf").await?;
    parse_ptp_config(&content)
}

// ─── Parsing helpers ────────────────────────────────────────────────

/// Parse `pmc GET CURRENT_DATA_SET` output.
///
/// Example:
/// ```text
///   stepsRemoved     0
///   offsetFromMaster 123.0
///   meanPathDelay    456.0
/// ```
fn parse_pmc_current_dataset(output: &str) -> Result<PtpStatus, TimeNtpError> {
    let mut clock_id = String::new();
    let mut port_state = String::from("unknown");
    let mut master_offset_ns = 0.0;
    let mut path_delay_ns = 0.0;

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() { continue; }

        if let Some((key, val)) = split_pmc_kv(line) {
            match key {
                "clockIdentity" | "clockID" => clock_id = val.to_string(),
                "portState" => port_state = val.to_string(),
                "offsetFromMaster" => master_offset_ns = val.parse().unwrap_or(0.0),
                "meanPathDelay" => path_delay_ns = val.parse().unwrap_or(0.0),
                _ => {}
            }
        }
    }

    Ok(PtpStatus { clock_id, port_state, master_offset_ns, path_delay_ns })
}

/// Parse recent ptp4l journal lines for offset/delay.
///
/// Example line: "ptp4l[1234.567]: master offset        123 s2 freq   -456 path delay       789"
fn parse_ptp4l_journal(output: &str) -> Result<PtpStatus, TimeNtpError> {
    let mut master_offset_ns = 0.0;
    let mut path_delay_ns = 0.0;
    let mut port_state = String::from("unknown");

    for line in output.lines().rev() {
        let line = line.trim();
        if line.contains("master offset") {
            // Extract offset and path delay from the log line
            let parts: Vec<&str> = line.split_whitespace().collect();
            for (i, part) in parts.iter().enumerate() {
                if *part == "offset" {
                    if let Some(val) = parts.get(i + 1) {
                        master_offset_ns = val.parse().unwrap_or(0.0);
                    }
                }
                if *part == "delay" {
                    if let Some(val) = parts.get(i + 1) {
                        path_delay_ns = val.parse().unwrap_or(0.0);
                    }
                }
            }
            // State from s0/s1/s2
            if line.contains(" s2 ") {
                port_state = "SLAVE".into();
            } else if line.contains(" s1 ") {
                port_state = "MASTER".into();
            } else if line.contains(" s0 ") {
                port_state = "INITIALIZING".into();
            }
            break;
        }
    }

    Ok(PtpStatus {
        clock_id: String::new(),
        port_state,
        master_offset_ns,
        path_delay_ns,
    })
}

/// Parse `pmc GET PORT_DATA_SET` output.
fn parse_pmc_port_dataset(output: &str) -> Result<Vec<PtpPort>, TimeNtpError> {
    let mut ports = Vec::new();
    let mut current_name = String::new();
    let mut current_index: u32 = 0;
    let mut current_state = String::new();
    let mut delay_mech = String::new();
    let mut peer_delay: f64 = 0.0;
    let mut in_record = false;

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            if in_record && !current_name.is_empty() {
                ports.push(PtpPort {
                    name: current_name.clone(),
                    index: current_index,
                    state: current_state.clone(),
                    delay_mechanism: delay_mech.clone(),
                    peer_delay_ns: peer_delay,
                });
                current_name.clear();
                current_state.clear();
                delay_mech.clear();
                peer_delay = 0.0;
                in_record = false;
            }
            continue;
        }

        if let Some((key, val)) = split_pmc_kv(line) {
            in_record = true;
            match key {
                "portIdentity" => {
                    // "portIdentity  ec:12:34:56:78:9a-1"
                    current_name = val.to_string();
                    if let Some(idx_str) = val.rsplit('-').next() {
                        current_index = idx_str.parse().unwrap_or(0);
                    }
                }
                "portState" => current_state = val.to_string(),
                "delayMechanism" => delay_mech = val.to_string(),
                "peerMeanPathDelay" => peer_delay = val.parse().unwrap_or(0.0),
                _ => {}
            }
        }
    }
    // Flush last record
    if in_record && !current_name.is_empty() {
        ports.push(PtpPort {
            name: current_name,
            index: current_index,
            state: current_state,
            delay_mechanism: delay_mech,
            peer_delay_ns: peer_delay,
        });
    }
    Ok(ports)
}

/// Parse ptp4l.conf (ini-style with `[global]` section).
fn parse_ptp_config(content: &str) -> Result<HashMap<String, String>, TimeNtpError> {
    let mut map = HashMap::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with('[') {
            continue;
        }
        // Key-value pairs separated by whitespace or '='
        let (k, v) = if let Some((k, v)) = line.split_once('=') {
            (k.trim(), v.trim())
        } else if let Some((k, v)) = line.split_once('\t') {
            (k.trim(), v.trim())
        } else if let Some((k, v)) = line.split_once(' ') {
            (k.trim(), v.trim())
        } else {
            continue;
        };
        map.insert(k.to_string(), v.to_string());
    }
    Ok(map)
}

/// Split a pmc key-value line like "  keyName   value" into (key, value).
fn split_pmc_kv(line: &str) -> Option<(&str, &str)> {
    let line = line.trim();
    let mut iter = line.splitn(2, char::is_whitespace);
    let key = iter.next()?.trim();
    let val = iter.next().map(|v| v.trim()).unwrap_or("");
    if key.is_empty() { None } else { Some((key, val)) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_pmc_current_dataset() {
        let output = "\
  clockIdentity     ec:12:34:ff:fe:56:78:9a
  portState         SLAVE
  offsetFromMaster  -123.456
  meanPathDelay     789.012
";
        let status = parse_pmc_current_dataset(output).unwrap();
        assert_eq!(status.clock_id, "ec:12:34:ff:fe:56:78:9a");
        assert_eq!(status.port_state, "SLAVE");
        assert!((status.master_offset_ns - (-123.456)).abs() < 0.001);
        assert!((status.path_delay_ns - 789.012).abs() < 0.001);
    }

    #[test]
    fn test_parse_ptp4l_journal() {
        let output = "\
ptp4l[1234.567]: selected local clock ec1234.fffe.56789a as best master
ptp4l[1234.789]: master offset         -5 s2 freq   -1234 path delay       345
ptp4l[1235.012]: master offset         -3 s2 freq   -1230 path delay       340
";
        let status = parse_ptp4l_journal(output).unwrap();
        assert_eq!(status.port_state, "SLAVE");
        assert!((status.master_offset_ns - (-3.0)).abs() < 0.001);
        assert!((status.path_delay_ns - 340.0).abs() < 0.001);
    }

    #[test]
    fn test_parse_ptp_config() {
        let content = "\
[global]
# Configuration for ptp4l
twoStepFlag  1
slaveOnly    1
domainNumber 0
clockClass   248
priority1    128
priority2    128
";
        let cfg = parse_ptp_config(content).unwrap();
        assert_eq!(cfg.get("twoStepFlag").unwrap(), "1");
        assert_eq!(cfg.get("slaveOnly").unwrap(), "1");
        assert_eq!(cfg.get("domainNumber").unwrap(), "0");
        assert_eq!(cfg.get("clockClass").unwrap(), "248");
    }

    #[test]
    fn test_parse_pmc_port_dataset() {
        let output = "\
  portIdentity  ec:12:34:ff:fe:56:78:9a-1
  portState     SLAVE
  delayMechanism E2E
  peerMeanPathDelay 0.0

  portIdentity  ec:12:34:ff:fe:56:78:9a-2
  portState     LISTENING
  delayMechanism E2E
  peerMeanPathDelay 0.0
";
        let ports = parse_pmc_port_dataset(output).unwrap();
        assert_eq!(ports.len(), 2);
        assert_eq!(ports[0].state, "SLAVE");
        assert_eq!(ports[0].index, 1);
        assert_eq!(ports[1].state, "LISTENING");
        assert_eq!(ports[1].index, 2);
    }

    #[test]
    fn test_empty_ptp_status() {
        let status = parse_pmc_current_dataset("").unwrap();
        assert!(status.clock_id.is_empty());
        assert_eq!(status.port_state, "unknown");
    }
}
