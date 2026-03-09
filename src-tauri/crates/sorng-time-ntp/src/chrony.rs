//! Chrony NTP management — configuration, sources, tracking, burst, etc.
use crate::client;
use crate::error::TimeNtpError;
use crate::types::*;
use std::collections::HashMap;

const CHRONY_CONF: &str = "/etc/chrony.conf";
const CHRONY_CONF_ALT: &str = "/etc/chrony/chrony.conf";

// ─── Configuration ──────────────────────────────────────────────────

/// Read and parse the chrony configuration file.
pub async fn get_chrony_config(host: &TimeHost) -> Result<ChronyConfig, TimeNtpError> {
    let content = match client::read_file(host, CHRONY_CONF).await {
        Ok(c) => c,
        Err(_) => client::read_file(host, CHRONY_CONF_ALT).await?,
    };
    parse_chrony_conf(&content)
}

/// Write a full chrony configuration file.
pub async fn set_chrony_config(host: &TimeHost, config: &ChronyConfig) -> Result<(), TimeNtpError> {
    let content = serialize_chrony_conf(config);
    // Try the primary path first; fall back to alt
    let path = match client::exec(host, "test", &["-f", CHRONY_CONF]).await {
        Ok((_, _, 0)) => CHRONY_CONF,
        _ => CHRONY_CONF_ALT,
    };
    client::write_file(host, path, &content).await?;
    // Restart chronyd to pick up changes
    let _ = client::exec(host, "systemctl", &["restart", "chronyd"]).await;
    let _ = client::exec(host, "systemctl", &["restart", "chrony"]).await;
    Ok(())
}

/// Add an NTP server/pool entry to chrony.conf.
pub async fn add_server(host: &TimeHost, server: &NtpServerConfig) -> Result<(), TimeNtpError> {
    let mut cfg = get_chrony_config(host).await?;
    match server.server_type {
        NtpServerType::Pool => cfg.pools.push(server.clone()),
        _ => cfg.servers.push(server.clone()),
    }
    set_chrony_config(host, &cfg).await
}

/// Remove an NTP server/pool entry by address.
pub async fn remove_server(host: &TimeHost, address: &str) -> Result<(), TimeNtpError> {
    let mut cfg = get_chrony_config(host).await?;
    cfg.servers.retain(|s| s.address != address);
    cfg.pools.retain(|s| s.address != address);
    set_chrony_config(host, &cfg).await
}

// ─── chronyc queries ────────────────────────────────────────────────

/// Get NTP sources (`chronyc -c sources`).
pub async fn get_sources(host: &TimeHost) -> Result<Vec<NtpSource>, TimeNtpError> {
    let out = client::exec_ok(host, "chronyc", &["-c", "sources"]).await?;
    parse_chronyc_sources(&out)
}

/// Get source statistics (`chronyc -c sourcestats`).
pub async fn get_sourcestats(host: &TimeHost) -> Result<Vec<TimeSyncStats>, TimeNtpError> {
    let out = client::exec_ok(host, "chronyc", &["-c", "sourcestats"]).await?;
    parse_chronyc_sourcestats(&out)
}

/// Get tracking information (`chronyc -c tracking`).
pub async fn get_tracking(host: &TimeHost) -> Result<NtpStatus, TimeNtpError> {
    let out = client::exec_ok(host, "chronyc", &["-c", "tracking"]).await?;
    parse_chronyc_tracking(&out)
}

/// Get activity summary (`chronyc activity`).
pub async fn get_activity(host: &TimeHost) -> Result<HashMap<String, String>, TimeNtpError> {
    let out = client::exec_ok(host, "chronyc", &["activity"]).await?;
    let mut map = HashMap::new();
    for line in out.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // Lines like "200 OK" or "6 sources online"
        if let Some((count, desc)) = line.split_once(' ') {
            map.insert(desc.trim().to_string(), count.trim().to_string());
        }
    }
    Ok(map)
}

/// Force an immediate clock step (`chronyc makestep`).
pub async fn makestep(host: &TimeHost) -> Result<(), TimeNtpError> {
    client::exec_ok(host, "chronyc", &["makestep"]).await?;
    Ok(())
}

/// Initiate a burst of measurements (`chronyc burst <good>/<max>`).
pub async fn burst(host: &TimeHost, good: u32, max: u32) -> Result<(), TimeNtpError> {
    let spec = format!("{good}/{max}");
    client::exec_ok(host, "chronyc", &["burst", &spec]).await?;
    Ok(())
}

/// Set a source to online mode.
pub async fn set_online(host: &TimeHost, address: &str) -> Result<(), TimeNtpError> {
    client::exec_ok(host, "chronyc", &["online", address]).await?;
    Ok(())
}

/// Set a source to offline mode.
pub async fn set_offline(host: &TimeHost, address: &str) -> Result<(), TimeNtpError> {
    client::exec_ok(host, "chronyc", &["offline", address]).await?;
    Ok(())
}

/// Get detailed NTP data for a specific source (`chronyc ntpdata <addr>`).
pub async fn get_ntp_data(host: &TimeHost, address: &str) -> Result<NtpPeer, TimeNtpError> {
    let out = client::exec_ok(host, "chronyc", &["ntpdata", address]).await?;
    parse_chronyc_ntpdata(&out, address)
}

/// Get RTC information (`chronyc rtcdata`).
pub async fn get_rtc_info(host: &TimeHost) -> Result<HashMap<String, String>, TimeNtpError> {
    let out = client::exec_ok(host, "chronyc", &["rtcdata"]).await?;
    let mut map = HashMap::new();
    for line in out.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("RTC") && line.contains("not") {
            continue;
        }
        if let Some((k, v)) = line.split_once(':') {
            map.insert(k.trim().to_string(), v.trim().to_string());
        }
    }
    Ok(map)
}

// ─── Parsing helpers ────────────────────────────────────────────────

pub fn parse_chrony_conf(content: &str) -> Result<ChronyConfig, TimeNtpError> {
    let mut servers = Vec::new();
    let mut pools = Vec::new();
    let mut makestep_threshold = 1.0;
    let mut makestep_limit = 3;
    let mut rtcsync = false;
    let mut driftfile = String::from("/var/lib/chrony/drift");
    let mut logdir = String::from("/var/log/chrony");
    let mut allow = Vec::new();
    let mut deny = Vec::new();
    let mut extra_directives = Vec::new();

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with('!') {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }

        match parts[0] {
            "server" | "peer" if parts.len() >= 2 => {
                servers.push(parse_ntp_server_directive(&parts));
            }
            "pool" if parts.len() >= 2 => {
                pools.push(parse_ntp_server_directive(&parts));
            }
            "makestep" if parts.len() >= 3 => {
                makestep_threshold = parts[1].parse().unwrap_or(1.0);
                makestep_limit = parts[2].parse().unwrap_or(3);
            }
            "rtcsync" => rtcsync = true,
            "driftfile" if parts.len() >= 2 => driftfile = parts[1].to_string(),
            "logdir" if parts.len() >= 2 => logdir = parts[1].to_string(),
            "allow" if parts.len() >= 2 => allow.push(parts[1].to_string()),
            "deny" if parts.len() >= 2 => deny.push(parts[1].to_string()),
            _ => extra_directives.push(line.to_string()),
        }
    }

    Ok(ChronyConfig {
        servers,
        pools,
        makestep_threshold,
        makestep_limit,
        rtcsync,
        driftfile,
        logdir,
        allow,
        deny,
        extra_directives,
    })
}

fn parse_ntp_server_directive(parts: &[&str]) -> NtpServerConfig {
    let server_type = match parts[0] {
        "pool" => NtpServerType::Pool,
        "peer" => NtpServerType::Peer,
        _ => NtpServerType::Server,
    };
    let address = parts[1].to_string();
    let rest: Vec<&str> = parts[2..].to_vec();
    let iburst = rest.contains(&"iburst");
    let prefer = rest.contains(&"prefer");
    let minpoll = rest
        .iter()
        .position(|&x| x == "minpoll")
        .and_then(|i| rest.get(i + 1))
        .and_then(|v| v.parse().ok());
    let maxpoll = rest
        .iter()
        .position(|&x| x == "maxpoll")
        .and_then(|i| rest.get(i + 1))
        .and_then(|v| v.parse().ok());
    let key = rest
        .iter()
        .position(|&x| x == "key")
        .and_then(|i| rest.get(i + 1))
        .map(|v| v.to_string());

    NtpServerConfig {
        address,
        server_type,
        iburst,
        prefer,
        minpoll,
        maxpoll,
        key,
    }
}

fn serialize_chrony_conf(cfg: &ChronyConfig) -> String {
    let mut lines = Vec::new();
    lines.push("# Chrony configuration — managed by SortOfRemoteNG".to_string());
    lines.push(String::new());

    for s in &cfg.servers {
        lines.push(serialize_server_line(s));
    }
    for p in &cfg.pools {
        lines.push(serialize_server_line(p));
    }
    lines.push(String::new());
    lines.push(format!(
        "makestep {} {}",
        cfg.makestep_threshold, cfg.makestep_limit
    ));
    if cfg.rtcsync {
        lines.push("rtcsync".to_string());
    }
    lines.push(format!("driftfile {}", cfg.driftfile));
    lines.push(format!("logdir {}", cfg.logdir));
    for a in &cfg.allow {
        lines.push(format!("allow {a}"));
    }
    for d in &cfg.deny {
        lines.push(format!("deny {d}"));
    }
    for e in &cfg.extra_directives {
        lines.push(e.clone());
    }
    lines.push(String::new());
    lines.join("\n")
}

fn serialize_server_line(s: &NtpServerConfig) -> String {
    let keyword = match s.server_type {
        NtpServerType::Pool => "pool",
        NtpServerType::Peer => "peer",
        NtpServerType::Server => "server",
    };
    let mut line = format!("{keyword} {}", s.address);
    if s.iburst {
        line.push_str(" iburst");
    }
    if s.prefer {
        line.push_str(" prefer");
    }
    if let Some(min) = s.minpoll {
        line.push_str(&format!(" minpoll {min}"));
    }
    if let Some(max) = s.maxpoll {
        line.push_str(&format!(" maxpoll {max}"));
    }
    if let Some(ref k) = s.key {
        line.push_str(&format!(" key {k}"));
    }
    line
}

/// Parse `chronyc -c sources` CSV output.
/// Fields: Mode,State,Name,Stratum,Poll,Reach,LastRx,LastSample[offset,error]
fn parse_chronyc_sources(output: &str) -> Result<Vec<NtpSource>, TimeNtpError> {
    let mut sources = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let cols: Vec<&str> = line.split(',').collect();
        if cols.len() < 10 {
            continue;
        }
        // CSV columns: Mode, State, Name, Stratum, Poll, Reach, LastRx, Offset, Error, (...)
        sources.push(NtpSource {
            name: cols[2].to_string(),
            address: cols[2].to_string(),
            stratum: cols[3].parse().unwrap_or(0),
            poll: cols[4].parse().unwrap_or(0),
            reach: cols[5].to_string(),
            last_rx: cols[6].to_string(),
            offset: parse_chrony_value(cols[7]),
            error: parse_chrony_value(cols[8]),
        });
    }
    Ok(sources)
}

/// Parse `chronyc -c sourcestats` CSV output.
/// Fields: Name,NP,NR,Span,Frequency,FreqSkew,Offset,StdDev
fn parse_chronyc_sourcestats(output: &str) -> Result<Vec<TimeSyncStats>, TimeNtpError> {
    let mut stats = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let cols: Vec<&str> = line.split(',').collect();
        if cols.len() < 8 {
            continue;
        }
        stats.push(TimeSyncStats {
            offset_seconds: parse_chrony_value(cols[6]),
            frequency_ppm: parse_chrony_value(cols[4]),
            residual_freq: 0.0,
            skew: parse_chrony_value(cols[5]),
            root_delay: 0.0,
            root_dispersion: 0.0,
            update_interval: parse_chrony_value(cols[3]),
            leap_status: String::new(),
        });
    }
    Ok(stats)
}

/// Parse `chronyc -c tracking` CSV output.
/// Fields: RefID,RefIDName,Stratum,RefTime,SysTime,LastOffset,RMSOffset,
///         Frequency,ResidFreq,Skew,RootDelay,RootDispersion,UpdateInterval,LeapStatus
fn parse_chronyc_tracking(output: &str) -> Result<NtpStatus, TimeNtpError> {
    let line = output
        .lines()
        .find(|l| !l.trim().is_empty())
        .ok_or_else(|| TimeNtpError::ParseError("Empty chronyc tracking output".into()))?;
    let cols: Vec<&str> = line.split(',').collect();
    if cols.len() < 14 {
        return Err(TimeNtpError::ParseError(format!(
            "chronyc tracking: expected >=14 CSV fields, got {}",
            cols.len()
        )));
    }

    let synced = cols[13].trim() != "Not synchronised";
    Ok(NtpStatus {
        implementation: NtpImplementation::Chrony,
        synced,
        stratum: cols[2].parse().unwrap_or(0),
        reference: cols[1].to_string(),
        offset_ms: parse_chrony_value(cols[5]) * 1000.0,
        frequency_ppm: parse_chrony_value(cols[7]),
        sys_time: None,
        precision: None,
        root_delay: parse_chrony_value(cols[10]),
        root_dispersion: parse_chrony_value(cols[11]),
    })
}

/// Parse `chronyc ntpdata <addr>` key-value output into an NtpPeer.
fn parse_chronyc_ntpdata(output: &str, address: &str) -> Result<NtpPeer, TimeNtpError> {
    let mut map = HashMap::new();
    for line in output.lines() {
        let line = line.trim();
        if let Some((k, v)) = line.split_once(':') {
            map.insert(k.trim().to_lowercase(), v.trim().to_string());
        }
    }

    let stratum = map.get("stratum").and_then(|v| v.parse().ok()).unwrap_or(0);
    let poll = map
        .get("poll interval")
        .and_then(|v| {
            // "1024 (2^10)" -> extract the number
            v.split_whitespace().next().and_then(|n| n.parse().ok())
        })
        .unwrap_or(0);
    let offset = map
        .get("offset")
        .map(|v| parse_value_with_unit(v))
        .unwrap_or(0.0);
    let delay = map
        .get("peer delay")
        .map(|v| parse_value_with_unit(v))
        .unwrap_or(0.0);
    let jitter = map
        .get("peer dispersion")
        .map(|v| parse_value_with_unit(v))
        .unwrap_or(0.0);

    Ok(NtpPeer {
        tally_char: String::new(),
        remote: address.to_string(),
        refid: map.get("reference id").cloned().unwrap_or_default(),
        stratum,
        peer_type: map.get("mode").cloned().unwrap_or_else(|| "server".into()),
        when: String::new(),
        poll,
        reach: String::new(),
        delay,
        offset,
        jitter,
        state: NtpPeerState::Unknown,
    })
}

/// Parse a chrony CSV value that may have unit suffixes or scientific notation.
fn parse_chrony_value(s: &str) -> f64 {
    let s = s.trim();
    // chrony CSV values are plain floats in seconds
    s.parse::<f64>().unwrap_or(0.0)
}

/// Parse a value like "+0.000012345 seconds" or "0.5 ms".
fn parse_value_with_unit(s: &str) -> f64 {
    let s = s.trim();
    let numeric_part = s.split_whitespace().next().unwrap_or("0");
    let numeric_part = numeric_part.trim_start_matches('+');
    let val: f64 = numeric_part.parse().unwrap_or(0.0);
    if s.contains("ms") {
        val / 1000.0
    } else if s.contains("us") || s.contains("µs") {
        val / 1_000_000.0
    } else if s.contains("ns") {
        val / 1_000_000_000.0
    } else {
        val
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_chrony_conf() {
        let input = "\
# chrony.conf
server 0.pool.ntp.org iburst
server 1.pool.ntp.org iburst prefer
pool 2.pool.ntp.org iburst minpoll 4 maxpoll 10
peer 10.0.0.1 key mykey

makestep 1.0 3
rtcsync
driftfile /var/lib/chrony/drift
logdir /var/log/chrony
allow 192.168.0.0/16
deny 10.0.0.0/8
bindcmdaddress 127.0.0.1
";
        let cfg = parse_chrony_conf(input).unwrap();
        assert_eq!(cfg.servers.len(), 3); // 2 servers + 1 peer
        assert_eq!(cfg.pools.len(), 1);
        assert_eq!(cfg.servers[0].address, "0.pool.ntp.org");
        assert!(cfg.servers[0].iburst);
        assert!(!cfg.servers[0].prefer);
        assert!(cfg.servers[1].prefer);
        assert_eq!(cfg.servers[2].address, "10.0.0.1");
        assert_eq!(cfg.servers[2].server_type, NtpServerType::Peer);
        assert_eq!(cfg.servers[2].key.as_deref(), Some("mykey"));
        assert_eq!(cfg.pools[0].minpoll, Some(4));
        assert_eq!(cfg.pools[0].maxpoll, Some(10));
        assert_eq!(cfg.makestep_threshold, 1.0);
        assert_eq!(cfg.makestep_limit, 3);
        assert!(cfg.rtcsync);
        assert_eq!(cfg.allow, vec!["192.168.0.0/16"]);
        assert_eq!(cfg.deny, vec!["10.0.0.0/8"]);
        assert!(cfg
            .extra_directives
            .contains(&"bindcmdaddress 127.0.0.1".to_string()));
    }

    #[test]
    fn test_serialize_roundtrip() {
        let cfg = ChronyConfig {
            servers: vec![NtpServerConfig {
                address: "0.pool.ntp.org".into(),
                server_type: NtpServerType::Server,
                iburst: true,
                prefer: false,
                minpoll: None,
                maxpoll: None,
                key: None,
            }],
            pools: vec![NtpServerConfig {
                address: "pool.ntp.org".into(),
                server_type: NtpServerType::Pool,
                iburst: true,
                prefer: false,
                minpoll: Some(4),
                maxpoll: Some(10),
                key: None,
            }],
            makestep_threshold: 0.5,
            makestep_limit: 5,
            rtcsync: true,
            driftfile: "/var/lib/chrony/drift".into(),
            logdir: "/var/log/chrony".into(),
            allow: vec!["192.168.0.0/16".into()],
            deny: vec![],
            extra_directives: vec![],
        };
        let serialized = serialize_chrony_conf(&cfg);
        let reparsed = parse_chrony_conf(&serialized).unwrap();
        assert_eq!(reparsed.servers.len(), 1);
        assert_eq!(reparsed.pools.len(), 1);
        assert_eq!(reparsed.makestep_threshold, 0.5);
        assert_eq!(reparsed.makestep_limit, 5);
        assert!(reparsed.rtcsync);
    }

    #[test]
    fn test_parse_chronyc_sources() {
        let csv = "\
^,+,ntp1.example.com,2,10,377,35,+0.000123,0.000045\n\
^,*,ntp2.example.com,1,10,377,22,-0.000010,0.000015,extra\n";
        // The first line has 9 fields — it should be skipped (< 10).
        // The second has 10+ fields.
        let sources = parse_chronyc_sources(csv).unwrap();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].name, "ntp2.example.com");
        assert_eq!(sources[0].stratum, 1);
    }

    #[test]
    fn test_parse_chronyc_tracking() {
        let csv = "A1B2C3D4,ntp1.example.com,2,1705672200.000,+0.000001234,-0.000000567,0.000001000,-0.123,+0.001,0.050,0.001234,0.000567,64.0,Normal\n";
        let status = parse_chronyc_tracking(csv).unwrap();
        assert_eq!(status.implementation, NtpImplementation::Chrony);
        assert!(status.synced);
        assert_eq!(status.stratum, 2);
        assert_eq!(status.reference, "ntp1.example.com");
    }

    #[test]
    fn test_parse_value_with_unit() {
        assert!((parse_value_with_unit("+0.5 ms") - 0.0005).abs() < 1e-9);
        assert!((parse_value_with_unit("100 us") - 0.0001).abs() < 1e-9);
        assert!((parse_value_with_unit("1.5 seconds") - 1.5).abs() < 1e-9);
        assert!((parse_value_with_unit("500 ns") - 0.0000005).abs() < 1e-12);
    }
}
