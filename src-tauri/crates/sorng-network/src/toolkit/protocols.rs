//! Small, bounded protocol probes. No mail, authentication, clock changes, or
//! DHCP lease allocation/release. Raw protocols never use an HTTP proxy fallback.
use super::types::ToolkitRequest;
use futures::{stream, StreamExt};
use getifaddrs::InterfaceFlags;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::ErrorKind;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpSocket, TcpStream, UdpSocket};
use tokio::sync::Semaphore;
use tokio::time::{timeout_at, Instant};

const NTP_EPOCH: f64 = 2_208_988_800.0;
const NTP_ERA: f64 = 4_294_967_296.0;
const DHCP_COOKIE: [u8; 4] = [99, 130, 83, 99];
static INTERFACE_WORKERS: Semaphore = Semaphore::const_new(2);

fn validate(request: &ToolkitRequest, allowed: &[&str]) -> Result<(), String> {
    if request.route != "direct" || request.proxy_url.as_deref().is_some_and(|s| !s.is_empty()) {
        return Err(
            "This protocol requires explicit direct networking; no HTTP proxy fallback.".into(),
        );
    }
    if let Some(key) = request
        .options
        .keys()
        .find(|key| !allowed.contains(&key.as_str()))
    {
        return Err(format!("{} does not support option {key}", request.tool));
    }
    super::validate_host(&request.target)
}

fn local_address(request: &ToolkitRequest) -> Result<Option<IpAddr>, String> {
    request
        .option("localAddress")
        .map(|value| {
            let ip: IpAddr = value
                .parse()
                .map_err(|_| "localAddress must be a local IP literal")?;
            if ip.is_unspecified()
                || ip.is_multicast()
                || matches!(ip, IpAddr::V4(ip) if ip.is_broadcast())
            {
                return Err("localAddress must be a specific unicast local IP address".into());
            }
            Ok(ip)
        })
        .transpose()
}

async fn endpoints(
    request: &ToolkitRequest,
    port: u16,
    local: Option<IpAddr>,
) -> Result<Vec<SocketAddr>, String> {
    let mut addresses = super::resolve(&request.target, port).await?;
    addresses.retain(|address| local.is_none_or(|local| local.is_ipv4() == address.is_ipv4()));
    addresses.sort();
    addresses.dedup();
    addresses.truncate(16);
    if addresses.is_empty() {
        return Err("No resolved address matches the selected local IP family".into());
    }
    Ok(addresses)
}

async fn connect(address: SocketAddr, local: Option<IpAddr>) -> std::io::Result<TcpStream> {
    let socket = if address.is_ipv4() {
        TcpSocket::new_v4()?
    } else {
        TcpSocket::new_v6()?
    };
    if let Some(local) = local {
        socket.bind(SocketAddr::new(local, 0))?;
    }
    socket.connect(address).await
}

async fn port_check(request: &ToolkitRequest, deadline: Instant) -> Result<Value, String> {
    validate(request, &["port", "localAddress"])?;
    let port = request.number("port", 0, 1, 65535)? as u16;
    let local = local_address(request)?;
    let addresses = endpoints(request, port, local).await?;
    let mut results = stream::iter(addresses).map(|address| async move {
        let started = Instant::now();
        let end = deadline.min(started + Duration::from_secs(3));
        let (status, error, local_endpoint) = match timeout_at(end, connect(address, local)).await {
            Ok(Ok(socket)) => ("open", None, socket.local_addr().ok().map(|address| address.to_string())),
            Ok(Err(error)) => (if error.kind() == ErrorKind::ConnectionRefused { "refused" } else { "error" }, Some(error.to_string()), None),
            Err(_) => ("timed-out", Some("TCP connect deadline expired".into()), None),
        };
        json!({"address": address.to_string(), "status": status, "error": error, "localAddress": local_endpoint,
            "elapsedMs": started.elapsed().as_millis() as u64})
    }).buffer_unordered(4).collect::<Vec<_>>().await;
    results.sort_by_key(|result| result["address"].as_str().unwrap_or_default().to_owned());
    Ok(
        json!({"transport": "tcp", "port": port, "openCount": results.iter().filter(|result| result["status"] == "open").count(),
        "results": results, "note": "TCP handshake only; an open port does not establish application protocol, authentication, or health."}),
    )
}

fn ehlo_name(value: &str) -> Result<&str, String> {
    if value.is_empty()
        || value.len() > 253
        || !value.trim_end_matches('.').split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'-')
        })
    {
        return Err("ehloName must be a hostname without whitespace or SMTP commands".into());
    }
    Ok(value)
}

#[derive(Debug)]
struct SmtpReply {
    code: u16,
    lines: Vec<String>,
}

async fn smtp_reply(reader: &mut BufReader<TcpStream>) -> Result<SmtpReply, String> {
    let mut code = None;
    let mut lines = Vec::new();
    for _ in 0..64 {
        let mut line = Vec::new();
        // RFC 5321: at most 512 octets including CRLF. Never read_until an
        // untrusted unbounded line into a growable buffer.
        for _ in 0..512 {
            let byte = reader
                .read_u8()
                .await
                .map_err(|error| format!("SMTP reply read failed: {error}"))?;
            line.push(byte);
            if byte == b'\n' {
                break;
            }
        }
        if !line.ends_with(b"\r\n") || line.len() < 5 {
            return Err("SMTP reply is oversized or not CRLF-terminated".into());
        }
        let text = &line[..line.len() - 2];
        if !(b'2'..=b'5').contains(&text[0]) || !text[..3].iter().all(u8::is_ascii_digit) {
            return Err("Malformed SMTP reply code".into());
        }
        let current = u16::from(text[0] - b'0') * 100
            + u16::from(text[1] - b'0') * 10
            + u16::from(text[2] - b'0');
        if code.is_some_and(|code| code != current) {
            return Err("Inconsistent SMTP multiline reply code".into());
        }
        code = Some(current);
        let continued = text.get(3) == Some(&b'-');
        if text.len() > 3 && !continued && text[3] != b' ' {
            return Err("Malformed SMTP reply separator".into());
        }
        lines.push(String::from_utf8_lossy(text.get(4..).unwrap_or_default()).into_owned());
        if !continued {
            return Ok(SmtpReply {
                code: current,
                lines,
            });
        }
    }
    Err("SMTP multiline reply exceeds 64 lines".into())
}

fn smtp_value(reply: &SmtpReply) -> Value {
    json!({"code": reply.code, "lines": reply.lines})
}

async fn smtp(request: &ToolkitRequest, deadline: Instant) -> Result<Value, String> {
    validate(request, &["port", "ehloName", "localAddress"])?;
    let port = request.number("port", 25, 1, 65535)? as u16;
    let name = ehlo_name(request.option("ehloName").unwrap_or("localhost"))?;
    let local = local_address(request)?;
    let addresses = endpoints(request, port, local).await?;
    let mut connection = None;
    let mut attempts = Vec::new();
    for address in addresses {
        if Instant::now() >= deadline {
            break;
        }
        match timeout_at(
            deadline.min(Instant::now() + Duration::from_secs(2)),
            connect(address, local),
        )
        .await
        {
            Ok(Ok(socket)) => {
                connection = Some((address, socket));
                break;
            }
            Ok(Err(error)) => {
                attempts.push(json!({"address": address.to_string(), "error": error.to_string()}))
            }
            Err(_) => attempts
                .push(json!({"address": address.to_string(), "error": "TCP connect timed out"})),
        }
    }
    let (peer, socket) = connection.ok_or_else(|| {
        format!(
            "SMTP connection failed for {} resolved endpoint(s)",
            attempts.len()
        )
    })?;
    let local_endpoint = socket.local_addr().map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(socket);
    let greeting = smtp_reply(&mut reader).await?;
    if greeting.code != 220 {
        return Ok(
            json!({"address": peer.to_string(), "status": "greeting-rejected", "greeting": smtp_value(&greeting), "commandsSent": []}),
        );
    }
    reader
        .get_mut()
        .write_all(format!("EHLO {name}\r\n").as_bytes())
        .await
        .map_err(|error| format!("SMTP EHLO write failed: {error}"))?;
    let ehlo = smtp_reply(&mut reader).await?;
    reader
        .get_mut()
        .write_all(b"QUIT\r\n")
        .await
        .map_err(|error| format!("SMTP QUIT write failed: {error}"))?;
    let quit = smtp_reply(&mut reader).await?;
    let starttls = ehlo.code == 250
        && ehlo.lines.iter().skip(1).any(|line| {
            line.split_whitespace()
                .next()
                .is_some_and(|word| word.eq_ignore_ascii_case("STARTTLS"))
        });
    Ok(
        json!({"address": peer.to_string(), "localAddress": local_endpoint.to_string(), "connectionAttempts": attempts,
        "status": if ehlo.code == 250 && quit.code == 221 { "completed" } else { "server-rejected-command" },
        "greeting": smtp_value(&greeting), "ehlo": smtp_value(&ehlo), "quit": smtp_value(&quit), "startTlsAdvertised": starttls,
        "commandsSent": ["EHLO", "QUIT"], "encrypted": false,
        "note": "Plaintext capability probe only. No STARTTLS negotiation, authentication, message submission, or delivery test."}),
    )
}

fn unix_seconds() -> Result<f64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|time| time.as_secs_f64())
        .map_err(|_| "Local system clock predates the Unix epoch".into())
}

fn ntp_timestamp(bytes: &[u8], reference_unix: f64) -> f64 {
    let seconds =
        u32::from_be_bytes(bytes[..4].try_into().expect("fixed NTP timestamp slice")) as f64;
    let fraction = u32::from_be_bytes(bytes[4..8].try_into().expect("fixed NTP timestamp slice"))
        as f64
        / NTP_ERA;
    let reference = reference_unix + NTP_EPOCH;
    let era = ((reference - seconds) / NTP_ERA).round();
    seconds + fraction + era * NTP_ERA - NTP_EPOCH
}

fn parse_ntp(
    packet: &[u8],
    nonce: &[u8; 8],
    sent: f64,
    received: f64,
    elapsed: f64,
) -> Result<Value, String> {
    if packet.len() != 48 {
        return Err(
            "NTP probe supports only the 48-byte base reply; extensions/MACs are not authenticated"
                .into(),
        );
    }
    let version = (packet[0] >> 3) & 7;
    let mode = packet[0] & 7;
    if !matches!(version, 3 | 4) || mode != 4 {
        return Err("NTP reply has an invalid version or is not server mode".into());
    }
    if &packet[24..32] != nonce {
        return Err("NTP originate nonce mismatch; unrelated/spoofed reply rejected".into());
    }
    if packet[1] == 0 {
        return Ok(
            json!({"status": "kiss-of-death", "kissCode": String::from_utf8_lossy(&packet[12..16]), "authenticated": false, "clockChanged": false}),
        );
    }
    if packet[0] >> 6 == 3 || packet[1] > 15 {
        return Err("NTP server is unsynchronized or has invalid stratum".into());
    }
    if packet[32..40] == [0; 8] || packet[40..48] == [0; 8] {
        return Err("NTP server timestamps must be nonzero".into());
    }
    if ((received - sent) - elapsed).abs() > 1.0 {
        return Err("Local wall clock changed during the NTP probe; offset is not valid".into());
    }
    let t2 = ntp_timestamp(&packet[32..40], received);
    let t3 = ntp_timestamp(&packet[40..48], received);
    let processing = t3 - t2;
    if processing < 0.0 || processing > elapsed + 0.010 {
        return Err("NTP server timestamps imply impossible processing time".into());
    }
    Ok(
        json!({"status": "reply-validated", "version": version, "stratum": packet[1], "leapIndicator": packet[0] >> 6,
        "serverTransmitUnixMs": t3 * 1000.0, "estimatedOffsetMs": ((t2 - sent) + (t3 - received)) * 500.0,
        "estimatedNetworkDelayMs": (elapsed - processing).max(0.0) * 1000.0, "roundTripMs": elapsed * 1000.0,
        "authenticated": false, "clockChanged": false,
        "note": "Single unauthenticated sample; nonce/source correlation is not server authentication. NTP era is inferred from the local clock."}),
    )
}

async fn ntp(request: &ToolkitRequest) -> Result<Value, String> {
    validate(request, &["port", "localAddress"])?;
    let port = request.number("port", 123, 1, 65535)? as u16;
    let local = local_address(request)?;
    let address = endpoints(request, port, local).await?[0];
    let bind = local.unwrap_or_else(|| {
        if address.is_ipv4() {
            IpAddr::V4(Ipv4Addr::UNSPECIFIED)
        } else {
            IpAddr::V6(std::net::Ipv6Addr::UNSPECIFIED)
        }
    });
    let socket = UdpSocket::bind(SocketAddr::new(bind, 0))
        .await
        .map_err(|error| format!("NTP local bind failed: {error}"))?;
    socket
        .connect(address)
        .await
        .map_err(|error| format!("NTP UDP connect failed: {error}"))?;
    // Data-minimized client request: unpredictable correlation cookie in xmt;
    // true local send/receive times are retained separately for offset arithmetic.
    let nonce: [u8; 8] = uuid::Uuid::new_v4().as_bytes()[..8]
        .try_into()
        .expect("UUID prefix");
    let mut query = [0_u8; 48];
    query[0] = 0x23;
    query[40..48].copy_from_slice(&nonce);
    let sent = unix_seconds()?;
    let start = Instant::now();
    socket
        .send(&query)
        .await
        .map_err(|error| format!("NTP send failed: {error}"))?;
    let mut buffer = [0_u8; 1025];
    let size = socket
        .recv(&mut buffer)
        .await
        .map_err(|error| format!("NTP receive failed: {error}"))?;
    let received = unix_seconds()?;
    let mut result = parse_ntp(
        &buffer[..size],
        &nonce,
        sent,
        received,
        start.elapsed().as_secs_f64(),
    )?;
    result["address"] = json!(address.to_string());
    result["localAddress"] = json!(socket
        .local_addr()
        .map_err(|error| error.to_string())?
        .to_string());
    Ok(result)
}

fn unicast_v4(value: &str) -> Result<Ipv4Addr, String> {
    let ip: Ipv4Addr = value
        .parse()
        .map_err(|_| "DHCP requires explicit IPv4 literals for server and localAddress")?;
    if ip.octets()[0] == 0 || ip.octets()[0] >= 224 || ip.is_broadcast() {
        return Err("DHCP requires unicast IPv4 addresses, not broadcast or multicast".into());
    }
    Ok(ip)
}

async fn interface_mac(local: Ipv4Addr) -> Result<([u8; 6], String), String> {
    let permit = INTERFACE_WORKERS
        .acquire()
        .await
        .map_err(|_| "Interface worker unavailable")?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let rows: Vec<_> = getifaddrs::getifaddrs()
            .map_err(|error| format!("DHCP interface enumeration failed: {error}"))?
            .take(4097)
            .collect();
        if rows.len() > 4096 {
            return Err("Interface inventory exceeds the probe limit".into());
        }
        let row = rows
            .iter()
            .find(|row| {
                row.address.ip_addr() == Some(IpAddr::V4(local))
                    && row.flags.contains(InterfaceFlags::UP)
            })
            .ok_or("localAddress is not assigned to an active local interface")?;
        let mac = rows
            .iter()
            .filter(|other| match (row.index, other.index) {
                (Some(a), Some(b)) => a == b,
                _ => row.name == other.name,
            })
            .filter_map(|row| row.address.mac_addr())
            .find(|mac| mac != &[0; 6] && mac[0] & 1 == 0)
            .ok_or("The selected interface has no usable Ethernet MAC for DHCPINFORM")?;
        Ok((mac, row.name.clone()))
    })
    .await
    .map_err(|error| format!("DHCP interface worker failed: {error}"))?
}

fn dhcp_inform(local: Ipv4Addr, mac: [u8; 6], xid: [u8; 4]) -> Vec<u8> {
    let mut packet = vec![0_u8; 240];
    packet[0] = 1;
    packet[1] = 1;
    packet[2] = 6;
    packet[4..8].copy_from_slice(&xid);
    packet[12..16].copy_from_slice(&local.octets());
    packet[28..34].copy_from_slice(&mac);
    packet[236..240].copy_from_slice(&DHCP_COOKIE);
    // Message type INFORM, parameter list, max message size, client identifier.
    // Never request an address, server selection, or lease time.
    packet.extend_from_slice(&[
        53, 1, 8, 55, 6, 1, 3, 6, 15, 28, 42, 57, 2, 4, 192, 61, 7, 1,
    ]);
    packet.extend_from_slice(&mac);
    packet.push(255);
    packet.resize(300, 0);
    packet
}

fn dhcp_options(
    bytes: &[u8],
    options: &mut BTreeMap<u8, Vec<u8>>,
    allow_overload: bool,
) -> Result<(), String> {
    let mut cursor = 0;
    while cursor < bytes.len() {
        let code = bytes[cursor];
        cursor += 1;
        if code == 0 {
            continue;
        }
        if code == 255 {
            if bytes[cursor..].iter().any(|byte| *byte != 0) {
                return Err("Non-padding bytes after DHCP END option".into());
            }
            return Ok(());
        }
        if code == 52 && !allow_overload {
            return Err("Nested DHCP option overload is invalid".into());
        }
        let length = *bytes.get(cursor).ok_or("Truncated DHCP option length")? as usize;
        cursor += 1;
        let value = bytes
            .get(cursor..cursor + length)
            .ok_or("Truncated DHCP option value")?;
        cursor += length;
        if length == 0 {
            return Err("Empty DHCP option value".into());
        }
        if matches!(code, 52..=54) && options.contains_key(&code) {
            return Err("Duplicate DHCP control option".into());
        }
        // RFC 3396: concatenate fragments for non-control options.
        options.entry(code).or_default().extend_from_slice(value);
    }
    Err("DHCP options have no END marker".into())
}

fn ipv4_option(options: &BTreeMap<u8, Vec<u8>>, code: u8, single: bool) -> Result<Value, String> {
    let Some(value) = options.get(&code) else {
        return Ok(Value::Null);
    };
    if value.len() % 4 != 0 || (single && value.len() != 4) {
        return Err(format!("Invalid IPv4 length in DHCP option {code}"));
    }
    let addresses: Vec<_> = value
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| Ipv4Addr::new(b[0], b[1], b[2], b[3]).to_string())
        .collect();
    Ok(if single {
        json!(addresses[0])
    } else {
        json!(addresses)
    })
}

fn parse_dhcp(packet: &[u8], local: Ipv4Addr, mac: [u8; 6], xid: [u8; 4]) -> Result<Value, String> {
    if !(240..=4096).contains(&packet.len()) {
        return Err("DHCP reply length is outside the bounded packet size".into());
    }
    if packet[0..3] != [2, 1, 6] || packet[4..8] != xid || packet[28..34] != mac {
        return Err("DHCP reply operation/hardware/transaction identity mismatch".into());
    }
    if packet[236..240] != DHCP_COOKIE {
        return Err("DHCP magic cookie mismatch".into());
    }
    if packet[12..16] != local.octets() || packet[16..20] != [0; 4] {
        return Err("DHCPINFORM reply must echo ciaddr and must not allocate yiaddr".into());
    }
    let mut options = BTreeMap::new();
    dhcp_options(&packet[240..], &mut options, true)?;
    if let Some(overload) = options.get(&52).cloned() {
        if overload.len() != 1 || !(1..=3).contains(&overload[0]) {
            return Err("Invalid DHCP option overload".into());
        }
        if overload[0] & 1 != 0 {
            dhcp_options(&packet[108..236], &mut options, false)?;
        }
        if overload[0] & 2 != 0 {
            dhcp_options(&packet[44..108], &mut options, false)?;
        }
    }
    if options.get(&53).map(Vec::as_slice) != Some(&[5][..]) {
        return Err("Expected DHCPACK in response to DHCPINFORM".into());
    }
    if [51, 58, 59].iter().any(|code| options.contains_key(code)) {
        return Err(
            "DHCPINFORM reply unexpectedly contains lease timers; no settings applied".into(),
        );
    }
    let server = ipv4_option(&options, 54, true)?;
    let server_text = server
        .as_str()
        .ok_or("DHCPACK is missing the server identifier")?;
    unicast_v4(server_text)?;
    Ok(
        json!({"status": "inform-acknowledged", "messageType": "DHCPACK", "serverIdentifier": server,
        "subnetMask": ipv4_option(&options, 1, true)?, "routers": ipv4_option(&options, 3, false)?,
        "dnsServers": ipv4_option(&options, 6, false)?, "ntpServers": ipv4_option(&options, 42, false)?,
        "broadcastAddress": ipv4_option(&options, 28, true)?, "domainName": options.get(&15).map(|bytes| String::from_utf8_lossy(bytes).into_owned()),
        "optionCodes": options.keys().copied().collect::<Vec<_>>(), "leaseRequested": false, "settingsApplied": false,
        "authenticated": false, "note": "DHCPINFORM only; no address allocation/release and no host configuration changes. Source/transaction checks are not server authentication."}),
    )
}

async fn dhcp(request: &ToolkitRequest) -> Result<Value, String> {
    validate(request, &["confirmTraffic", "localAddress"])?;
    if request.option("confirmTraffic") != Some("true") {
        return Err("DHCPINFORM sends one request; confirmTraffic=true is required".into());
    }
    let server = unicast_v4(&request.target)?;
    let local = unicast_v4(
        request
            .option("localAddress")
            .ok_or("DHCPINFORM requires the existing localAddress explicitly")?,
    )?;
    let (mac, interface) = interface_mac(local).await?;
    let socket = UdpSocket::bind((local, 68)).await.map_err(|error| format!("Cannot bind {local}:68 for DHCPINFORM: {error}. UDP port 68 may require elevated privileges or already belong to the OS DHCP client; no alternate port, broadcast, or lease request was attempted."))?;
    socket
        .connect((server, 67))
        .await
        .map_err(|error| format!("DHCP server connection failed: {error}"))?;
    let xid: [u8; 4] = uuid::Uuid::new_v4().as_bytes()[..4]
        .try_into()
        .expect("UUID prefix");
    socket
        .send(&dhcp_inform(local, mac, xid))
        .await
        .map_err(|error| format!("DHCPINFORM send failed: {error}"))?;
    let mut buffer = [0_u8; 4097];
    let size = socket
        .recv(&mut buffer)
        .await
        .map_err(|error| format!("DHCP reply receive failed: {error}"))?;
    let mut result = parse_dhcp(&buffer[..size], local, mac, xid)?;
    result["address"] = json!(format!("{server}:67"));
    result["localAddress"] = json!(format!("{local}:68"));
    result["interface"] = json!(interface);
    Ok(result)
}

pub async fn run(request: &ToolkitRequest) -> Result<Value, String> {
    if !(500..=90_000).contains(&request.timeout_ms) {
        return Err("Timeout must be between 500 and 90000 ms".into());
    }
    let deadline = Instant::now() + Duration::from_millis(request.timeout_ms);
    timeout_at(deadline, async {
        match request.tool.as_str() {
            "portCheck" => port_check(request, deadline).await,
            "smtp" => smtp(request, deadline).await,
            "ntp" => ntp(request).await,
            "dhcp" => dhcp(request).await,
            _ => Err("Unknown protocol diagnostic".into()),
        }
    })
    .await
    .map_err(|_| {
        "Protocol diagnostic deadline expired; socket closed without fallback".to_string()
    })?
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::AsyncBufReadExt;
    use tokio::net::TcpListener;

    fn request(tool: &str, port: u16) -> ToolkitRequest {
        ToolkitRequest {
            job_id: "test".into(),
            tool: tool.into(),
            target: "127.0.0.1".into(),
            timeout_ms: 2000,
            route: "direct".into(),
            proxy_url: None,
            options: BTreeMap::from([("port".into(), port.to_string())]),
        }
    }

    fn timestamp(unix: f64) -> [u8; 8] {
        let ntp = unix + NTP_EPOCH;
        let mut bytes = [0; 8];
        bytes[..4].copy_from_slice(&((ntp.floor() as u64) as u32).to_be_bytes());
        bytes[4..].copy_from_slice(&((ntp.fract() * NTP_ERA) as u32).to_be_bytes());
        bytes
    }

    fn ntp_reply(nonce: [u8; 8], now: f64) -> [u8; 48] {
        let mut packet = [0; 48];
        packet[0] = 0x24;
        packet[1] = 2;
        packet[24..32].copy_from_slice(&nonce);
        packet[32..40].copy_from_slice(&timestamp(now + 0.02));
        packet[40..48].copy_from_slice(&timestamp(now + 0.03));
        packet
    }

    #[test]
    fn ntp_checks_nonce_mode_version_sync_stratum_length_and_time_order() {
        let now = 1_790_000_000.0;
        let nonce = [7; 8];
        let good = ntp_reply(nonce, now);
        let result = parse_ntp(&good, &nonce, now, now + 0.1, 0.1).unwrap();
        assert_eq!(result["authenticated"], false);
        assert_eq!(result["clockChanged"], false);
        for (index, byte) in [(0, 0x23), (0, 0x14), (0, 0xe4), (1, 16), (24, 0)] {
            let mut bad = good;
            bad[index] = byte;
            assert!(parse_ntp(&bad, &nonce, now, now + 0.1, 0.1).is_err());
        }
        assert!(parse_ntp(&good[..47], &nonce, now, now + 0.1, 0.1).is_err());
        let mut bad = good;
        bad[40..48].fill(0);
        assert!(parse_ntp(&bad, &nonce, now, now + 0.1, 0.1).is_err());
        let mut bad = good;
        bad[32..40].copy_from_slice(&timestamp(now + 5.0));
        assert!(parse_ntp(&bad, &nonce, now, now + 0.1, 0.1).is_err());
        assert!(parse_ntp(&good, &nonce, now, now + 5.0, 0.1).is_err());
        let mut kod = good;
        kod[1] = 0;
        kod[12..16].copy_from_slice(b"RATE");
        assert_eq!(
            parse_ntp(&kod, &nonce, now, now + 0.1, 0.1).unwrap()["status"],
            "kiss-of-death"
        );
    }

    #[test]
    fn ntp_era_unfolding_handles_2036_rollover() {
        for now in [1_790_000_000.25, 2_090_000_000.5, 2_200_000_000.75] {
            assert!((ntp_timestamp(&timestamp(now), now) - now).abs() < 0.000001);
        }
    }

    #[tokio::test]
    async fn ntp_loopback_validates_a_real_udp_response_without_clock_changes() {
        let server = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let request = request("ntp", server.local_addr().unwrap().port());
        let task = tokio::spawn(async move {
            let mut query = [0; 48];
            let (size, peer) = server.recv_from(&mut query).await.unwrap();
            assert_eq!(size, 48);
            assert_eq!(query[0], 0x23);
            assert_ne!(&query[40..48], &[0; 8]);
            let now = unix_seconds().unwrap();
            let mut reply = ntp_reply(query[40..48].try_into().unwrap(), now);
            reply[32..40].copy_from_slice(&timestamp(now));
            reply[40..48].copy_from_slice(&timestamp(now));
            server.send_to(&reply, peer).await.unwrap();
        });
        let result = run(&request).await.unwrap();
        task.await.unwrap();
        assert_eq!(result["status"], "reply-validated");
        assert_eq!(result["clockChanged"], false);
    }

    #[tokio::test]
    async fn tcp_open_is_only_a_handshake_and_selected_local_address_is_applied() {
        let server = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut request = request("portCheck", server.local_addr().unwrap().port());
        request
            .options
            .insert("localAddress".into(), "127.0.0.1".into());
        let result = run(&request).await.unwrap();
        assert_eq!(result["openCount"], 1);
        assert!(result["results"][0]["localAddress"]
            .as_str()
            .unwrap()
            .starts_with("127.0.0.1:"));
        let (mut client, _) = server.accept().await.unwrap();
        let mut byte = [0; 1];
        assert_eq!(client.read(&mut byte).await.unwrap(), 0);
    }

    #[tokio::test]
    async fn smtp_loopback_only_sends_ehlo_and_quit_and_parses_multiline_capabilities() {
        let server = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let request = request("smtp", server.local_addr().unwrap().port());
        let task = tokio::spawn(async move {
            let (socket, _) = server.accept().await.unwrap();
            let mut reader = BufReader::new(socket);
            reader
                .get_mut()
                .write_all(b"220 fixture ESMTP\r\n")
                .await
                .unwrap();
            let mut command = String::new();
            reader.read_line(&mut command).await.unwrap();
            assert_eq!(command, "EHLO localhost\r\n");
            reader
                .get_mut()
                .write_all(b"250-fixture\r\n250-STARTTLS\r\n250 SIZE 1234\r\n")
                .await
                .unwrap();
            command.clear();
            reader.read_line(&mut command).await.unwrap();
            assert_eq!(command, "QUIT\r\n");
            reader.get_mut().write_all(b"221 bye\r\n").await.unwrap();
            command.clear();
            assert_eq!(reader.read_line(&mut command).await.unwrap(), 0);
        });
        let result = run(&request).await.unwrap();
        task.await.unwrap();
        assert_eq!(result["status"], "completed");
        assert_eq!(result["startTlsAdvertised"], true);
        assert_eq!(result["encrypted"], false);
        assert_eq!(result["commandsSent"], json!(["EHLO", "QUIT"]));
    }

    #[tokio::test]
    async fn smtp_timeout_closes_the_socket_without_sending_before_a_greeting() {
        let server = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut request = request("smtp", server.local_addr().unwrap().port());
        request.timeout_ms = 500;
        let task = tokio::spawn(async move {
            let (mut socket, _) = server.accept().await.unwrap();
            let mut byte = [0; 1];
            // Deliberately withhold the greeting. Expiry must close the
            // connection, not issue EHLO or leave a detached socket behind.
            assert_eq!(socket.read(&mut byte).await.unwrap(), 0);
        });
        assert!(run(&request)
            .await
            .unwrap_err()
            .contains("deadline expired"));
        tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .expect("SMTP socket must close on timeout")
            .unwrap();
    }

    #[tokio::test]
    async fn smtp_malformed_or_unbounded_replies_are_rejected() {
        for bytes in [
            b"220-begin\r\n250 wrong code\r\n".to_vec(),
            vec![b'x'; 513],
            b"220 bare newline\n".to_vec(),
            b"220!invalid\r\n".to_vec(),
            b"220-continue\r\n".repeat(65),
        ] {
            let server = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let request = request("smtp", server.local_addr().unwrap().port());
            let task = tokio::spawn(async move {
                let (mut socket, _) = server.accept().await.unwrap();
                let _ = socket.write_all(&bytes).await;
            });
            assert!(run(&request).await.is_err());
            task.await.unwrap();
        }
    }

    fn dhcp_ack() -> (Vec<u8>, Ipv4Addr, [u8; 6], [u8; 4]) {
        let local = Ipv4Addr::new(192, 0, 2, 2);
        let mac = [2, 1, 2, 3, 4, 5];
        let xid = [1, 2, 3, 4];
        let mut packet = dhcp_inform(local, mac, xid);
        packet[0] = 2;
        packet.truncate(240);
        packet.extend_from_slice(&[
            53, 1, 5, 54, 4, 192, 0, 2, 1, 1, 4, 255, 255, 255, 0, 6, 4, 192, 0, 2, 53, 255,
        ]);
        (packet, local, mac, xid)
    }

    #[test]
    fn dhcp_inform_cannot_allocate_release_or_broadcast_a_lease() {
        let (_, local, mac, xid) = dhcp_ack();
        let packet = dhcp_inform(local, mac, xid);
        assert_eq!(packet.len(), 300);
        assert_eq!(&packet[10..12], &[0, 0]);
        assert_eq!(&packet[16..28], &[0; 12]);
        assert_eq!(&packet[12..16], &local.octets());
        let mut options = BTreeMap::new();
        dhcp_options(&packet[240..], &mut options, true).unwrap();
        assert_eq!(options[&53], vec![8]);
        for code in [50, 51, 54, 58, 59] {
            assert!(!options.contains_key(&code));
        }
    }

    #[test]
    fn dhcp_ack_is_transaction_bound_and_rejects_malformed_or_lease_responses() {
        let (good, local, mac, xid) = dhcp_ack();
        assert_eq!(
            parse_dhcp(&good, local, mac, xid).unwrap()["leaseRequested"],
            false
        );
        for (index, byte) in [
            (0, 1),
            (1, 0),
            (2, 0),
            (4, 99),
            (12, 0),
            (16, 1),
            (28, 99),
            (236, 0),
            (242, 2),
        ] {
            let mut bad = good.clone();
            bad[index] = byte;
            assert!(parse_dhcp(&bad, local, mac, xid).is_err(), "{index}");
        }
        for suffix in [
            vec![53, 1, 5, 255],
            vec![51, 4, 0, 0, 0, 1, 255],
            vec![3, 3, 1, 2, 3, 255],
            vec![15, 10, 1, 255],
            vec![0],
        ] {
            let mut bad = good.clone();
            bad.pop();
            bad.extend(suffix);
            assert!(parse_dhcp(&bad, local, mac, xid).is_err());
        }
        assert!(parse_dhcp(&good[..239], local, mac, xid).is_err());
        assert!(parse_dhcp(&vec![0; 4097], local, mac, xid).is_err());
    }

    #[test]
    fn dhcp_overloaded_options_are_bounded_and_noncontrol_fragments_concatenate() {
        let (mut packet, local, mac, xid) = dhcp_ack();
        packet.pop();
        packet.extend_from_slice(&[52, 1, 1, 255]);
        packet[108..118].copy_from_slice(&[15, 3, b'l', b'a', b'b', 15, 1, b'.', 255, 0]);
        assert_eq!(
            parse_dhcp(&packet, local, mac, xid).unwrap()["domainName"],
            "lab."
        );
        packet[108] = 52;
        assert!(parse_dhcp(&packet, local, mac, xid).is_err());
    }

    #[tokio::test]
    async fn protocol_options_consent_and_route_validation_precede_network_io() {
        let mut smtp = request("smtp", 25);
        smtp.options
            .insert("ehloName".into(), "host\r\nMAIL FROM:test".into());
        assert!(run(&smtp).await.unwrap_err().contains("ehloName"));
        let mut dhcp = request("dhcp", 67);
        dhcp.options.clear();
        assert!(run(&dhcp).await.unwrap_err().contains("confirmTraffic"));
        dhcp.options.insert("confirmTraffic".into(), "true".into());
        dhcp.target = "255.255.255.255".into();
        assert!(run(&dhcp).await.unwrap_err().contains("unicast"));
        for tool in ["portCheck", "smtp", "ntp", "dhcp"] {
            let mut request = request(tool, 1);
            request.route = "httpProxy".into();
            assert!(run(&request)
                .await
                .unwrap_err()
                .contains("no HTTP proxy fallback"));
        }
        for value in ["0.0.0.0", "224.0.0.1", "255.255.255.255", "hostname"] {
            let mut request = request("ntp", 123);
            request.options.insert("localAddress".into(), value.into());
            assert!(run(&request).await.is_err());
        }
    }
}
