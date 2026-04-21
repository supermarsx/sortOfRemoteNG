//! # DNS Wire Format
//!
//! RFC 1035 / RFC 6891 wire-format encoding and decoding for DNS messages.
//! Used by DoH (RFC 8484), DoT, and raw UDP/TCP transports.

use crate::types::*;

/// DNS wire-format header (12 bytes).
#[derive(Debug, Clone)]
pub struct DnsHeader {
    pub id: u16,
    pub flags: u16,
    pub qd_count: u16,
    pub an_count: u16,
    pub ns_count: u16,
    pub ar_count: u16,
}

impl DnsHeader {
    pub fn new_query(id: u16) -> Self {
        Self {
            id,
            flags: 0x0100, // RD=1
            qd_count: 1,
            an_count: 0,
            ns_count: 0,
            ar_count: 0,
        }
    }

    pub fn set_dnssec(&mut self) {
        // Set DO bit in EDNS0 OPT record (handled in OPT, but also set AD in flags)
        self.flags |= 0x0020; // AD flag
    }

    pub fn set_cd(&mut self) {
        self.flags |= 0x0010; // CD flag
    }

    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(12);
        buf.extend_from_slice(&self.id.to_be_bytes());
        buf.extend_from_slice(&self.flags.to_be_bytes());
        buf.extend_from_slice(&self.qd_count.to_be_bytes());
        buf.extend_from_slice(&self.an_count.to_be_bytes());
        buf.extend_from_slice(&self.ns_count.to_be_bytes());
        buf.extend_from_slice(&self.ar_count.to_be_bytes());
        buf
    }

    pub fn decode(data: &[u8]) -> Option<Self> {
        if data.len() < 12 {
            return None;
        }
        Some(Self {
            id: u16::from_be_bytes([data[0], data[1]]),
            flags: u16::from_be_bytes([data[2], data[3]]),
            qd_count: u16::from_be_bytes([data[4], data[5]]),
            an_count: u16::from_be_bytes([data[6], data[7]]),
            ns_count: u16::from_be_bytes([data[8], data[9]]),
            ar_count: u16::from_be_bytes([data[10], data[11]]),
        })
    }

    pub fn rcode(&self) -> DnsRcode {
        DnsRcode::from_code(self.flags & 0x000F)
    }

    pub fn is_response(&self) -> bool {
        (self.flags & 0x8000) != 0
    }

    pub fn is_authoritative(&self) -> bool {
        (self.flags & 0x0400) != 0
    }

    pub fn is_truncated(&self) -> bool {
        (self.flags & 0x0200) != 0
    }

    pub fn recursion_available(&self) -> bool {
        (self.flags & 0x0080) != 0
    }

    pub fn authenticated_data(&self) -> bool {
        (self.flags & 0x0020) != 0
    }
}

/// Encode a DNS name into wire format (label sequences).
pub fn encode_name(name: &str) -> Vec<u8> {
    let mut buf = Vec::new();
    let name = name.trim_end_matches('.');
    for label in name.split('.') {
        let len = label.len();
        if len > 63 {
            log::warn!("DNS label too long: {}", label);
            buf.push(63);
            buf.extend_from_slice(&label.as_bytes()[..63]);
        } else {
            buf.push(len as u8);
            buf.extend_from_slice(label.as_bytes());
        }
    }
    buf.push(0); // root label
    buf
}

/// Decode a DNS name from wire format, handling compression pointers.
pub fn decode_name(data: &[u8], offset: &mut usize) -> Option<String> {
    let mut labels = Vec::new();
    let mut jumped = false;
    let mut jump_offset = 0usize;
    let mut pos = *offset;
    let mut hops = 0;

    loop {
        if pos >= data.len() || hops > 128 {
            return None;
        }

        let len = data[pos] as usize;

        if len == 0 {
            pos += 1;
            break;
        }

        // Compression pointer (top 2 bits set)
        if (len & 0xC0) == 0xC0 {
            if pos + 1 >= data.len() {
                return None;
            }
            let pointer = ((len & 0x3F) << 8) | (data[pos + 1] as usize);
            if !jumped {
                jump_offset = pos + 2;
                jumped = true;
            }
            pos = pointer;
            hops += 1;
            continue;
        }

        pos += 1;
        if pos + len > data.len() {
            return None;
        }
        let label = std::str::from_utf8(&data[pos..pos + len]).ok()?;
        labels.push(label.to_string());
        pos += len;
        hops += 1;
    }

    if jumped {
        *offset = jump_offset;
    } else {
        *offset = pos;
    }

    Some(labels.join("."))
}

/// Encode a DNS question section.
pub fn encode_question(name: &str, rtype: DnsRecordType, class: DnsClass) -> Vec<u8> {
    let mut buf = encode_name(name);
    buf.extend_from_slice(&rtype.type_code().to_be_bytes());
    buf.extend_from_slice(&class.code().to_be_bytes());
    buf
}

/// Encode an EDNS0 OPT pseudo-record (RFC 6891).
pub fn encode_edns0_opt(udp_payload_size: u16, dnssec_ok: bool) -> Vec<u8> {
    let mut buf = Vec::new();
    buf.push(0); // root name
    buf.extend_from_slice(&41u16.to_be_bytes()); // OPT type
    buf.extend_from_slice(&udp_payload_size.to_be_bytes()); // UDP payload size
    buf.push(0); // extended RCODE
    buf.push(0); // EDNS version
    let flags: u16 = if dnssec_ok { 0x8000 } else { 0 }; // DO bit
    buf.extend_from_slice(&flags.to_be_bytes());
    buf.extend_from_slice(&0u16.to_be_bytes()); // RDLENGTH = 0 (no options)
    buf
}

/// Build a complete DNS query message in wire format.
pub fn build_query(query: &DnsQuery, id: u16, edns0: bool, edns0_payload: u16) -> Vec<u8> {
    let mut header = DnsHeader::new_query(id);

    if query.dnssec {
        header.set_dnssec();
    }
    if query.cd {
        header.set_cd();
    }

    if edns0 {
        header.ar_count = 1; // OPT record in additional
    }

    let mut msg = header.encode();
    msg.extend(encode_question(&query.name, query.record_type, query.class));

    if edns0 {
        msg.extend(encode_edns0_opt(edns0_payload, query.dnssec));
    }

    msg
}

/// Parse a DNS wire-format response into a DnsResponse.
pub fn parse_response(
    data: &[u8],
    server: &str,
    protocol: DnsProtocol,
    duration_ms: u64,
) -> Option<DnsResponse> {
    let header = DnsHeader::decode(data)?;

    if !header.is_response() {
        return None;
    }

    let mut offset = 12;

    // Skip question section
    for _ in 0..header.qd_count {
        decode_name(data, &mut offset)?;
        offset += 4; // type + class
    }

    // Parse answer section
    let answers = parse_records(data, &mut offset, header.an_count)?;
    let authority = parse_records(data, &mut offset, header.ns_count)?;
    let additional = parse_records(data, &mut offset, header.ar_count)?;

    Some(DnsResponse {
        rcode: header.rcode(),
        authoritative: header.is_authoritative(),
        truncated: header.is_truncated(),
        recursion_available: header.recursion_available(),
        authenticated_data: header.authenticated_data(),
        answers,
        authority,
        additional,
        duration_ms,
        server: server.to_string(),
        protocol,
    })
}

fn parse_records(data: &[u8], offset: &mut usize, count: u16) -> Option<Vec<DnsRecord>> {
    let mut records = Vec::new();

    for _ in 0..count {
        let name = decode_name(data, offset)?;

        if *offset + 10 > data.len() {
            return None;
        }

        let rtype = u16::from_be_bytes([data[*offset], data[*offset + 1]]);
        let _class = u16::from_be_bytes([data[*offset + 2], data[*offset + 3]]);
        let ttl = u32::from_be_bytes([
            data[*offset + 4],
            data[*offset + 5],
            data[*offset + 6],
            data[*offset + 7],
        ]);
        let rdlength = u16::from_be_bytes([data[*offset + 8], data[*offset + 9]]) as usize;
        *offset += 10;

        if *offset + rdlength > data.len() {
            return None;
        }

        let rdata_start = *offset;
        let record_type = DnsRecordType::from_type_code(rtype);

        // OPT pseudo-record (type 41) — skip it
        if rtype == 41 {
            *offset += rdlength;
            continue;
        }

        let record_data = if let Some(rt) = record_type {
            parse_rdata(data, &mut *offset, rt, rdlength)
        } else {
            *offset = rdata_start + rdlength;
            DnsRecordData::Raw {
                data: data[rdata_start..rdata_start + rdlength].to_vec(),
            }
        };

        // Ensure offset advanced past rdata
        if *offset < rdata_start + rdlength {
            *offset = rdata_start + rdlength;
        }

        if let Some(rt) = record_type {
            records.push(DnsRecord {
                name,
                record_type: rt,
                ttl,
                data: record_data,
            });
        }
    }

    Some(records)
}

fn parse_rdata(
    data: &[u8],
    offset: &mut usize,
    rtype: DnsRecordType,
    rdlength: usize,
) -> DnsRecordData {
    let start = *offset;

    match rtype {
        DnsRecordType::A if rdlength == 4 => {
            let addr = format!(
                "{}.{}.{}.{}",
                data[*offset],
                data[*offset + 1],
                data[*offset + 2],
                data[*offset + 3]
            );
            *offset += 4;
            DnsRecordData::A { address: addr }
        }
        DnsRecordType::AAAA if rdlength == 16 => {
            let mut parts = Vec::new();
            for i in 0..8 {
                let val = u16::from_be_bytes([data[*offset + i * 2], data[*offset + i * 2 + 1]]);
                parts.push(format!("{:x}", val));
            }
            *offset += 16;
            DnsRecordData::AAAA {
                address: parts.join(":"),
            }
        }
        DnsRecordType::CNAME | DnsRecordType::NS | DnsRecordType::PTR => {
            let name = decode_name(data, offset).unwrap_or_default();
            match rtype {
                DnsRecordType::CNAME => DnsRecordData::CNAME { target: name },
                DnsRecordType::NS => DnsRecordData::NS { nameserver: name },
                DnsRecordType::PTR => DnsRecordData::PTR { domain: name },
                _ => unreachable!(),
            }
        }
        DnsRecordType::MX if rdlength >= 3 => {
            let priority = u16::from_be_bytes([data[*offset], data[*offset + 1]]);
            *offset += 2;
            let exchange = decode_name(data, offset).unwrap_or_default();
            DnsRecordData::MX { priority, exchange }
        }
        DnsRecordType::TXT => {
            let end = start + rdlength;
            let mut text = String::new();
            while *offset < end {
                let len = data[*offset] as usize;
                *offset += 1;
                if *offset + len <= end {
                    if let Ok(s) = std::str::from_utf8(&data[*offset..*offset + len]) {
                        text.push_str(s);
                    }
                    *offset += len;
                } else {
                    break;
                }
            }
            DnsRecordData::TXT { text }
        }
        DnsRecordType::SRV if rdlength >= 7 => {
            let priority = u16::from_be_bytes([data[*offset], data[*offset + 1]]);
            let weight = u16::from_be_bytes([data[*offset + 2], data[*offset + 3]]);
            let port = u16::from_be_bytes([data[*offset + 4], data[*offset + 5]]);
            *offset += 6;
            let target = decode_name(data, offset).unwrap_or_default();
            DnsRecordData::SRV {
                priority,
                weight,
                port,
                target,
            }
        }
        DnsRecordType::SOA => {
            let mname = decode_name(data, offset).unwrap_or_default();
            let rname = decode_name(data, offset).unwrap_or_default();
            if *offset + 20 <= data.len() {
                let serial = u32::from_be_bytes([
                    data[*offset],
                    data[*offset + 1],
                    data[*offset + 2],
                    data[*offset + 3],
                ]);
                let refresh = u32::from_be_bytes([
                    data[*offset + 4],
                    data[*offset + 5],
                    data[*offset + 6],
                    data[*offset + 7],
                ]);
                let retry = u32::from_be_bytes([
                    data[*offset + 8],
                    data[*offset + 9],
                    data[*offset + 10],
                    data[*offset + 11],
                ]);
                let expire = u32::from_be_bytes([
                    data[*offset + 12],
                    data[*offset + 13],
                    data[*offset + 14],
                    data[*offset + 15],
                ]);
                let minimum = u32::from_be_bytes([
                    data[*offset + 16],
                    data[*offset + 17],
                    data[*offset + 18],
                    data[*offset + 19],
                ]);
                *offset += 20;
                DnsRecordData::SOA {
                    mname,
                    rname,
                    serial,
                    refresh,
                    retry,
                    expire,
                    minimum,
                }
            } else {
                DnsRecordData::Raw {
                    data: data[start..start + rdlength].to_vec(),
                }
            }
        }
        DnsRecordType::CAA if rdlength >= 2 => {
            let flags = data[*offset];
            *offset += 1;
            let tag_len = data[*offset] as usize;
            *offset += 1;
            let tag = std::str::from_utf8(&data[*offset..*offset + tag_len.min(rdlength - 2)])
                .unwrap_or("")
                .to_string();
            *offset += tag_len.min(rdlength - 2);
            let value_len = rdlength - 2 - tag_len.min(rdlength - 2);
            let value = std::str::from_utf8(&data[*offset..*offset + value_len])
                .unwrap_or("")
                .to_string();
            *offset += value_len;
            DnsRecordData::CAA { flags, tag, value }
        }
        DnsRecordType::SSHFP if rdlength >= 2 => {
            let algorithm = data[*offset];
            let fp_type = data[*offset + 1];
            *offset += 2;
            let fp_len = rdlength - 2;
            let fingerprint = data[*offset..*offset + fp_len]
                .iter()
                .map(|b| format!("{:02x}", b))
                .collect::<String>();
            *offset += fp_len;
            DnsRecordData::SSHFP {
                algorithm,
                fingerprint_type: fp_type,
                fingerprint,
            }
        }
        DnsRecordType::TLSA if rdlength >= 3 => {
            let usage = data[*offset];
            let selector = data[*offset + 1];
            let matching_type = data[*offset + 2];
            *offset += 3;
            let cert_len = rdlength - 3;
            let certificate_data = data[*offset..*offset + cert_len]
                .iter()
                .map(|b| format!("{:02x}", b))
                .collect::<String>();
            *offset += cert_len;
            DnsRecordData::TLSA {
                usage,
                selector,
                matching_type,
                certificate_data,
            }
        }
        _ => {
            *offset = start + rdlength;
            DnsRecordData::Raw {
                data: data[start..start + rdlength].to_vec(),
            }
        }
    }
}

/// Build a PTR query name from an IP address (in-addr.arpa / ip6.arpa).
pub fn reverse_dns_name(ip: &str) -> Option<String> {
    if let Ok(addr) = ip.parse::<std::net::IpAddr>() {
        match addr {
            std::net::IpAddr::V4(v4) => {
                let octets = v4.octets();
                Some(format!(
                    "{}.{}.{}.{}.in-addr.arpa",
                    octets[3], octets[2], octets[1], octets[0]
                ))
            }
            std::net::IpAddr::V6(v6) => {
                let segments = v6.octets();
                let nibbles: String = segments
                    .iter()
                    .rev()
                    .flat_map(|b| vec![b & 0x0F, (b >> 4) & 0x0F])
                    .map(|n| format!("{:x}.", n))
                    .collect();
                Some(format!("{}ip6.arpa", nibbles))
            }
        }
    } else {
        None
    }
}
