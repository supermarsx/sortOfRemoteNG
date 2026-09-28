//! Bounded, credential-free protocol identification on an already selected IP.
//!
//! Every exchange shares one absolute deadline (at most five seconds) and an
//! 8 KiB application-read budget, including framing and any second connection.
//! No session setup, TLS/CredSSP handshake, authentication, or query is sent.
//! Protocol evidence does not establish a server product or product version.
//!
//! Wire contracts: MS-SMB2 2.2.1.2, 2.2.3 and 2.2.4; MS-RDPBCGR 2.2.1.1,
//! 2.2.1.2.1 and 2.2.1.2.2; PostgreSQL protocol message formats/error fields:
//! <https://www.postgresql.org/docs/current/protocol-message-formats.html>
//! <https://www.postgresql.org/docs/current/protocol-error-fields.html>
//! <https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-smb2/e14db7ff-763a-4263-8b10-0c3944f52fc5>
//! <https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-smb2/63abf97c-0d09-47e2-88d6-6bfa552949a5>
//! <https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-rdpbcgr/b2975bdc-6d56-49ee-9c57-f2ff3a0b6817>
//! <https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-rdpbcgr/1b3920e7-0116-4345-bc45-f2c4ad012761>

use crate::network::PortCheckResult;
use std::net::SocketAddr;
use std::sync::OnceLock;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::{timeout_at, Instant};

const MAX_READ: usize = 8 * 1024;
const MAX_TIME: Duration = Duration::from_secs(5);
const SSL_REQUEST: [u8; 8] = [0, 0, 0, 8, 4, 210, 22, 47];
// Deliberately omit ALL parameters, including user/database. PostgreSQL rejects
// the missing username during startup parsing, before ClientAuthentication.
const EMPTY_STARTUP: [u8; 9] = [0, 0, 0, 9, 0, 3, 0, 0, 0];
// TPKT + X.224 CR + RDP_NEG_REQ; no cookie, routing token, or client identity.
// Offer TLS, HYBRID and HYBRID_EX. Stop immediately after negotiation.
const RDP_REQUEST: [u8; 19] = [
    3, 0, 0, 19, 14, 0xe0, 0, 0, 0, 0, 0, 1, 0, 8, 0, 0x0b, 0, 0, 0,
];

type ProbeResult<T> = Result<T, &'static str>;

#[derive(Debug)]
struct Identification {
    protocol: &'static str,
    evidence: String,
    // Negotiated SMB dialect only, never an inferred software version.
    version: Option<&'static str>,
}

/// Identify `smb`, `rdp`, or `postgresql` (`postgres` is also accepted).
///
/// Only the protocol metadata and identification_error are changed. The caller
/// owns TCP-open/service guesses and opts in to this active negotiation. Errors
/// are stable reason strings, never OS messages or untrusted response text.
pub async fn identify(
    result: &mut PortCheckResult,
    protocol: &str,
    addr: SocketAddr,
    budget: Duration,
) {
    result.protocol_confirmed = None;
    result.protocol_evidence = None;
    result.protocol_version = None;
    let outcome = if !matches!(protocol, "smb" | "rdp" | "postgresql" | "postgres") {
        Err("unsupported_protocol")
    } else if budget.is_zero() {
        Err("timeout")
    } else {
        let deadline = Instant::now() + budget.min(MAX_TIME);
        match timeout_at(deadline, exchange(protocol, addr)).await {
            Ok(outcome) => outcome,
            Err(_) => Err("timeout"),
        }
    };
    match outcome {
        Ok(found) => {
            result.protocol_confirmed = Some(found.protocol.into());
            result.protocol_evidence = Some(found.evidence);
            result.protocol_version = found.version.map(str::to_owned);
            result.identification_error = None;
        }
        Err(reason) => result.identification_error = Some(reason.into()),
    }
}

async fn exchange(protocol: &str, addr: SocketAddr) -> ProbeResult<Identification> {
    let mut stream = connect(addr).await?;
    let mut remaining = MAX_READ;
    match protocol {
        "smb" => {
            send(&mut stream, &smb_request()).await?;
            let mut header = [0; 4];
            read(&mut stream, &mut remaining, &mut header).await?;
            if header[0] != 0 {
                return Err("protocol_mismatch");
            }
            let size = u32::from_be_bytes(header) as usize;
            let body = read_body(&mut stream, &mut remaining, size).await?;
            parse_smb(&body)
        }
        "rdp" => {
            send(&mut stream, &RDP_REQUEST).await?;
            let mut header = [0; 4];
            read(&mut stream, &mut remaining, &mut header).await?;
            if header[..2] != [3, 0] {
                return Err("protocol_mismatch");
            }
            let size = u16::from_be_bytes([header[2], header[3]]) as usize;
            let size = size.checked_sub(4).ok_or("malformed_response")?;
            let body = read_body(&mut stream, &mut remaining, size).await?;
            parse_rdp(&body)
        }
        "postgresql" | "postgres" => {
            send(&mut stream, &SSL_REQUEST).await?;
            let mut ssl = [0];
            read(&mut stream, &mut remaining, &mut ssl).await?;
            let ssl_evidence = match ssl[0] {
                b'S' => {
                    // The accepted SSL stream now expects TLS. Close it without
                    // a handshake; never send plaintext startup on that stream.
                    drop(stream);
                    stream = connect(addr).await?;
                    "accepted"
                }
                b'N' => "declined",
                _ => return Err("protocol_mismatch"),
            };
            send(&mut stream, &EMPTY_STARTUP).await?;
            let mut header = [0; 5];
            read(&mut stream, &mut remaining, &mut header).await?;
            if header[0] != b'E' {
                // In particular, never answer an AuthenticationRequest ('R').
                return Err("protocol_mismatch");
            }
            let size = u32::from_be_bytes(header[1..5].try_into().unwrap()) as usize;
            let size = size.checked_sub(4).ok_or("malformed_response")?;
            let body = read_body(&mut stream, &mut remaining, size).await?;
            let state = parse_pg_error(&body)?;
            Ok(Identification {
                protocol: "postgresql",
                evidence: format!(
                    "PostgreSQL wire protocol: SSLRequest {ssl_evidence}; validated ErrorResponse (SQLSTATE {state}) to startup without user"
                ),
                // 3.0 was OUR request, not a server version announcement.
                version: None,
            })
        }
        _ => Err("unsupported_protocol"),
    }
}

async fn connect(addr: SocketAddr) -> ProbeResult<TcpStream> {
    TcpStream::connect(addr)
        .await
        .map_err(|_| "connection_failed")
}

async fn send(stream: &mut TcpStream, bytes: &[u8]) -> ProbeResult<()> {
    stream.write_all(bytes).await.map_err(|_| "io_error")
}

async fn read(stream: &mut TcpStream, remaining: &mut usize, bytes: &mut [u8]) -> ProbeResult<()> {
    if bytes.len() > *remaining {
        return Err("response_too_large");
    }
    // No buffered reader/read-ahead: read_exact cannot consume past this slice.
    *remaining -= bytes.len();
    stream.read_exact(bytes).await.map(|_| ()).map_err(|error| {
        if error.kind() == std::io::ErrorKind::UnexpectedEof {
            "truncated_response"
        } else {
            "io_error"
        }
    })
}

async fn read_body(
    stream: &mut TcpStream,
    remaining: &mut usize,
    size: usize,
) -> ProbeResult<Vec<u8>> {
    // Check before allocating or reading an attacker-controlled frame length.
    if size > *remaining {
        return Err("response_too_large");
    }
    let mut bytes = vec![0; size];
    read(stream, remaining, &mut bytes).await?;
    Ok(bytes)
}

fn le16(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes(bytes[offset..offset + 2].try_into().unwrap())
}

fn le32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
}

fn smb_request() -> Vec<u8> {
    // Offer 2.0.2, 2.1, 3.0 and 3.0.2. 3.1.1 requires preauth contexts, so it is
    // deliberately not offered. The returned dialect is not the server maximum.
    // Per MS-SMB2 3.2.1.1, use a process-local generated global ClientGuid.
    static CLIENT_GUID: OnceLock<uuid::Uuid> = OnceLock::new();
    let mut body = vec![0u8; 108];
    body[..4].copy_from_slice(b"\xfeSMB");
    body[4..6].copy_from_slice(&64u16.to_le_bytes());
    body[14..16].copy_from_slice(&1u16.to_le_bytes()); // CreditRequest
    body[64..66].copy_from_slice(&36u16.to_le_bytes());
    body[66..68].copy_from_slice(&4u16.to_le_bytes()); // DialectCount
    body[68..70].copy_from_slice(&1u16.to_le_bytes()); // Signing enabled
    body[76..92].copy_from_slice(CLIENT_GUID.get_or_init(uuid::Uuid::new_v4).as_bytes());
    for (slot, dialect) in body[100..]
        .as_chunks_mut::<2>()
        .0
        .iter_mut()
        .zip([0x0202u16, 0x0210, 0x0300, 0x0302])
    {
        slot.copy_from_slice(&dialect.to_le_bytes());
    }
    let mut packet = (body.len() as u32).to_be_bytes().to_vec();
    packet.extend(body);
    packet
}

fn parse_smb(body: &[u8]) -> ProbeResult<Identification> {
    if body.len() < 64 {
        return Err("malformed_response");
    }
    if &body[..4] != b"\xfeSMB" {
        return Err("protocol_mismatch");
    }
    if le16(body, 4) != 64
        || le16(body, 12) != 0 // NEGOTIATE only
        || le32(body, 16) & 3 != 1 // Server response, synchronous
        || le32(body, 20) != 0 // No compound messages
        || body[24..32] != [0; 8] // Our MessageId
        || body[40..48] != [0; 8]
    // No SessionId
    {
        return Err("malformed_response");
    }
    if le32(body, 8) != 0 {
        return Err("negotiation_rejected");
    }
    if body.len() < 128 || le16(body, 64) != 65 {
        return Err("malformed_response");
    }
    let dialect = match le16(body, 68) {
        0x0202 => "2.0.2",
        0x0210 => "2.1",
        0x0300 => "3.0",
        0x0302 => "3.0.2",
        _ => return Err("malformed_response"), // Must have been offered
    };
    let mode = le16(body, 66);
    if mode & !3 != 0 {
        return Err("malformed_response");
    }
    let security_offset = le16(body, 120) as usize;
    let security_length = le16(body, 122) as usize;
    if security_length > 0
        && (security_offset < 128 || security_offset + security_length > body.len())
    {
        return Err("malformed_response");
    }
    Ok(Identification {
        protocol: "smb",
        evidence: format!(
            "SMB2 NEGOTIATE: negotiated dialect {dialect}; signing enabled={}; signing required={}",
            mode & 1 != 0,
            mode & 2 != 0,
        ),
        version: Some(dialect),
    })
}

fn parse_rdp(body: &[u8]) -> ProbeResult<Identification> {
    // A bare X.224 CC is not specific to RDP. Require the RDP negotiation data.
    if body.len() != 15 || body[0] != 14 {
        return Err("malformed_response");
    }
    if body[1] != 0xd0 {
        return Err("protocol_mismatch");
    }
    if body[2..4] != [0, 0] || body[6] != 0 || le16(body, 9) != 8 {
        return Err("malformed_response");
    }
    let code = le32(body, 11);
    let evidence = match body[7] {
        2 => {
            let transport = match code {
                0 => "standard RDP security",
                1 => "TLS",
                2 => "CredSSP (HYBRID)",
                8 => "CredSSP with early authorization (HYBRID_EX)",
                _ => return Err("malformed_response"), // Not offered, or not a single protocol
            };
            format!("RDP X.224 negotiation response: selected {transport}; handshake not attempted")
        }
        3 if body[8] == 0 => {
            let reason = match code {
                1 => "SSL_REQUIRED_BY_SERVER",
                2 => "SSL_NOT_ALLOWED_BY_SERVER",
                3 => "SSL_CERT_NOT_ON_SERVER",
                4 => "INCONSISTENT_FLAGS",
                5 => "HYBRID_REQUIRED_BY_SERVER",
                6 => "SSL_WITH_USER_AUTH_REQUIRED_BY_SERVER",
                7 => "ENTRA_AUTH_REQUIRED_BY_SERVER",
                _ => return Err("malformed_response"),
            };
            format!("RDP X.224 negotiation failure: {reason} (0x{code:08x})")
        }
        _ => return Err("malformed_response"),
    };
    Ok(Identification {
        protocol: "rdp",
        evidence,
        version: None,
    })
}

fn parse_pg_error(mut body: &[u8]) -> ProbeResult<&str> {
    let mut seen = [false; 256];
    let mut severity = None;
    let mut invariant_severity = None;
    let mut state = None;
    let mut message = None;
    loop {
        let (&tag, rest) = body.split_first().ok_or("malformed_response")?;
        if tag == 0 {
            if !rest.is_empty() {
                return Err("malformed_response");
            }
            break;
        }
        if !tag.is_ascii_alphabetic() || seen[tag as usize] {
            return Err("malformed_response");
        }
        seen[tag as usize] = true;
        let end = rest
            .iter()
            .position(|b| *b == 0)
            .ok_or("malformed_response")?;
        let value = &rest[..end];
        match tag {
            b'S' => severity = Some(value),
            b'V' => invariant_severity = Some(value),
            b'C' => state = Some(value),
            b'M' => message = Some(value),
            _ => (), // Unknown fields may be added to PostgreSQL's wire format.
        }
        body = &rest[end + 1..];
    }
    if severity.is_none_or(|s| s.is_empty()) || message.is_none_or(|m| m.is_empty()) {
        return Err("malformed_response");
    }
    if !matches!(
        invariant_severity.or(severity),
        Some(b"FATAL" | b"ERROR" | b"PANIC")
    ) {
        return Err("malformed_response");
    }
    let state = state.ok_or("malformed_response")?;
    if state.len() != 5
        || !state
            .iter()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
    {
        return Err("malformed_response");
    }
    // The only remote text exposed is an ASCII SQLSTATE validated above.
    std::str::from_utf8(state).map_err(|_| "malformed_response")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;
    use tokio::time::{sleep, timeout};

    fn result(port: u16) -> PortCheckResult {
        // Serde defaults keep these fixtures independent of other optional
        // discovery metadata owned by the integrating lane.
        serde_json::from_value(serde_json::json!({
            "port": port, "open": true, "service": "port-based guess",
            "time_ms": 3, "banner": "existing passive banner"
        }))
        .unwrap()
    }

    fn smb_response() -> Vec<u8> {
        let mut body = vec![0; 128];
        body[..4].copy_from_slice(b"\xfeSMB");
        body[4..6].copy_from_slice(&64u16.to_le_bytes());
        body[14..16].copy_from_slice(&1u16.to_le_bytes());
        body[16] = 1;
        body[64..66].copy_from_slice(&65u16.to_le_bytes());
        body[66..68].copy_from_slice(&3u16.to_le_bytes());
        body[68..70].copy_from_slice(&0x0302u16.to_le_bytes());
        body[72..88].fill(0x42); // Server GUID
        for offset in [92, 96, 100] {
            body[offset..offset + 4].copy_from_slice(&65536u32.to_le_bytes());
        }
        let mut packet = (body.len() as u32).to_be_bytes().to_vec();
        packet.extend(body);
        packet
    }

    fn rdp_response(kind: u8, code: u32) -> Vec<u8> {
        let mut packet = vec![3, 0, 0, 19, 14, 0xd0, 0, 0, 0x12, 0x34, 0, kind, 0, 8, 0];
        packet.extend(code.to_le_bytes());
        packet
    }

    fn pg_frame(body: &[u8]) -> Vec<u8> {
        let mut packet = vec![b'E'];
        packet.extend(((body.len() + 4) as u32).to_be_bytes());
        packet.extend(body);
        packet
    }

    fn pg_response() -> Vec<u8> {
        pg_frame(
            b"SFATAL\0VFATAL\0C28000\0Mno PostgreSQL user name specified in startup packet\0\0",
        )
    }

    // Read complete outbound requests and verify exact negotiation-only bytes.
    // Then return a fragmented response and require EOF without any auth data.
    async fn fixture(protocol: &'static str, response: Vec<u8>) -> PortCheckResult {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            match protocol {
                "smb" => {
                    let mut request = [0; 112];
                    socket.read_exact(&mut request).await.unwrap();
                    let mut expected = vec![0; 112];
                    expected[..4].copy_from_slice(&108u32.to_be_bytes());
                    expected[4..8].copy_from_slice(b"\xfeSMB");
                    expected[8] = 64;
                    expected[18] = 1;
                    expected[68] = 36;
                    expected[70] = 4;
                    expected[72] = 1;
                    // GUID is the only varying field; it carries no identity.
                    assert!(request[80..96].iter().any(|byte| *byte != 0));
                    expected[80..96].copy_from_slice(&request[80..96]);
                    expected[104..112].copy_from_slice(&[2, 2, 0x10, 2, 0, 3, 2, 3]);
                    assert_eq!(request.as_slice(), expected);
                }
                "rdp" => {
                    let mut request = [0; 19];
                    socket.read_exact(&mut request).await.unwrap();
                    assert_eq!(
                        request,
                        [3, 0, 0, 19, 14, 224, 0, 0, 0, 0, 0, 1, 0, 8, 0, 11, 0, 0, 0]
                    );
                }
                "postgresql" => {
                    let mut request = [0; 8];
                    socket.read_exact(&mut request).await.unwrap();
                    assert_eq!(request, [0, 0, 0, 8, 4, 210, 22, 47]);
                    socket.write_all(b"N").await.unwrap();
                    let mut startup = [0; 9];
                    socket.read_exact(&mut startup).await.unwrap();
                    assert_eq!(startup, [0, 0, 0, 9, 0, 3, 0, 0, 0]);
                }
                _ => unreachable!(),
            }
            for chunk in response.chunks(3) {
                if socket.write_all(chunk).await.is_err() {
                    break; // Rejection may close before all malicious bytes.
                }
                tokio::task::yield_now().await;
            }
            socket.shutdown().await.unwrap();
            let mut unexpected = Vec::new();
            let read = timeout(Duration::from_secs(2), socket.read_to_end(&mut unexpected))
                .await
                .expect("probe must close promptly");
            assert!(
                read.is_ok() || read.unwrap_err().kind() == std::io::ErrorKind::ConnectionReset
            );
            assert!(
                unexpected.is_empty(),
                "must never send authentication/session data"
            );
        });
        let mut result = result(addr.port());
        identify(&mut result, protocol, addr, Duration::from_secs(2)).await;
        timeout(Duration::from_secs(3), server)
            .await
            .unwrap()
            .unwrap();
        assert!(result.open);
        assert_eq!(result.service.as_deref(), Some("port-based guess"));
        assert_eq!(result.banner.as_deref(), Some("existing passive banner"));
        assert_eq!(result.time_ms, Some(3));
        result
    }

    fn assert_error(result: &PortCheckResult, expected: &str) {
        assert_eq!(
            result.identification_error.as_deref(),
            Some(expected),
            "{result:?}"
        );
        assert!(result.protocol_confirmed.is_none());
        assert!(result.protocol_evidence.is_none());
        assert!(result.protocol_version.is_none());
    }

    #[tokio::test]
    async fn smb_negotiates_dialect_and_signing_without_session_setup() {
        let result = fixture("smb", smb_response()).await;
        assert_eq!(result.protocol_confirmed.as_deref(), Some("smb"));
        assert_eq!(result.protocol_version.as_deref(), Some("3.0.2"));
        assert!(result
            .protocol_evidence
            .unwrap()
            .contains("signing required=true"));
        assert!(result.identification_error.is_none());
    }

    #[tokio::test]
    async fn rdp_negotiation_response_and_failure_identify_without_handshake() {
        for code in [0, 1, 2, 8] {
            let result = fixture("rdp", rdp_response(2, code)).await;
            assert_eq!(result.protocol_confirmed.as_deref(), Some("rdp"));
            assert!(result
                .protocol_evidence
                .unwrap()
                .contains("handshake not attempted"));
            assert!(result.protocol_version.is_none());
            assert!(result.identification_error.is_none());
        }
        for code in 1..=7 {
            let result = fixture("rdp", rdp_response(3, code)).await;
            assert_eq!(result.protocol_confirmed.as_deref(), Some("rdp"));
            assert!(result
                .protocol_evidence
                .unwrap()
                .contains("negotiation failure"));
            assert!(result.identification_error.is_none());
        }
    }

    #[tokio::test]
    async fn postgres_requires_ssl_reply_and_framed_error_without_user() {
        let result = fixture("postgresql", pg_response()).await;
        assert_eq!(result.protocol_confirmed.as_deref(), Some("postgresql"));
        assert!(result.protocol_evidence.unwrap().contains("SQLSTATE 28000"));
        assert!(result.protocol_version.is_none());
        assert!(result.identification_error.is_none());
    }

    #[tokio::test]
    async fn postgres_ssl_accepted_closes_tls_stream_and_uses_fresh_connection() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut first, _) = listener.accept().await.unwrap();
            let mut request = [0; 8];
            first.read_exact(&mut request).await.unwrap();
            assert_eq!(request, SSL_REQUEST);
            first.write_all(b"S").await.unwrap();
            let mut extra = [0; 1];
            assert_eq!(first.read(&mut extra).await.unwrap(), 0);
            let (mut second, _) = listener.accept().await.unwrap();
            let mut startup = [0; 9];
            second.read_exact(&mut startup).await.unwrap();
            assert_eq!(startup, EMPTY_STARTUP);
            second.write_all(&pg_response()).await.unwrap();
            assert_eq!(second.read(&mut extra).await.unwrap(), 0);
        });
        let mut result = result(addr.port());
        identify(&mut result, "postgres", addr, Duration::from_secs(2)).await;
        timeout(Duration::from_secs(3), server)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(result.protocol_confirmed.as_deref(), Some("postgresql"));
        assert!(result
            .protocol_evidence
            .unwrap()
            .contains("SSLRequest accepted"));
    }

    #[tokio::test]
    async fn malformed_frames_never_confirm_a_protocol() {
        let mut smb = smb_response();
        smb[124..126].copy_from_slice(&127u16.to_le_bytes()); // Security buffer overlaps fixed header
        smb[126..128].copy_from_slice(&1u16.to_le_bytes());
        let mut rdp = rdp_response(2, 1);
        rdp[13] = 7; // Wrong RDP_NEG_RSP length
        for (protocol, response) in [
            ("smb", smb),
            ("rdp", rdp),
            (
                "postgresql",
                pg_frame(b"SFATAL\0C28000\0Mmissing final terminator\0"),
            ),
            (
                "postgresql",
                pg_frame(b"SFATAL\0C28000\0C28000\0Mduplicate field\0\0"),
            ),
        ] {
            assert_error(&fixture(protocol, response).await, "malformed_response");
        }
    }

    #[tokio::test]
    async fn truncated_frames_never_confirm_a_protocol() {
        for (protocol, mut response) in [
            ("smb", smb_response()),
            ("rdp", rdp_response(2, 1)),
            ("postgresql", pg_response()),
        ] {
            response.pop();
            assert_error(&fixture(protocol, response).await, "truncated_response");
        }
    }

    #[tokio::test]
    async fn oversized_frames_are_rejected_from_the_length_header() {
        for (protocol, response) in [
            ("smb", vec![0, 0, 32, 0]),              // 8192 body + 4 header
            ("rdp", vec![3, 0, 32, 1]),              // 8193 total
            ("postgresql", vec![b'E', 0, 0, 32, 0]), // Also count SSL byte
        ] {
            assert_error(&fixture(protocol, response).await, "response_too_large");
        }
    }

    #[tokio::test]
    async fn wrong_protocol_and_authentication_requests_never_confirm() {
        let mut non_smb = smb_response();
        non_smb[4] = 0xff; // SMB1 is not the SMB2 dialect we offered
        let mut non_rdp = rdp_response(2, 1);
        non_rdp[5] = 0xe0; // Echoed request rather than a connection confirm
        for (protocol, response) in [
            ("smb", non_smb),
            ("rdp", non_rdp),
            ("postgresql", vec![b'R', 0, 0, 0, 8, 0, 0, 0, 3]),
            ("postgresql", b"HTTP/1.1 200 OK\r\n\r\n".to_vec()),
        ] {
            assert_error(&fixture(protocol, response).await, "protocol_mismatch");
        }
    }

    #[tokio::test]
    async fn postgres_single_ssl_byte_is_insufficient() {
        assert_error(&fixture("postgresql", vec![]).await, "truncated_response");
    }

    #[tokio::test]
    async fn postgres_wrong_ssl_reply_stops_without_startup() {
        for reply in *b"XER" {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = [0; 8];
                socket.read_exact(&mut request).await.unwrap();
                assert_eq!(request, SSL_REQUEST);
                socket.write_all(&[reply]).await.unwrap();
                let mut extra = [0];
                assert_eq!(socket.read(&mut extra).await.unwrap(), 0);
            });
            let mut result = result(addr.port());
            identify(&mut result, "postgresql", addr, Duration::from_secs(1)).await;
            timeout(Duration::from_secs(2), server)
                .await
                .unwrap()
                .unwrap();
            assert_error(&result, "protocol_mismatch");
        }
    }

    #[tokio::test]
    async fn read_limit_includes_framing_and_postgres_ssl_byte() {
        let mut smb = smb_response();
        smb.resize(MAX_READ, 0);
        smb[..4].copy_from_slice(&((MAX_READ - 4) as u32).to_be_bytes());
        smb[124..126].copy_from_slice(&128u16.to_le_bytes());
        smb[126..128].copy_from_slice(&((MAX_READ - 4 - 128) as u16).to_le_bytes());
        assert!(fixture("smb", smb).await.identification_error.is_none());

        let mut body = b"SFATAL\0C28000\0M".to_vec();
        // SSL reply (1) + type/length (5) + fields including final two NULs.
        body.resize(MAX_READ - 1 - 5 - 2, b'x');
        body.extend([0, 0]);
        assert!(fixture("postgresql", pg_frame(&body))
            .await
            .identification_error
            .is_none());
        body.insert(body.len() - 2, b'x');
        assert_error(
            &fixture("postgresql", pg_frame(&body)).await,
            "response_too_large",
        );
    }

    #[tokio::test]
    async fn postgres_second_connection_keeps_original_deadline_and_read_budget() {
        for oversized in [false, true] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                let (mut first, _) = listener.accept().await.unwrap();
                let mut request = [0; 8];
                first.read_exact(&mut request).await.unwrap();
                assert_eq!(request, SSL_REQUEST);
                if !oversized {
                    sleep(Duration::from_millis(150)).await;
                }
                first.write_all(b"S").await.unwrap();
                let mut extra = [0];
                assert_eq!(first.read(&mut extra).await.unwrap(), 0);
                let (mut second, _) = listener.accept().await.unwrap();
                let mut startup = [0; 9];
                second.read_exact(&mut startup).await.unwrap();
                assert_eq!(startup, EMPTY_STARTUP);
                if oversized {
                    // Would fit 8192 if the SSL byte had been forgotten.
                    second.write_all(&[b'E', 0, 0, 31, 255]).await.unwrap();
                } else {
                    sleep(Duration::from_millis(150)).await;
                    let _ = second.write_all(&pg_response()).await;
                }
            });
            let mut result = result(addr.port());
            identify(&mut result, "postgresql", addr, Duration::from_millis(250)).await;
            assert_error(
                &result,
                if oversized {
                    "response_too_large"
                } else {
                    "timeout"
                },
            );
            timeout(Duration::from_secs(2), server)
                .await
                .unwrap()
                .unwrap();
        }
    }

    #[tokio::test]
    async fn caller_cannot_extend_the_five_second_ceiling() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0; 19];
            socket.read_exact(&mut request).await.unwrap();
            assert_eq!(request, RDP_REQUEST);
            let mut extra = [0];
            assert_eq!(socket.read(&mut extra).await.unwrap(), 0);
        });
        let mut result = result(addr.port());
        let start = Instant::now();
        timeout(
            Duration::from_secs(7),
            identify(&mut result, "rdp", addr, Duration::MAX),
        )
        .await
        .expect("deadline must be clamped to five seconds");
        assert_error(&result, "timeout");
        assert!(start.elapsed() >= Duration::from_millis(4900));
        timeout(Duration::from_secs(1), server)
            .await
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    async fn absolute_deadline_stops_trickling_for_each_protocol() {
        for protocol in ["smb", "rdp", "postgresql"] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = vec![
                    0;
                    match protocol {
                        "smb" => 112,
                        "rdp" => 19,
                        _ => 8,
                    }
                ];
                socket.read_exact(&mut request).await.unwrap();
                if protocol == "postgresql" {
                    socket.write_all(b"N").await.unwrap();
                    let mut startup = [0; 9];
                    socket.read_exact(&mut startup).await.unwrap();
                    assert_eq!(startup, EMPTY_STARTUP);
                }
                let response = match protocol {
                    "smb" => smb_response(),
                    "rdp" => rdp_response(2, 1),
                    _ => pg_response(),
                };
                for byte in response {
                    if socket.write_all(&[byte]).await.is_err() {
                        break;
                    }
                    sleep(Duration::from_millis(30)).await;
                }
            });
            let mut result = result(addr.port());
            let start = Instant::now();
            identify(&mut result, protocol, addr, Duration::from_millis(100)).await;
            assert_error(&result, "timeout");
            assert!(start.elapsed() < Duration::from_secs(1));
            server.abort();
            let _ = server.await;
        }
    }

    #[tokio::test]
    async fn zero_budget_and_unknown_protocol_do_not_connect_and_clear_old_evidence() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let mut result = result(addr.port());
        result.protocol_confirmed = Some("old".into());
        result.protocol_evidence = Some("old".into());
        result.protocol_version = Some("old".into());
        identify(&mut result, "smb", addr, Duration::ZERO).await;
        assert_error(&result, "timeout");
        identify(&mut result, "ssh", addr, Duration::from_secs(1)).await;
        assert_error(&result, "unsupported_protocol");
        assert!(timeout(Duration::from_millis(30), listener.accept())
            .await
            .is_err());
    }

    #[test]
    fn validators_reject_inconsistent_and_ambiguous_evidence() {
        for offset in [4, 12, 16, 20, 24, 40, 64, 68] {
            let mut frame = smb_response();
            frame[4 + offset] ^= if offset == 16 { 2 } else { 0x80 };
            assert!(parse_smb(&frame[4..]).is_err(), "offset={offset}");
        }
        for code in [3, 4, 16, 0xffffffff] {
            assert!(parse_rdp(&rdp_response(2, code)[4..]).is_err());
        }
        assert!(parse_rdp(&[6, 0xd0, 0, 0, 0, 0, 0]).is_err());
        for body in [
            b"\0".as_slice(),
            b"SFATAL\0C2800\0Merror\0\0",
            b"SFATAL\0C28<00\0Merror\0\0",
            b"SFATAL\0C28000\0M\0\0",
            b"SNOTICE\0C28000\0Merror\0\0",
            b"SFATAL\0C28000\0Merror\0\0trailing",
        ] {
            assert!(parse_pg_error(body).is_err());
        }
        assert_eq!(
            parse_pg_error(b"Slocalized\0VFATAL\0C28000\0Mlocalized\0\0"),
            Ok("28000")
        );
    }
}
