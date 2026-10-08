//! Explicit local/OS diagnostics. Never a proxy or protocol fallback.
use super::types::ToolkitRequest;
use crate::discovery_ping::probe_discovery_host;
use futures::{stream, StreamExt};
use getifaddrs::{Interface, InterfaceFlags};
use serde_json::{json, Value};
use std::net::{IpAddr, Ipv4Addr};
use std::time::Duration;
use tokio::sync::Semaphore;
use tokio::time::{timeout_at, Instant};

static INTERFACE_WORKERS: Semaphore = Semaphore::const_new(2);

fn options(request: &ToolkitRequest, allowed: &[&str]) -> Result<(), String> {
    if request.route != "direct" || request.proxy_url.as_deref().is_some_and(|s| !s.is_empty()) {
        return Err(
            "This tool requires explicit direct/local networking; no proxy fallback.".into(),
        );
    }
    if let Some(key) = request
        .options
        .keys()
        .find(|key| !allowed.contains(&key.as_str()))
    {
        return Err(format!("{} does not support option {key}", request.tool));
    }
    Ok(())
}

fn remaining(deadline: Instant) -> Result<u64, String> {
    let millis = deadline
        .saturating_duration_since(Instant::now())
        .as_millis() as u64;
    if millis == 0 {
        Err("Diagnostic deadline expired".into())
    } else {
        Ok(millis)
    }
}

fn command_budget(deadline: Instant) -> Result<u64, String> {
    // Leave time for run_command to kill/reap and return its partial output
    // before this module's outer deadline drops the whole report.
    Ok(remaining(deadline)?.saturating_sub(100).max(1))
}

async fn address(target: &str) -> Result<IpAddr, String> {
    super::validate_host(target)?;
    let addresses = super::resolve(target, 1).await?;
    addresses
        .first()
        .map(|address| address.ip())
        .ok_or_else(|| "No resolved address".into())
}

fn sweep_addresses(cidr: &str) -> Result<(String, Vec<Ipv4Addr>), String> {
    let (address, prefix) = cidr
        .split_once('/')
        .ok_or("Enter an IPv4 CIDR, at most /24 (256 addresses)")?;
    let ip: Ipv4Addr = address.parse().map_err(|_| "IPv4 CIDR required")?;
    let prefix: u32 = prefix.parse().map_err(|_| "Invalid IPv4 prefix")?;
    if !(24..=32).contains(&prefix) {
        return Err("Sweep is limited to 256 IPv4 addresses (/24 through /32)".into());
    }
    let mask = u32::MAX.checked_shl(32 - prefix).unwrap_or(0);
    let first = u32::from(ip) & mask;
    let count = 1_u32 << (32 - prefix);
    let (start, end) = if prefix <= 30 {
        (1, count - 1)
    } else {
        (0, count)
    };
    let addresses: Vec<_> = (start..end)
        .map(|offset| Ipv4Addr::from(first + offset))
        .collect();
    if addresses.iter().any(|ip| {
        ip.is_unspecified()
            || ip.is_multicast()
            || ip.is_broadcast()
            || ip.octets()[0] == 0
            || ip.octets()[0] >= 240
    }) {
        return Err(
            "Sweep requires unicast IPv4 addresses, not broadcast/multicast/reserved space".into(),
        );
    }
    Ok((format!("{}/{prefix}", Ipv4Addr::from(first)), addresses))
}

async fn ping(request: &ToolkitRequest, deadline: Instant) -> Result<Value, String> {
    let deadline = deadline - Duration::from_millis(100);
    options(request, &["count", "packetTimeoutMs"])?;
    let count = request.number("count", 4, 1, 10)?;
    let per_probe = request.number("packetTimeoutMs", 1000, 100, 5000)?;
    let ip = address(&request.target).await?;
    let mut probes = Vec::new();
    for _ in 0..count {
        let Ok(budget) = remaining(deadline) else {
            break;
        };
        if budget < 100 {
            break;
        }
        let probe =
            probe_discovery_host(ip.to_string(), "icmp".into(), budget.min(per_probe), None).await;
        probes.push(probe);
    }
    let received = probes.iter().filter(|probe| probe.reachable).count();
    let unavailable = probes
        .iter()
        .filter(|probe| probe.status == "unavailable")
        .count();
    Ok(
        json!({"address": ip.to_string(), "requestedCount": count, "completedProbes": probes.len(),
        "responsiveProbes": received, "unavailableProbes": unavailable, "complete": probes.len() == count as usize,
        "reachable": received > 0, "status": if received > 0 { "responsive" } else if unavailable == probes.len() { "unavailable" } else { "unresponsive" },
        "note": "Elapsed probe times include OS/process overhead, not just wire RTT. Unavailable probes do not establish packet loss.", "probes": probes}),
    )
}

async fn sweep(request: &ToolkitRequest, deadline: Instant) -> Result<Value, String> {
    let deadline = deadline - Duration::from_millis(100);
    options(request, &["concurrency", "packetTimeoutMs"])?;
    let concurrency = request.number("concurrency", 16, 1, 16)? as usize;
    let per_probe = request.number("packetTimeoutMs", 1000, 100, 5000)?;
    let (network, addresses) = sweep_addresses(&request.target)?;
    let expected = addresses.len();
    let mut pending = stream::iter(addresses)
        .map(|ip| async move {
            let budget = remaining(deadline)?.min(per_probe);
            if budget < 100 {
                return Err("Diagnostic deadline expired".into());
            }
            let probe = probe_discovery_host(ip.to_string(), "icmp".into(), budget, None).await;
            Ok::<_, String>((ip, probe))
        })
        .buffer_unordered(concurrency);
    let mut results = Vec::new();
    while let Ok(Some(result)) = timeout_at(deadline, pending.next()).await {
        if let Ok(result) = result {
            results.push(result);
        }
    }
    // Dropping pending cancels unfinished shell-free ICMP commands.
    drop(pending);
    results.sort_by_key(|(ip, _)| *ip);
    let responsive = results.iter().filter(|(_, probe)| probe.reachable).count();
    Ok(
        json!({"network": network, "hostCount": expected, "completedHosts": results.len(),
        "complete": results.len() == expected, "responsiveHosts": responsive, "concurrency": concurrency,
        "note": "No ICMP reply does not prove a host is offline; filtering and local permissions can prevent replies.",
        "results": results.into_iter().map(|(ip, probe)| json!({"address": ip.to_string(), "probe": probe})).collect::<Vec<_>>()}),
    )
}

fn interface_row(interface: Interface) -> Value {
    let mac = interface.address.mac_addr().map(|bytes| {
        bytes
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<Vec<_>>()
            .join(":")
    });
    let mut row = json!({"name": interface.name, "index": interface.index,
        "address": interface.address.ip_addr().map(|ip| ip.to_string()),
        "netmask": interface.address.netmask().map(|ip| ip.to_string()),
        "associatedAddress": interface.address.associated_address().map(|ip| ip.to_string()), "macAddress": mac,
        "up": interface.flags.contains(InterfaceFlags::UP), "running": interface.flags.contains(InterfaceFlags::RUNNING),
        "loopback": interface.flags.contains(InterfaceFlags::LOOPBACK), "multicast": interface.flags.contains(InterfaceFlags::MULTICAST),
        "pointToPoint": interface.flags.contains(InterfaceFlags::POINTTOPOINT), "flags": interface.flags.bits()});
    #[cfg(windows)]
    {
        row["description"] = json!(interface.description);
    }
    // Keep the same schema even when native friendly descriptions are absent.
    #[cfg(not(windows))]
    {
        row["description"] = Value::Null;
    }
    row
}

async fn interfaces() -> Result<Value, String> {
    let permit = INTERFACE_WORKERS
        .acquire()
        .await
        .map_err(|_| "Interface worker unavailable")?;
    tokio::task::spawn_blocking(move || {
        // A cancelled native enumeration cannot be preempted, but retains this
        // permit until completion, bounding outstanding OS calls to two.
        let _permit = permit;
        let mut rows: Vec<_> = getifaddrs::getifaddrs()
            .map_err(|e| format!("Interface enumeration failed: {e}"))?
            .take(4097)
            .map(interface_row)
            .collect();
        let truncated = rows.len() > 4096;
        rows.truncate(4096);
        rows.sort_by_key(|row| {
            (
                row["name"].as_str().unwrap_or_default().to_owned(),
                row["address"].to_string(),
                row["macAddress"].to_string(),
            )
        });
        Ok(json!({"source": "getifaddrs", "interfaces": rows, "truncated": truncated}))
    })
    .await
    .map_err(|e| format!("Interface worker failed: {e}"))?
}

fn service_type(value: &str) -> Result<(), String> {
    if value == "_services._dns-sd._udp" {
        return Ok(());
    }
    let parts: Vec<_> = value.split('.').collect();
    if parts.len() != 2
        || !matches!(parts[1], "_tcp" | "_udp")
        || !parts[0].starts_with('_')
        || !(2..=63).contains(&parts[0].len())
        || !parts[0][1..]
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err("serviceType must be a DNS-SD type such as _http._tcp".into());
    }
    Ok(())
}

fn traceroute_command(
    platform: &str,
    ip: IpAddr,
    hops: u64,
    wait_ms: u64,
) -> (&'static str, Vec<String>) {
    if platform == "windows" {
        (
            "tracert",
            vec![
                "-d".into(),
                "-h".into(),
                hops.to_string(),
                "-w".into(),
                wait_ms.to_string(),
                ip.to_string(),
            ],
        )
    } else {
        let program = if platform == "macos" && ip.is_ipv6() {
            "traceroute6"
        } else {
            "traceroute"
        };
        let mut args = vec![
            "-n".into(),
            "-m".into(),
            hops.to_string(),
            "-q".into(),
            "1".into(),
            "-w".into(),
            if platform == "macos" {
                // Apple's IPv4 and IPv6 tools both parse an integer >= 1.
                wait_ms.div_ceil(1000).max(1).to_string()
            } else {
                format!("{:.3}", wait_ms as f64 / 1000.0)
            },
        ];
        if platform == "linux" {
            args.extend(["-N".into(), "1".into()]);
            if ip.is_ipv6() {
                args.push("-6".into());
            }
        }
        args.push(ip.to_string());
        (program, args)
    }
}

fn iperf_args(request: &ToolkitRequest, ip: IpAddr) -> Result<Vec<String>, String> {
    if request.option("confirmTraffic") != Some("true") {
        return Err("iperf sends test traffic; confirmTraffic=true is required".into());
    }
    let port = request.number("port", 5201, 1, 65535)?;
    let seconds = request.number("durationSeconds", 5, 1, 30)?;
    let bandwidth = request.number("bandwidthMbps", 10, 1, 100)?;
    let mut args = vec![
        "--client".into(),
        ip.to_string(),
        "--port".into(),
        port.to_string(),
        "--time".into(),
        seconds.to_string(),
        "--parallel".into(),
        "1".into(),
        "--bitrate".into(),
        format!("{bandwidth}M"),
        "--json".into(),
        "--connect-timeout".into(),
        request.timeout_ms.min(5000).to_string(),
    ];
    if let Some(local) = request.option("localAddress") {
        let source: IpAddr = local
            .parse()
            .map_err(|_| "localAddress must be a local IP literal")?;
        if source.is_unspecified()
            || source.is_multicast()
            || matches!(source, IpAddr::V4(ip) if ip.is_broadcast())
            || source.is_ipv4() != ip.is_ipv4()
        {
            return Err("localAddress must be a unicast address of the target's IP family".into());
        }
        args.extend(["--bind".into(), source.to_string()]);
    }
    Ok(args)
}

async fn run_inner(request: &ToolkitRequest, deadline: Instant) -> Result<Value, String> {
    let platform = std::env::consts::OS;
    match request.tool.as_str() {
        "ping" => ping(request, deadline).await,
        "pingSweep" => sweep(request, deadline).await,
        "interfaces" => {
            options(request, &[])?;
            interfaces().await
        }
        "traceroute" => {
            options(request, &["maxHops", "hopTimeoutMs"])?;
            let hops = request.number("maxHops", 16, 1, 30)?;
            let wait = request.number("hopTimeoutMs", 1000, 100, 3000)?;
            let ip = address(&request.target).await?;
            let (program, args) = traceroute_command(platform, ip, hops, wait);
            Ok(json!({"address": ip.to_string(), "maxHops": hops,
                "requestedHopTimeoutMs": wait,
                "effectiveHopTimeoutMs": if platform == "macos" { wait.div_ceil(1000) * 1000 } else { wait },
                "probe": super::run_command(program, &args, command_budget(deadline)?).await?}))
        }
        "iperf" => {
            options(
                request,
                &[
                    "confirmTraffic",
                    "port",
                    "durationSeconds",
                    "bandwidthMbps",
                    "localAddress",
                ],
            )?;
            // Consent/numeric/source validation happens before DNS or traffic.
            let validation_ip = request
                .option("localAddress")
                .and_then(|ip| ip.parse().ok())
                .unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST));
            iperf_args(request, validation_ip)?;
            let addresses = super::resolve(&request.target, 1).await?;
            let local = request
                .option("localAddress")
                .map(str::parse::<IpAddr>)
                .transpose()
                .map_err(|_| "localAddress must be a local IP literal")?;
            let ip = addresses
                .into_iter()
                .map(|address| address.ip())
                .find(|ip| local.is_none_or(|local| local.is_ipv4() == ip.is_ipv4()))
                .ok_or("No resolved address matches the selected local IP family")?;
            let args = iperf_args(request, ip)?;
            let output =
                super::run_command("iperf3", &args, command_budget(deadline)?.min(35_000)).await?;
            let parsed = output["stdout"]
                .as_str()
                .and_then(|text| serde_json::from_str::<Value>(text).ok());
            Ok(
                json!({"address": ip.to_string(), "mode": "tcp-client", "output": output, "iperf": parsed,
                "note": "One paced client stream; command exitCode/timedOut and iperf error fields determine completion."}),
            )
        }
        "bonjour" => {
            options(request, &["serviceType"])?;
            let kind = request.option("serviceType");
            if let Some(kind) = kind {
                service_type(kind)?;
            }
            let (program, args) = if platform == "linux" {
                let args = match kind {
                    Some("_services._dns-sd._udp") | None => {
                        vec!["--all".into(), "--resolve".into(), "--terminate".into()]
                    }
                    Some(kind) => vec!["--resolve".into(), "--terminate".into(), kind.into()],
                };
                ("avahi-browse", args)
            } else {
                (
                    "dns-sd",
                    vec![
                        "-B".into(),
                        kind.unwrap_or("_services._dns-sd._udp").into(),
                        "local.".into(),
                    ],
                )
            };
            let observation_ms = command_budget(deadline)?.min(15_000);
            Ok(
                json!({"scope": "local-link DNS-SD browse", "observationWindowMs": observation_ms,
                "output": super::run_command(program, &args, observation_ms).await?,
                "note": "A bounded observation, not a complete inventory. dns-sd normally runs continuously; timeout output is retained. Requires the named OS utility/service."}),
            )
        }
        "netstat" | "routes" | "arp" => {
            options(request, &[])?;
            let (program, args): (&str, Vec<String>) = match (platform, request.tool.as_str()) {
                ("windows", "netstat") => ("netstat", vec!["-ano".into()]),
                ("linux", "netstat") => ("ss", vec!["-tuna".into()]),
                (_, "netstat") => ("netstat", vec!["-anv".into()]),
                ("windows", "routes") => ("route", vec!["PRINT".into()]),
                ("linux", "routes") => {
                    let mut output = Vec::new();
                    for family in ["-4", "-6"] {
                        output.push(
                            super::run_command(
                                "ip",
                                &[
                                    family.into(),
                                    "-j".into(),
                                    "route".into(),
                                    "show".into(),
                                    "table".into(),
                                    "all".into(),
                                ],
                                command_budget(deadline)?,
                            )
                            .await?,
                        );
                    }
                    return Ok(json!({"readOnly": true, "ipv4": output[0], "ipv6": output[1]}));
                }
                (_, "routes") => ("netstat", vec!["-rn".into()]),
                ("linux", "arp") => ("ip", vec!["-j".into(), "neigh".into(), "show".into()]),
                ("windows", "arp") => ("arp", vec!["-a".into()]),
                (_, "arp") => ("arp", vec!["-an".into()]),
                _ => return Err("Unsupported system diagnostic".into()),
            };
            Ok(
                json!({"readOnly": true, "output": super::run_command(program, &args, command_budget(deadline)?).await?}),
            )
        }
        _ => Err("Unknown system network tool".into()),
    }
}

pub async fn run(request: &ToolkitRequest) -> Result<Value, String> {
    if !(500..=90_000).contains(&request.timeout_ms) {
        return Err("Timeout must be between 500 and 90000 ms".into());
    }
    let deadline = Instant::now() + Duration::from_millis(request.timeout_ms);
    timeout_at(deadline, run_inner(request, deadline))
        .await
        .map_err(|_| {
            "System diagnostic deadline expired; unfinished probes cancelled".to_string()
        })?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn request(tool: &str) -> ToolkitRequest {
        ToolkitRequest {
            job_id: "test".into(),
            tool: tool.into(),
            target: "127.0.0.1".into(),
            timeout_ms: 500,
            route: "direct".into(),
            proxy_url: None,
            options: BTreeMap::new(),
        }
    }

    #[test]
    fn sweep_is_bounded_and_handles_31_32_without_network_broadcast_probes() {
        let (cidr, addresses) = sweep_addresses("192.0.2.129/24").unwrap();
        assert_eq!(cidr, "192.0.2.0/24");
        assert_eq!(addresses.len(), 254);
        assert_eq!(addresses[0], Ipv4Addr::new(192, 0, 2, 1));
        assert_eq!(addresses[253], Ipv4Addr::new(192, 0, 2, 254));
        assert_eq!(sweep_addresses("192.0.2.0/31").unwrap().1.len(), 2);
        assert_eq!(sweep_addresses("192.0.2.1/32").unwrap().1.len(), 1);
        for value in [
            "192.0.2.0/23",
            "192.0.2.0/33",
            "::1/128",
            "host/24",
            "224.0.0.0/24",
            "0.0.0.0/24",
            "255.255.255.255/32",
            "-a/24",
        ] {
            assert!(sweep_addresses(value).is_err(), "{value}");
        }
    }

    #[test]
    fn traceroute_uses_platform_specific_bounded_arguments_not_a_shell() {
        let ip: IpAddr = "2001:db8::1".parse().unwrap();
        for (platform, expected) in [
            ("windows", "tracert"),
            ("linux", "traceroute"),
            ("macos", "traceroute6"),
        ] {
            let (program, args) = traceroute_command(platform, ip, 16, 1500);
            assert_eq!(program, expected);
            assert_eq!(args.last().unwrap(), "2001:db8::1");
            assert!(args.contains(&"16".into()));
            assert!(args.contains(
                &if platform == "windows" {
                    "1500"
                } else if platform == "macos" {
                    "2"
                } else {
                    "1.500"
                }
                .into()
            ));
        }
        let (program, args) = traceroute_command("macos", "192.0.2.1".parse().unwrap(), 1, 100);
        assert_eq!(program, "traceroute");
        let wait_index = args.iter().position(|arg| arg == "-w").unwrap();
        assert_eq!(args[wait_index + 1], "1");
    }

    #[test]
    fn iperf_requires_consent_and_cannot_become_server_flood_or_unbounded() {
        let mut request = request("iperf");
        let ip = "127.0.0.1".parse().unwrap();
        assert!(iperf_args(&request, ip).is_err());
        request
            .options
            .insert("confirmTraffic".into(), "true".into());
        let args = iperf_args(&request, ip).unwrap();
        assert!(args.contains(&"--client".into()));
        assert!(args.contains(&"10M".into()));
        assert!(!args.contains(&"--server".into()));
        assert!(!args.contains(&"--udp".into()));
        for (key, value) in [
            ("durationSeconds", "31"),
            ("bandwidthMbps", "0"),
            ("bandwidthMbps", "101"),
            ("port", "65536"),
            ("localAddress", "0.0.0.0"),
            ("localAddress", "255.255.255.255"),
            ("localAddress", "::1"),
        ] {
            let mut bad = request.clone();
            bad.options.insert(key.into(), value.into());
            assert!(iperf_args(&bad, ip).is_err(), "{key}={value}");
        }
    }

    #[test]
    fn dns_sd_types_and_unknown_options_cannot_become_command_flags() {
        for good in ["_http._tcp", "_ipp._tcp", "_services._dns-sd._udp"] {
            service_type(good).unwrap();
        }
        for bad in [
            "--help",
            "_http._tcp;bad",
            "_x._tcp.local",
            "_x._tcp\n",
            "_._udp",
        ] {
            assert!(service_type(bad).is_err());
        }
        let mut request = request("iperf");
        request.options.insert("server".into(), "true".into());
        assert!(options(&request, &["confirmTraffic"]).is_err());
        request.options.clear();
        request.route = "httpProxy".into();
        assert!(options(&request, &[]).is_err());
    }

    #[tokio::test]
    async fn dangerous_or_unsupported_inputs_fail_before_io() {
        assert!(run(&request("iperf"))
            .await
            .unwrap_err()
            .contains("confirmTraffic"));
        let mut sweep = request("pingSweep");
        sweep.target = "192.0.2.0/16".into();
        assert!(run(&sweep).await.unwrap_err().contains("256"));
        sweep.target = "192.0.2.0/24".into();
        sweep.options.insert("concurrency".into(), "17".into());
        assert!(run(&sweep).await.unwrap_err().contains("concurrency"));
        let mut ping = request("ping");
        ping.route = "httpProxy".into();
        assert!(run(&ping).await.unwrap_err().contains("no proxy fallback"));
    }
}
