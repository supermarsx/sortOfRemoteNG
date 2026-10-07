//! Explicit-resolver DNS diagnostics. No resolver fallback, global cache, or
//! inference that a transport/provider failure means a name is not listed.
use super::types::ToolkitRequest;
use serde_json::{json, Value};
use sorng_dns::{wire, DnsQuery, DnsRecordType};
use std::{
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpStream, UdpSocket},
};

const MAX_RECORDS: usize = 256;
const MAX_PACKET: usize = 65_535;

fn name(value: &str) -> Result<String, String> {
    let value = value.strip_suffix('.').unwrap_or(value);
    if value.is_empty()
        || value.len() > 253
        || !value.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_'))
        })
    {
        return Err(
            "Use an ASCII DNS name (IDNs must use punycode); labels must be 1–63 bytes.".into(),
        );
    }
    Ok(value.to_ascii_lowercase())
}

fn resolver(value: &str) -> Result<SocketAddr, String> {
    let endpoint = value
        .parse::<SocketAddr>()
        .or_else(|_| value.parse::<IpAddr>().map(|ip| SocketAddr::new(ip, 53)))
        .map_err(|_| {
            "Resolver must be an explicit IP address, optionally with a port; use [IPv6]:port."
        })?;
    if endpoint.port() == 0 || endpoint.ip().is_unspecified() || endpoint.ip().is_multicast() {
        return Err("Resolver must be a unicast address with a nonzero port.".into());
    }
    Ok(endpoint)
}

fn list(value: &str, max: usize) -> Result<Vec<&str>, String> {
    if value.len() > 4096 {
        return Err("DNS option is too long.".into());
    }
    let items: Vec<_> = value
        .split(|c: char| c == ',' || c.is_ascii_whitespace())
        .filter(|s| !s.is_empty())
        .collect();
    if items.is_empty() || items.len() > max {
        return Err(format!("Provide between 1 and {max} entries."));
    }
    Ok(items)
}

fn u16_at(data: &[u8], pos: usize) -> Result<u16, String> {
    let bytes = data.get(pos..pos + 2).ok_or("Truncated DNS integer")?;
    Ok(u16::from_be_bytes([bytes[0], bytes[1]]))
}
fn u32_at(data: &[u8], pos: usize) -> Result<u32, String> {
    let bytes = data.get(pos..pos + 4).ok_or("Truncated DNS integer")?;
    Ok(u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

/// Strict bounded decoding in front of untrusted diagnostic replies. The shared
/// wire encoder is reused; its permissive response parser does not enforce
/// transaction/question identity or individual RDATA boundaries.
fn read_name(data: &[u8], cursor: &mut usize) -> Result<String, String> {
    let mut at = *cursor;
    let mut jumped = false;
    let mut labels = Vec::new();
    let mut length = 1usize;
    for _ in 0..128 {
        let first = *data.get(at).ok_or("Truncated DNS name")?;
        if first == 0 {
            if !jumped {
                *cursor = at + 1;
            }
            return Ok(labels.join("."));
        }
        if first & 0xc0 == 0xc0 {
            let next = *data.get(at + 1).ok_or("Truncated compression pointer")?;
            let pointer = (((first & 0x3f) as usize) << 8) | next as usize;
            if pointer >= at || pointer < 12 {
                return Err("Invalid/forward DNS compression pointer".into());
            }
            if !jumped {
                *cursor = at + 2;
                jumped = true;
            }
            at = pointer;
        } else {
            if first & 0xc0 != 0 {
                return Err("Unsupported DNS label encoding".into());
            }
            let count = first as usize;
            let bytes = data
                .get(at + 1..at + 1 + count)
                .ok_or("Truncated DNS label")?;
            if !bytes
                .iter()
                .all(|b| b.is_ascii_graphic() && !matches!(b, b'.' | b'\\'))
            {
                return Err("Unsupported binary DNS label".into());
            }
            length += count + 1;
            if length > 255 {
                return Err("Expanded DNS name exceeds 255 bytes".into());
            }
            labels.push(String::from_utf8_lossy(bytes).to_ascii_lowercase());
            at += count + 1;
        }
    }
    Err("DNS compression exceeds traversal limit".into())
}

fn rdata(data: &[u8], start: usize, end: usize, kind: u16) -> Result<Value, String> {
    let bytes = &data[start..end];
    let mut at = start;
    let value = match kind {
        1 if bytes.len() == 4 => {
            json!({"address": Ipv4Addr::new(bytes[0], bytes[1], bytes[2], bytes[3]).to_string()})
        }
        28 if bytes.len() == 16 => {
            let mut octets = [0; 16];
            octets.copy_from_slice(bytes);
            json!({"address": Ipv6Addr::from(octets).to_string()})
        }
        1 | 28 => return Err("Invalid address RDATA length".into()),
        2 | 5 | 12 => {
            let target = read_name(data, &mut at)?;
            if at != end {
                return Err("Name RDATA length mismatch".into());
            }
            json!({"target": target})
        }
        15 if bytes.len() >= 3 => {
            let preference = u16_at(data, at)?;
            at += 2;
            let exchange = read_name(data, &mut at)?;
            if at != end {
                return Err("MX RDATA length mismatch".into());
            }
            json!({"preference": preference, "exchange": exchange})
        }
        33 if bytes.len() >= 7 => {
            let priority = u16_at(data, at)?;
            let weight = u16_at(data, at + 2)?;
            let port = u16_at(data, at + 4)?;
            at += 6;
            let target = read_name(data, &mut at)?;
            if at != end {
                return Err("SRV RDATA length mismatch".into());
            }
            json!({"priority": priority, "weight": weight, "port": port, "target": target})
        }
        6 => {
            let primary = read_name(data, &mut at)?;
            if at >= end {
                return Err("Truncated SOA RDATA".into());
            }
            let mailbox = read_name(data, &mut at)?;
            if at + 20 != end {
                return Err("SOA RDATA length mismatch".into());
            }
            json!({"primary": primary, "mailbox": mailbox, "serial": u32_at(data, at)?, "refresh": u32_at(data, at + 4)?,
                "retry": u32_at(data, at + 8)?, "expire": u32_at(data, at + 12)?, "minimum": u32_at(data, at + 16)?})
        }
        16 => {
            let mut texts = Vec::new();
            while at < end {
                let count = data[at] as usize;
                at += 1;
                if at + count > end {
                    return Err("TXT chunk exceeds RDATA".into());
                }
                texts.push(String::from_utf8_lossy(&data[at..at + count]).into_owned());
                at += count;
            }
            json!({"strings": texts, "textEncoding": "UTF-8 with replacement for binary bytes"})
        }
        257 if bytes.len() >= 2 && (bytes[1] as usize) <= bytes.len() - 2 => {
            let boundary = 2 + bytes[1] as usize;
            json!({"flags": bytes[0], "tag": String::from_utf8_lossy(&bytes[2..boundary]), "value": String::from_utf8_lossy(&bytes[boundary..])})
        }
        15 | 33 | 257 => return Err("Truncated typed DNS RDATA".into()),
        _ => {
            json!({"encoding": "hex", "value": bytes.iter().map(|b| format!("{b:02x}")).collect::<String>(), "parsed": false})
        }
    };
    Ok(value)
}

fn question_end(data: &[u8], id: u16, query: &str, kind: u16) -> Result<(usize, u16), String> {
    if data.len() < 12 || data.len() > MAX_PACKET {
        return Err("Invalid DNS packet length".into());
    }
    let flags = u16_at(data, 2)?;
    if u16_at(data, 0)? != id || flags & 0x8000 == 0 || flags & 0x7800 != 0 || u16_at(data, 4)? != 1
    {
        return Err("DNS reply transaction/header mismatch".into());
    }
    let mut at = 12;
    if read_name(data, &mut at)? != query || u16_at(data, at)? != kind || u16_at(data, at + 2)? != 1
    {
        return Err("DNS reply question mismatch".into());
    }
    Ok((at + 4, flags))
}

fn parse_reply(data: &[u8], id: u16, query: &str, kind: u16) -> Result<Value, String> {
    let (mut at, flags) = question_end(data, id, query, kind)?;
    if flags & 0x0200 != 0 {
        return Err("DNS response remains truncated".into());
    }
    let counts = [u16_at(data, 6)?, u16_at(data, 8)?, u16_at(data, 10)?];
    if counts.iter().map(|c| *c as usize).sum::<usize>() > MAX_RECORDS {
        return Err("DNS reply exceeds 256 records".into());
    }
    let mut sections = Vec::new();
    for count in counts {
        let mut records = Vec::new();
        for _ in 0..count {
            let owner = read_name(data, &mut at)?;
            let code = u16_at(data, at)?;
            let class = u16_at(data, at + 2)?;
            let ttl = u32_at(data, at + 4)?;
            let size = u16_at(data, at + 8)? as usize;
            at += 10;
            let end = at
                .checked_add(size)
                .filter(|end| *end <= data.len())
                .ok_or("Truncated DNS RDATA")?;
            if code == 41 {
                // Queries do not request EDNS. Do not misinterpret an extended
                // provider error as NOERROR/not-listed.
                if ttl >> 24 != 0 {
                    return Err("Extended DNS error response".into());
                }
            } else {
                if class != 1 {
                    return Err("Unexpected DNS record class".into());
                }
                records.push(json!({"name": owner, "type": DnsRecordType::from_type_code(code).map(|k| k.as_str().to_string()).unwrap_or_else(|| format!("TYPE{code}")),
                    "typeCode": code, "ttl": ttl, "data": rdata(data, at, end, code)?}));
            }
            at = end;
        }
        sections.push(records);
    }
    if at != data.len() {
        return Err("Unexpected trailing DNS packet bytes".into());
    }
    Ok(
        json!({"rcode": flags & 15, "rcodeName": format!("{:?}", sorng_dns::DnsRcode::from_code(flags & 15)),
        "authoritative": flags & 0x0400 != 0, "recursionAvailable": flags & 0x0080 != 0,
        "authenticatedDataClaim": flags & 0x0020 != 0, "dnssecLocallyValidated": false,
        "answers": sections[0], "authority": sections[1], "additional": sections[2]}),
    )
}

async fn tcp_exchange(server: SocketAddr, packet: &[u8]) -> Result<Vec<u8>, String> {
    let mut stream = TcpStream::connect(server)
        .await
        .map_err(|e| format!("DNS TCP connection failed: {e}"))?;
    stream
        .write_all(&(packet.len() as u16).to_be_bytes())
        .await
        .map_err(|_| "DNS TCP query failed")?;
    stream
        .write_all(packet)
        .await
        .map_err(|_| "DNS TCP query failed")?;
    let size = stream
        .read_u16()
        .await
        .map_err(|_| "Missing DNS TCP frame")? as usize;
    if !(12..=MAX_PACKET).contains(&size) {
        return Err("Invalid DNS TCP frame size".into());
    }
    let mut reply = vec![0; size];
    stream
        .read_exact(&mut reply)
        .await
        .map_err(|_| "Truncated DNS TCP frame")?;
    Ok(reply)
}

async fn query(
    server: SocketAddr,
    query: &str,
    kind: DnsRecordType,
    transport: &str,
    timeout_ms: u64,
) -> Result<Value, String> {
    let start = Instant::now();
    let id = u16::from_be_bytes(uuid::Uuid::new_v4().as_bytes()[..2].try_into().unwrap());
    let packet = wire::build_query(&DnsQuery::new(query, kind), id, false, 0);
    let work = async {
        let mut used = transport;
        let mut reply = if transport == "tcp" {
            tcp_exchange(server, &packet).await?
        } else {
            let bind = if server.is_ipv4() {
                "0.0.0.0:0"
            } else {
                "[::]:0"
            };
            let socket = UdpSocket::bind(bind)
                .await
                .map_err(|_| "DNS UDP socket unavailable")?;
            // A connected socket filters packets from other source addresses.
            socket
                .connect(server)
                .await
                .map_err(|_| "DNS UDP resolver unavailable")?;
            socket
                .send(&packet)
                .await
                .map_err(|_| "DNS UDP query failed")?;
            let mut bytes = vec![0; MAX_PACKET];
            let size = socket
                .recv(&mut bytes)
                .await
                .map_err(|_| "DNS UDP reply failed")?;
            bytes.truncate(size);
            bytes
        };
        let (_, flags) = question_end(&reply, id, query, kind.type_code())?;
        if flags & 0x0200 != 0 && transport == "udp" {
            used = "tcp";
            reply = tcp_exchange(server, &packet).await?;
        }
        let mut result = parse_reply(&reply, id, query, kind.type_code())?;
        result["resolver"] = json!(server.to_string());
        result["transport"] = json!(used);
        result["durationMs"] = json!(start.elapsed().as_millis() as u64);
        Ok(result)
    };
    tokio::time::timeout(Duration::from_millis(timeout_ms.clamp(1, 60_000)), work)
        .await
        .map_err(|_| "DNS query timed out; no other resolver was contacted".to_string())?
}

fn listing_status(reply: &Value, query_name: &str) -> &'static str {
    if reply["rcode"] == 3 {
        return "notListed";
    }
    if reply["rcode"] != 0 {
        return "error";
    }
    let Some(answers) = reply["answers"].as_array() else {
        return "indeterminate";
    };
    if answers.is_empty() {
        return "noData";
    }
    let mut listed = false;
    for answer in answers {
        if answer["name"] != query_name || answer["typeCode"] != 1 {
            return "indeterminate";
        }
        let Some(ip) = answer["data"]["address"]
            .as_str()
            .and_then(|v| v.parse::<Ipv4Addr>().ok())
        else {
            return "indeterminate";
        };
        let octets = ip.octets();
        if octets[..3] != [127, 0, 0] || octets[3] < 2 {
            return "indeterminate";
        }
        listed = true;
    }
    if listed {
        "listed"
    } else {
        "indeterminate"
    }
}

pub async fn run(request: &ToolkitRequest) -> Result<Value, String> {
    if request.route != "direct" || request.proxy_url.as_deref().is_some_and(|v| !v.is_empty()) {
        return Err(
            "Raw DNS requires an explicit direct route; no proxy bypass/fallback was attempted."
                .into(),
        );
    }
    let transport = request.option("transport").unwrap_or("udp");
    if !matches!(transport, "udp" | "tcp") {
        return Err("DNS transport must be udp or tcp.".into());
    }
    let kind = DnsRecordType::from_str_loose(request.option("recordType").unwrap_or("A"))
        .ok_or("Unsupported DNS recordType")?;
    let resolver_option = request
        .option("resolver")
        .ok_or("Choose an explicit resolver IP[:port]; no public resolver is selected implicitly.");
    match request.tool.as_str() {
        "dns" | "reverseIp" => {
            let server = resolver(resolver_option?)?;
            let (query_name, kind) = if request.tool == "reverseIp" {
                (
                    wire::reverse_dns_name(&request.target)
                        .ok_or("PTR lookup requires an IPv4 or IPv6 address")?,
                    DnsRecordType::PTR,
                )
            } else {
                (name(&request.target)?, kind)
            };
            let reply = query(server, &query_name, kind, transport, request.timeout_ms).await?;
            Ok(
                json!({"query": query_name, "recordType": kind.as_str(), "response": reply,
                "scope": if request.tool == "reverseIp" { "PTR reverse DNS only; does not enumerate co-hosted websites" } else { "One explicit resolver; AD is a resolver claim, not local DNSSEC validation" }}),
            )
        }
        "dnsPropagation" => {
            let query_name = name(&request.target)?;
            let servers = list(
                request
                    .option("resolvers")
                    .ok_or("Choose explicit resolvers for comparison")?,
                8,
            )?
            .into_iter()
            .map(resolver)
            .collect::<Result<Vec<_>, _>>()?;
            let mut results = Vec::new();
            for server in servers {
                match query(server, &query_name, kind, transport, request.timeout_ms).await {
                    Ok(reply) => results.push(
                        json!({"resolver": server.to_string(), "ok": true, "response": reply}),
                    ),
                    Err(error) => results
                        .push(json!({"resolver": server.to_string(), "ok": false, "error": error})),
                }
            }
            Ok(
                json!({"query": query_name, "recordType": kind.as_str(), "results": results,
                "scope": "Point-in-time responses from the selected resolvers only; not proof of global propagation or DNSSEC validation"}),
            )
        }
        "rbl" | "dnsBlocklist" => {
            let server = resolver(resolver_option?)?;
            let prefix = if request.tool == "rbl" {
                let reversed = wire::reverse_dns_name(&request.target)
                    .ok_or("IP DNSBL lookup requires an IP address")?;
                reversed
                    .strip_suffix(".in-addr.arpa")
                    .or_else(|| reversed.strip_suffix(".ip6.arpa"))
                    .ok_or("Invalid reverse name")?
                    .to_string()
            } else {
                name(&request.target)?
            };
            let zones = list(
                request.option("zones").ok_or(
                    "Specify DNSBL zones explicitly; provider access rules and return codes vary",
                )?,
                32,
            )?;
            // Validate the entire batch before sending the first query.
            let queries = zones
                .into_iter()
                .map(|zone| {
                    let zone = name(zone)?;
                    let query = name(&format!("{prefix}.{zone}"))?;
                    Ok((zone, query))
                })
                .collect::<Result<Vec<_>, String>>()?;
            let mut results = Vec::new();
            for (zone, query_name) in queries {
                match query(server, &query_name, DnsRecordType::A, transport, request.timeout_ms).await {
                    Ok(reply) => results.push(json!({"zone": zone, "query": query_name, "status": listing_status(&reply, &query_name), "response": reply})),
                    Err(error) => results.push(json!({"zone": zone, "query": query_name, "status": "error", "error": error})),
                }
            }
            Ok(
                json!({"results": results, "scope": "Only configured DNSBL zones. listed means a conventional 127.0.0.2–255 reply; check each provider's code documentation. Other replies are indeterminate; transport errors never mean not listed. No global reputation/security verdict."}),
            )
        }
        _ => Err("Unknown DNS diagnostic".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;

    fn packet(flags: u16) -> Vec<u8> {
        let mut bytes = wire::build_query(
            &DnsQuery::new("example.test", DnsRecordType::A),
            42,
            false,
            0,
        );
        bytes[2..4].copy_from_slice(&flags.to_be_bytes());
        bytes
    }
    fn with_a(mut bytes: Vec<u8>, ip: [u8; 4]) -> Vec<u8> {
        bytes[2..4].copy_from_slice(&0x8180u16.to_be_bytes());
        bytes[6..8].copy_from_slice(&1u16.to_be_bytes());
        bytes.extend_from_slice(&[0xc0, 12, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4]);
        bytes.extend_from_slice(&ip);
        bytes
    }
    fn request(tool: &str, server: SocketAddr) -> ToolkitRequest {
        ToolkitRequest {
            job_id: "dns-fixture".into(),
            tool: tool.into(),
            target: "example.test".into(),
            timeout_ms: 1000,
            route: "direct".into(),
            proxy_url: None,
            options: [("resolver".into(), server.to_string())].into(),
        }
    }
    #[test]
    fn rejects_injection_labels_and_resolver_ambiguity() {
        for value in [
            "",
            ".",
            "bad..name",
            "-x",
            "x-",
            "x\ny",
            "https://host",
            "host;cmd",
            "user@host",
            "é.test",
        ] {
            assert!(name(value).is_err(), "{value}");
        }
        assert!(name(&format!("{}.test", "x".repeat(64))).is_err());
        assert_eq!(
            name("_sip._tcp.Example.TEST.").unwrap(),
            "_sip._tcp.example.test"
        );
        for value in [
            "localhost",
            "0.0.0.0",
            "[::]:53",
            "127.0.0.1:0",
            "http://127.0.0.1",
            "224.0.0.1",
        ] {
            assert!(resolver(value).is_err());
        }
        assert_eq!(resolver("[::1]:5353").unwrap().port(), 5353);
        assert_eq!(resolver("::1").unwrap().port(), 53);
        assert!(list(&vec!["zone"; 33].join(","), 32).is_err());
    }
    #[test]
    fn strict_transaction_question_and_length_validation() {
        let bytes = with_a(packet(0x8180), [192, 0, 2, 1]);
        let reply = parse_reply(&bytes, 42, "example.test", 1).unwrap();
        assert_eq!(reply["answers"][0]["data"]["address"], "192.0.2.1");
        assert!(parse_reply(&bytes, 41, "example.test", 1).is_err());
        assert!(parse_reply(&bytes, 42, "other.test", 1).is_err());
        assert!(parse_reply(&bytes, 42, "example.test", 28).is_err());
        for len in 0..bytes.len() {
            assert!(parse_reply(&bytes[..len], 42, "example.test", 1).is_err());
        }
        let mut extra = bytes.clone();
        extra.push(0);
        assert!(parse_reply(&extra, 42, "example.test", 1).is_err());
    }
    #[test]
    fn rejects_compression_cycles_extended_labels_and_rdata_overruns() {
        let mut bytes = packet(0x8180);
        bytes[12] = 0xc0;
        bytes[13] = 12;
        assert!(parse_reply(&bytes, 42, "example.test", 1).is_err());
        bytes[12] = 0x40;
        assert!(parse_reply(&bytes, 42, "example.test", 1).is_err());
        assert!(rdata(&[4, b'a'], 0, 2, 16).is_err());
        assert!(rdata(&[0, 5], 0, 2, 257).is_err());
        assert!(rdata(&[0, 0, 0], 0, 3, 6).is_err());
        assert!(rdata(&[0, 0, 0], 0, 3, 1).is_err());
    }
    #[test]
    fn rbl_provider_error_is_not_clean_or_listed() {
        for (ip, expected) in [
            ([127, 0, 0, 2], "listed"),
            ([127, 255, 255, 254], "indeterminate"),
            ([192, 0, 2, 1], "indeterminate"),
        ] {
            let reply = parse_reply(&with_a(packet(0x8180), ip), 42, "example.test", 1).unwrap();
            assert_eq!(listing_status(&reply, "example.test"), expected);
            assert_eq!(listing_status(&reply, "other.test"), "indeterminate");
        }
        assert_eq!(listing_status(&json!({"rcode": 2}), "name"), "error");
        assert_eq!(listing_status(&json!({"rcode": 3}), "name"), "notListed");
        assert_eq!(
            listing_status(&json!({"rcode": 0, "answers": []}), "name"),
            "noData"
        );
    }
    #[test]
    fn typed_records_and_ipv6_reverse_labels() {
        assert_eq!(
            rdata(&[3, b'f', b'o', b'o', 3, b'b', b'a', b'r'], 0, 8, 16).unwrap()["strings"],
            json!(["foo", "bar"])
        );
        assert_eq!(rdata(&[0; 16], 0, 16, 28).unwrap()["address"], "::");
        assert_eq!(
            wire::reverse_dns_name("192.0.2.1").unwrap(),
            "1.2.0.192.in-addr.arpa"
        );
        let reverse = wire::reverse_dns_name("2001:db8::1").unwrap();
        assert!(reverse.starts_with("1.0.0.0."));
        assert!(reverse.ends_with(".ip6.arpa"));
    }
    #[tokio::test]
    async fn loopback_udp_query_and_no_implicit_proxy_bypass() {
        let socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let address = socket.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let mut bytes = [0; 512];
            let (size, peer) = socket.recv_from(&mut bytes).await.unwrap();
            socket
                .send_to(&with_a(bytes[..size].to_vec(), [192, 0, 2, 7]), peer)
                .await
                .unwrap();
        });
        let mut req = request("dns", address);
        let report = run(&req).await.unwrap();
        assert_eq!(
            report["response"]["answers"][0]["data"]["address"],
            "192.0.2.7"
        );
        server.await.unwrap();
        req.route = "httpProxy".into();
        assert!(run(&req).await.unwrap_err().contains("no proxy bypass"));
        req.route = "direct".into();
        req.options.clear();
        assert!(run(&req).await.unwrap_err().contains("explicit resolver"));
    }
    #[tokio::test]
    async fn truncated_udp_uses_tcp_only_on_the_same_resolver() {
        let tcp = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = tcp.local_addr().unwrap();
        let udp = UdpSocket::bind(address).await.unwrap();
        let server = tokio::spawn(async move {
            let mut buf = [0; 512];
            let (size, peer) = udp.recv_from(&mut buf).await.unwrap();
            buf[2..4].copy_from_slice(&0x8380u16.to_be_bytes());
            udp.send_to(&buf[..size], peer).await.unwrap();
            let (mut stream, _) = tcp.accept().await.unwrap();
            let len = stream.read_u16().await.unwrap();
            let mut bytes = vec![0; len as usize];
            stream.read_exact(&mut bytes).await.unwrap();
            let response = with_a(bytes, [192, 0, 2, 9]);
            stream.write_u16(response.len() as u16).await.unwrap();
            stream.write_all(&response).await.unwrap();
        });
        let reply = run(&request("dns", address)).await.unwrap();
        assert_eq!(reply["response"]["transport"], "tcp");
        server.await.unwrap();
    }
    #[tokio::test]
    async fn timeout_and_batch_errors_never_become_not_listed() {
        let socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let mut req = request("rbl", socket.local_addr().unwrap());
        req.target = "192.0.2.1".into();
        req.timeout_ms = 20;
        req.options.insert("zones".into(), "fixture.test".into());
        let result = run(&req).await.unwrap();
        assert_eq!(result["results"][0]["status"], "error");
        assert!(result["results"][0]["error"]
            .as_str()
            .unwrap()
            .contains("timed out"));
    }
}
