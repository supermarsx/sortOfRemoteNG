//! Classic ntpd management — ntp.conf parsing, ntpq queries.
use crate::client;
use crate::error::TimeNtpError;
use crate::types::*;
use std::collections::HashMap;

const NTPD_CONF: &str = "/etc/ntp.conf";

// ─── Configuration ──────────────────────────────────────────────────

/// Read and parse the ntpd configuration file.
pub async fn get_ntpd_config(host: &TimeHost) -> Result<NtpdConfig, TimeNtpError> {
    let content = client::read_file(host, NTPD_CONF).await?;
    parse_ntp_conf(&content)
}

/// Write a full ntpd configuration file.
pub async fn set_ntpd_config(host: &TimeHost, config: &NtpdConfig) -> Result<(), TimeNtpError> {
    let content = serialize_ntp_conf(config);
    client::write_file(host, NTPD_CONF, &content).await?;
    let _ = client::exec(host, "systemctl", &["restart", "ntpd"]).await;
    let _ = client::exec(host, "systemctl", &["restart", "ntp"]).await;
    Ok(())
}

/// Add an NTP server entry to ntp.conf.
pub async fn add_server(host: &TimeHost, server: &NtpServerConfig) -> Result<(), TimeNtpError> {
    let mut cfg = get_ntpd_config(host).await?;
    cfg.servers.push(server.clone());
    set_ntpd_config(host, &cfg).await
}

/// Remove an NTP server entry by address.
pub async fn remove_server(host: &TimeHost, address: &str) -> Result<(), TimeNtpError> {
    let mut cfg = get_ntpd_config(host).await?;
    cfg.servers.retain(|s| s.address != address);
    set_ntpd_config(host, &cfg).await
}

// ─── ntpq queries ───────────────────────────────────────────────────

/// Get peers from `ntpq -p` output.
pub async fn get_peers(host: &TimeHost) -> Result<Vec<NtpPeer>, TimeNtpError> {
    let out = client::exec_ok(host, "ntpq", &["-pn"]).await?;
    parse_ntpq_peers(&out)
}

/// Get association list from `ntpq -c associations`.
pub async fn get_associations(host: &TimeHost) -> Result<Vec<HashMap<String, String>>, TimeNtpError> {
    let out = client::exec_ok(host, "ntpq", &["-c", "associations"]).await?;
    parse_ntpq_associations(&out)
}

/// Get system status from `ntpq -c rv`.
pub async fn get_status(host: &TimeHost) -> Result<NtpStatus, TimeNtpError> {
    let out = client::exec_ok(host, "ntpq", &["-c", "rv"]).await?;
    parse_ntpq_rv(&out)
}

/// Get kernel time parameters from `ntpq -c kerninfo`.
pub async fn get_kerninfo(host: &TimeHost) -> Result<HashMap<String, String>, TimeNtpError> {
    let out = client::exec_ok(host, "ntpq", &["-c", "kerninfo"]).await?;
    let mut map = HashMap::new();
    for line in out.lines() {
        let line = line.trim();
        if line.is_empty() { continue; }
        if let Some((k, v)) = line.split_once(':') {
            map.insert(k.trim().to_string(), v.trim().to_string());
        }
    }
    Ok(map)
}

// ─── Parsing helpers ────────────────────────────────────────────────

pub fn parse_ntp_conf(content: &str) -> Result<NtpdConfig, TimeNtpError> {
    let mut servers = Vec::new();
    let mut restrict_rules = Vec::new();
    let mut driftfile = String::from("/var/lib/ntp/drift");
    let mut statsdir: Option<String> = None;
    let mut keys_file: Option<String> = None;
    let mut extra_lines = Vec::new();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') { continue; }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.is_empty() { continue; }

        match parts[0] {
            "server" | "pool" | "peer" if parts.len() >= 2 => {
                servers.push(parse_ntpd_server_directive(&parts));
            }
            "restrict" => {
                restrict_rules.push(parts[1..].join(" "));
            }
            "driftfile" if parts.len() >= 2 => driftfile = parts[1].to_string(),
            "statsdir" if parts.len() >= 2 => statsdir = Some(parts[1].to_string()),
            "keys" if parts.len() >= 2 => keys_file = Some(parts[1].to_string()),
            _ => extra_lines.push(line.to_string()),
        }
    }

    Ok(NtpdConfig { servers, restrict_rules, driftfile, statsdir, keys_file, extra_lines })
}

fn parse_ntpd_server_directive(parts: &[&str]) -> NtpServerConfig {
    let server_type = match parts[0] {
        "pool" => NtpServerType::Pool,
        "peer" => NtpServerType::Peer,
        _ => NtpServerType::Server,
    };
    let address = parts[1].to_string();
    let rest = &parts[2..];
    let iburst = rest.contains(&"iburst");
    let prefer = rest.contains(&"prefer");
    let minpoll = rest.iter()
        .position(|&x| x == "minpoll")
        .and_then(|i| rest.get(i + 1))
        .and_then(|v| v.parse().ok());
    let maxpoll = rest.iter()
        .position(|&x| x == "maxpoll")
        .and_then(|i| rest.get(i + 1))
        .and_then(|v| v.parse().ok());
    let key = rest.iter()
        .position(|&x| x == "key")
        .and_then(|i| rest.get(i + 1))
        .map(|v| v.to_string());

    NtpServerConfig { address, server_type, iburst, prefer, minpoll, maxpoll, key }
}

fn serialize_ntp_conf(cfg: &NtpdConfig) -> String {
    let mut lines = Vec::new();
    lines.push("# ntp.conf — managed by SortOfRemoteNG".to_string());
    lines.push(String::new());

    lines.push(format!("driftfile {}", cfg.driftfile));
    if let Some(ref sd) = cfg.statsdir {
        lines.push(format!("statsdir {sd}"));
    }
    if let Some(ref kf) = cfg.keys_file {
        lines.push(format!("keys {kf}"));
    }
    lines.push(String::new());

    for r in &cfg.restrict_rules {
        lines.push(format!("restrict {r}"));
    }
    lines.push(String::new());

    for s in &cfg.servers {
        lines.push(serialize_ntpd_server_line(s));
    }
    lines.push(String::new());

    for e in &cfg.extra_lines {
        lines.push(e.clone());
    }
    lines.push(String::new());
    lines.join("\n")
}

fn serialize_ntpd_server_line(s: &NtpServerConfig) -> String {
    let keyword = match s.server_type {
        NtpServerType::Pool => "pool",
        NtpServerType::Peer => "peer",
        NtpServerType::Server => "server",
    };
    let mut line = format!("{keyword} {}", s.address);
    if s.iburst { line.push_str(" iburst"); }
    if s.prefer { line.push_str(" prefer"); }
    if let Some(min) = s.minpoll { line.push_str(&format!(" minpoll {min}")); }
    if let Some(max) = s.maxpoll { line.push_str(&format!(" maxpoll {max}")); }
    if let Some(ref k) = s.key { line.push_str(&format!(" key {k}")); }
    line
}

/// Parse `ntpq -pn` tabular output.
///
/// Example line:
/// ```text
///      remote           refid      st t when poll reach   delay   offset  jitter
/// ==============================================================================
/// *ntp1.example.c  .GPS.            1 u   22   64  377    1.234   -0.567   0.123
/// ```
fn parse_ntpq_peers(output: &str) -> Result<Vec<NtpPeer>, TimeNtpError> {
    let mut peers = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty()
            || line.starts_with("remote")
            || line.starts_with("=")
            || line.starts_with('-') && line.chars().all(|c| c == '-' || c == '=')
        {
            continue;
        }
        // First char is the tally code: * # o + - x .
        if line.len() < 2 { continue; }
        let tally = &line[..1];
        let rest = line[1..].trim();
        let cols: Vec<&str> = rest.split_whitespace().collect();
        if cols.len() < 9 { continue; }

        let state = match tally {
            "*" => NtpPeerState::Sync,
            "+" => NtpPeerState::Candidate,
            "-" => NtpPeerState::Outlier,
            "x" => NtpPeerState::Falseticker,
            "." => NtpPeerState::Excess,
            "#" => NtpPeerState::Candidate,
            _ => NtpPeerState::Unknown,
        };

        peers.push(NtpPeer {
            tally_char: tally.to_string(),
            remote: cols[0].to_string(),
            refid: cols[1].to_string(),
            stratum: cols[2].parse().unwrap_or(0),
            peer_type: cols[3].to_string(),
            when: cols[4].to_string(),
            poll: cols[5].parse().unwrap_or(0),
            reach: cols[6].to_string(),
            delay: cols[7].parse().unwrap_or(0.0),
            offset: cols[8].parse().unwrap_or(0.0),
            jitter: cols.get(9).and_then(|v| v.parse().ok()).unwrap_or(0.0),
            state,
        });
    }
    Ok(peers)
}

/// Parse `ntpq -c associations` table.
fn parse_ntpq_associations(output: &str) -> Result<Vec<HashMap<String, String>>, TimeNtpError> {
    let mut result = Vec::new();
    let lines: Vec<&str> = output.lines().collect();
    if lines.len() < 2 { return Ok(result); }

    // First non-empty line is the header
    let header_line = lines.iter().find(|l| !l.trim().is_empty());
    let header: Vec<&str> = match header_line {
        Some(h) => h.split_whitespace().collect(),
        None => return Ok(result),
    };

    for line in &lines[1..] {
        let line = line.trim();
        if line.is_empty() || line.starts_with('=') || line.starts_with('-') { continue; }
        let cols: Vec<&str> = line.split_whitespace().collect();
        let mut row = HashMap::new();
        for (i, key) in header.iter().enumerate() {
            if let Some(val) = cols.get(i) {
                row.insert(key.to_string(), val.to_string());
            }
        }
        if !row.is_empty() {
            result.push(row);
        }
    }
    Ok(result)
}

/// Parse `ntpq -c rv` system variables output.
/// Format: "variable=value, variable=value, ..."
fn parse_ntpq_rv(output: &str) -> Result<NtpStatus, TimeNtpError> {
    let mut vars = HashMap::new();
    // Flatten multiline output into one string, then split on commas
    let flat: String = output.lines().map(|l| l.trim()).collect::<Vec<_>>().join(" ");
    for pair in flat.split(',') {
        let pair = pair.trim();
        if let Some((k, v)) = pair.split_once('=') {
            vars.insert(k.trim().to_string(), v.trim().trim_matches('"').to_string());
        }
    }

    let stratum: u32 = vars.get("stratum").and_then(|v| v.parse().ok()).unwrap_or(16);
    let offset: f64 = vars.get("offset").and_then(|v| v.parse().ok()).unwrap_or(0.0);
    let frequency: f64 = vars.get("frequency").and_then(|v| v.parse().ok()).unwrap_or(0.0);
    let rootdelay: f64 = vars.get("rootdelay").and_then(|v| v.parse().ok()).unwrap_or(0.0);
    let rootdisp: f64 = vars.get("rootdisp").and_then(|v| v.parse().ok()).unwrap_or(0.0);
    let reference = vars.get("refid").cloned().unwrap_or_default();
    let leap = vars.get("leap").map(|v| v.as_str()).unwrap_or("3");
    let synced = leap != "3"; // leap=3 means unsynchronised

    Ok(NtpStatus {
        implementation: NtpImplementation::NtpdClassic,
        synced,
        stratum,
        reference,
        offset_ms: offset, // ntpq rv reports offset in ms
        frequency_ppm: frequency,
        sys_time: None,
        precision: vars.get("precision").and_then(|v| v.parse().ok()),
        root_delay: rootdelay,
        root_dispersion: rootdisp,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_ntp_conf() {
        let input = "\
# /etc/ntp.conf
driftfile /var/lib/ntp/ntp.drift
statsdir /var/log/ntpstats/
keys /etc/ntp/keys

restrict default kod nomodify notrap nopeer noquery
restrict 127.0.0.1

server 0.ubuntu.pool.ntp.org iburst
server 1.ubuntu.pool.ntp.org iburst prefer
pool ntp.ubuntu.com iburst minpoll 4 maxpoll 10
peer 10.0.0.1

filegen loopstats file loopstats type day enable
";
        let cfg = parse_ntp_conf(input).unwrap();
        assert_eq!(cfg.servers.len(), 4);
        assert_eq!(cfg.servers[0].address, "0.ubuntu.pool.ntp.org");
        assert!(cfg.servers[0].iburst);
        assert!(cfg.servers[1].prefer);
        assert_eq!(cfg.servers[2].server_type, NtpServerType::Pool);
        assert_eq!(cfg.servers[2].minpoll, Some(4));
        assert_eq!(cfg.servers[3].server_type, NtpServerType::Peer);
        assert_eq!(cfg.restrict_rules.len(), 2);
        assert_eq!(cfg.driftfile, "/var/lib/ntp/ntp.drift");
        assert_eq!(cfg.statsdir.as_deref(), Some("/var/log/ntpstats/"));
        assert_eq!(cfg.keys_file.as_deref(), Some("/etc/ntp/keys"));
        assert_eq!(cfg.extra_lines.len(), 1);
    }

    #[test]
    fn test_serialize_roundtrip() {
        let cfg = NtpdConfig {
            servers: vec![NtpServerConfig {
                address: "ntp.example.com".into(),
                server_type: NtpServerType::Server,
                iburst: true, prefer: false, minpoll: None, maxpoll: None, key: None,
            }],
            restrict_rules: vec!["default kod nomodify".into(), "127.0.0.1".into()],
            driftfile: "/var/lib/ntp/drift".into(),
            statsdir: None,
            keys_file: None,
            extra_lines: vec![],
        };
        let out = serialize_ntp_conf(&cfg);
        let reparsed = parse_ntp_conf(&out).unwrap();
        assert_eq!(reparsed.servers.len(), 1);
        assert_eq!(reparsed.restrict_rules.len(), 2);
    }

    #[test]
    fn test_parse_ntpq_peers() {
        let output = "\
     remote           refid      st t when poll reach   delay   offset  jitter
==============================================================================
*ntp1.example.c  .GPS.            1 u   22   64  377    1.234   -0.567   0.123
+ntp2.example.c  .PPS.            1 u   45   64  377    2.345    0.089   0.045
-ntp3.example.c  10.0.0.1         2 u  102  128  377   15.678    1.234   0.567
xbad.example.co  .INIT.          16 u    -   64    0    0.000    0.000   0.000
";
        let peers = parse_ntpq_peers(output).unwrap();
        assert_eq!(peers.len(), 4);
        assert_eq!(peers[0].tally_char, "*");
        assert_eq!(peers[0].remote, "ntp1.example.c");
        assert_eq!(peers[0].refid, ".GPS.");
        assert_eq!(peers[0].stratum, 1);
        assert_eq!(peers[0].state, NtpPeerState::Sync);
        assert_eq!(peers[1].state, NtpPeerState::Candidate);
        assert_eq!(peers[2].state, NtpPeerState::Outlier);
        assert_eq!(peers[3].state, NtpPeerState::Falseticker);
        assert!((peers[0].delay - 1.234).abs() < 0.001);
        assert!((peers[0].offset - (-0.567)).abs() < 0.001);
    }

    #[test]
    fn test_parse_ntpq_rv() {
        let output = "associd=0 status=0615 leap_none, sync_ntp, 1 event, clock_sync,\n\
version=\"ntpd 4.2.8p15\", processor=\"x86_64\",\n\
system=\"Linux/5.15.0\", leap=0, stratum=2, precision=-23,\n\
rootdelay=1.234, rootdisp=2.345, refid=192.168.1.1,\n\
reftime=e9876543.12345678, clock=e9876543.12345679,\n\
peer=12345, tc=6, mintc=3, offset=0.567, frequency=-1.234,\n\
sys_jitter=0.045, clk_jitter=0.012, clk_wander=0.001\n";
        let status = parse_ntpq_rv(output).unwrap();
        assert_eq!(status.implementation, NtpImplementation::NtpdClassic);
        assert!(status.synced);
        assert_eq!(status.stratum, 2);
        assert_eq!(status.reference, "192.168.1.1");
        assert!((status.offset_ms - 0.567).abs() < 0.001);
        assert!((status.frequency_ppm - (-1.234)).abs() < 0.001);
        assert!((status.root_delay - 1.234).abs() < 0.001);
        assert!((status.root_dispersion - 2.345).abs() < 0.001);
    }

    #[test]
    fn test_parse_ntpq_rv_unsynced() {
        let output = "associd=0 status=c000 leap_alarm, sync_unspec,\n\
stratum=16, refid=INIT, offset=0.000, frequency=0.000,\n\
rootdelay=0.000, rootdisp=0.000, leap=3\n";
        let status = parse_ntpq_rv(output).unwrap();
        assert!(!status.synced);
        assert_eq!(status.stratum, 16);
    }
}
