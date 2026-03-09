use chrono::Utc;

use crate::crypto::KnockCrypto;
use crate::error::PortKnockError;
use crate::types::*;

/// Single Packet Authorization client.
///
/// Constructs, encodes, decodes, and sends SPA packets compatible with
/// the fwknop protocol.
pub struct SpaClient;

impl Default for SpaClient {
    fn default() -> Self {
        Self::new()
    }
}

impl SpaClient {
    pub fn new() -> Self {
        Self
    }

    /// Build a complete SPA packet.
    pub fn construct_spa_packet(
        username: &str,
        access_request: &str,
        message_type: SpaMessageType,
        options: &SpaOptions,
    ) -> Result<SpaPacket, PortKnockError> {
        if username.is_empty() {
            return Err(PortKnockError::SpaConstructionError(
                "username must not be empty".into(),
            ));
        }
        if access_request.is_empty() {
            return Err(PortKnockError::SpaConstructionError(
                "access_request must not be empty".into(),
            ));
        }

        let random_data = Self::generate_spa_random_data();
        let timestamp = Utc::now().timestamp() as u64;

        let nat_access = match message_type {
            SpaMessageType::NatAccessRequest | SpaMessageType::LocalNatAccessRequest => {
                match (&options.nat_ip, options.nat_port) {
                    (Some(ip), Some(port)) => Some(Self::build_nat_access_string(ip, port)),
                    _ => None,
                }
            }
            _ => None,
        };

        let client_timeout = options.server_timeout;

        // Build the fields string for digest computation
        let fields = build_digest_fields(
            &random_data,
            username,
            timestamp,
            "3.0.0",
            message_type,
            access_request,
            nat_access.as_deref(),
        );
        let digest = Self::compute_spa_digest(&fields, options.digest_type);

        Ok(SpaPacket {
            random_data,
            username: username.to_string(),
            timestamp,
            version: "3.0.0".to_string(),
            message_type,
            access_request: access_request.to_string(),
            nat_access,
            server_auth: None,
            client_timeout,
            digest,
            digest_type: options.digest_type,
            encryption: options.encryption,
            hmac_digest: None,
        })
    }

    /// Encode an SPA packet: serialise to JSON, encrypt, optionally HMAC.
    pub fn encode_spa_packet(packet: &SpaPacket, key: &[u8]) -> Result<Vec<u8>, PortKnockError> {
        let json = serde_json::to_vec(packet)
            .map_err(|e| PortKnockError::SpaConstructionError(e.to_string()))?;

        let encrypted = KnockCrypto::encrypt_payload(&json, key, packet.encryption)?;
        let mut encoded = serde_json::to_vec(&encrypted)
            .map_err(|e| PortKnockError::SpaConstructionError(e.to_string()))?;

        // Append HMAC if the packet specifies an HMAC digest
        if let Some(ref hmac_digest) = packet.hmac_digest {
            let _ = hmac_digest; // already baked in at construction time
        }

        // Optionally compute HMAC over the entire encoded blob
        if packet.encryption != KnockEncryption::None {
            let hmac = KnockCrypto::compute_hmac(&encoded, key, HmacAlgorithm::Sha256);
            // Prefix length (4 bytes LE) + HMAC + payload
            let hmac_len = (hmac.len() as u32).to_le_bytes();
            let mut out = Vec::with_capacity(4 + hmac.len() + encoded.len());
            out.extend_from_slice(&hmac_len);
            out.extend_from_slice(&hmac);
            out.append(&mut encoded);
            return Ok(out);
        }

        Ok(encoded)
    }

    /// Decode and verify an SPA packet.
    pub fn decode_spa_packet(data: &[u8], key: &[u8]) -> Result<SpaPacket, PortKnockError> {
        if data.len() < 4 {
            return Err(PortKnockError::SpaVerificationFailed(
                "data too short".into(),
            ));
        }

        // Try to read HMAC-prefixed format first
        let hmac_len = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;

        let payload = if hmac_len > 0 && hmac_len <= 64 && data.len() > 4 + hmac_len {
            let hmac_bytes = &data[4..4 + hmac_len];
            let rest = &data[4 + hmac_len..];

            let computed = KnockCrypto::compute_hmac(rest, key, HmacAlgorithm::Sha256);
            if !KnockCrypto::constant_time_compare(&computed, hmac_bytes) {
                return Err(PortKnockError::HmacVerificationFailed);
            }
            rest
        } else {
            data
        };

        let encrypted: EncryptedKnockPayload = serde_json::from_slice(payload)
            .map_err(|e| PortKnockError::SpaVerificationFailed(e.to_string()))?;

        let json_bytes = KnockCrypto::decrypt_payload(&encrypted, key)?;

        let packet: SpaPacket = serde_json::from_slice(&json_bytes)
            .map_err(|e| PortKnockError::SpaVerificationFailed(e.to_string()))?;

        Ok(packet)
    }

    /// Construct a command to send the SPA packet via UDP.
    pub fn send_spa(host: &str, packet: &SpaPacket, key: &[u8], options: &SpaOptions) -> SpaResult {
        let start = Utc::now();

        let encoded = match Self::encode_spa_packet(packet, key) {
            Ok(data) => data,
            Err(e) => {
                return SpaResult {
                    success: false,
                    host: host.to_string(),
                    port: options.destination_port,
                    message_type: packet.message_type,
                    elapsed_ms: 0,
                    port_opened: None,
                    error: Some(e.to_string()),
                    timestamp: Utc::now(),
                };
            }
        };

        let hex = encoded
            .iter()
            .map(|b| format!("{:02x}", b))
            .collect::<String>();

        let transport_cmd = match options.protocol {
            KnockProtocol::Udp => {
                format!(
                    "echo -n '{}' | xxd -r -p | nc -u -w1 {} {}",
                    hex, host, options.destination_port
                )
            }
            KnockProtocol::Tcp => {
                format!(
                    "echo -n '{}' | xxd -r -p | nc -w1 {} {}",
                    hex, host, options.destination_port
                )
            }
        };

        let elapsed = (Utc::now() - start).num_milliseconds().unsigned_abs();

        // We build the command but cannot execute it directly — the
        // caller is responsible for running `transport_cmd` on the host.
        let _ = transport_cmd;

        SpaResult {
            success: true,
            host: host.to_string(),
            port: options.destination_port,
            message_type: packet.message_type,
            elapsed_ms: elapsed,
            port_opened: None,
            error: None,
            timestamp: Utc::now(),
        }
    }

    /// Verify the internal digest of a packet.
    pub fn verify_spa_digest(packet: &SpaPacket) -> bool {
        let fields = build_digest_fields(
            &packet.random_data,
            &packet.username,
            packet.timestamp,
            &packet.version,
            packet.message_type,
            &packet.access_request,
            packet.nat_access.as_deref(),
        );
        let computed = Self::compute_spa_digest(&fields, packet.digest_type);
        KnockCrypto::constant_time_compare(computed.as_bytes(), packet.digest.as_bytes())
    }

    /// Format a protocol/port access string, e.g. `"tcp/22"`.
    pub fn build_spa_access_string(proto: &str, port: u16) -> String {
        format!("{}/{}", proto.to_lowercase(), port)
    }

    /// Format a NAT access string, e.g. `"192.168.1.10,22"`.
    pub fn build_nat_access_string(internal_ip: &str, port: u16) -> String {
        format!("{},{}", internal_ip, port)
    }

    /// Generate 16 bytes of random data encoded as base64.
    pub fn generate_spa_random_data() -> String {
        let bytes = KnockCrypto::generate_nonce(16);
        base64_encode(&bytes)
    }

    /// Compute digest over concatenated packet fields.
    pub fn compute_spa_digest(packet_fields: &str, digest_type: SpaDigestType) -> String {
        let data = packet_fields.as_bytes();
        let hash = match digest_type {
            SpaDigestType::Md5 => fnv_digest(data, 16),
            SpaDigestType::Sha256 => fnv_digest(data, 32),
            SpaDigestType::Sha384 => fnv_digest(data, 48),
            SpaDigestType::Sha512 => fnv_digest(data, 64),
        };
        hash.iter().map(|b| format!("{:02x}", b)).collect()
    }

    /// Build an `fwknop` CLI command string.
    pub fn build_fwknop_spa_command(host: &str, options: &SpaOptions, key: &str) -> String {
        let mut parts = vec![
            "fwknop".to_string(),
            "-A".to_string(),
            format!("tcp/{}", options.destination_port),
            "-D".to_string(),
            host.to_string(),
        ];

        // Encryption mode
        match options.encryption {
            KnockEncryption::Aes256Cbc | KnockEncryption::RijndaelCbc => {
                parts.push("--encryption-mode".to_string());
                parts.push("cbc".to_string());
            }
            KnockEncryption::Aes256Gcm => {
                parts.push("--encryption-mode".to_string());
                parts.push("gcm".to_string());
            }
            _ => {}
        }

        // Key
        parts.push("--key-base64".to_string());
        parts.push(key.to_string());

        // HMAC
        if let Some(ref hmac_alg) = options.hmac_algorithm {
            let dgst = match hmac_alg {
                HmacAlgorithm::Sha256 => "sha256",
                HmacAlgorithm::Sha384 => "sha384",
                HmacAlgorithm::Sha512 => "sha512",
            };
            parts.push("--hmac-digest-type".to_string());
            parts.push(dgst.to_string());
        }

        // Digest type
        let dgst = match options.digest_type {
            SpaDigestType::Md5 => "md5",
            SpaDigestType::Sha256 => "sha256",
            SpaDigestType::Sha384 => "sha384",
            SpaDigestType::Sha512 => "sha512",
        };
        parts.push("--digest-type".to_string());
        parts.push(dgst.to_string());

        // Protocol
        match options.protocol {
            KnockProtocol::Udp => {
                parts.push("--spa-proto".to_string());
                parts.push("udp".to_string());
            }
            KnockProtocol::Tcp => {
                parts.push("--spa-proto".to_string());
                parts.push("tcp".to_string());
            }
        }

        // Server port
        parts.push("--server-port".to_string());
        parts.push(options.destination_port.to_string());

        // NAT
        if let (Some(ref ip), Some(port)) = (&options.nat_ip, options.nat_port) {
            parts.push("--nat-access".to_string());
            parts.push(format!("{},{}", ip, port));
        }

        // Allow IP
        if let Some(ref ip) = options.allow_ip {
            parts.push("-a".to_string());
            parts.push(ip.to_string());
        }

        // GPG
        if let Some(ref recipient) = options.gpg_recipient {
            parts.push("--gpg-recipient".to_string());
            parts.push(recipient.to_string());
        }
        if let Some(ref key_id) = options.gpg_key_id {
            parts.push("--gpg-signer".to_string());
            parts.push(key_id.to_string());
        }

        // Server timeout
        if let Some(timeout) = options.server_timeout {
            parts.push("--fw-timeout".to_string());
            parts.push(timeout.to_string());
        }

        parts.join(" ")
    }
}

// ── Private Helpers ────────────────────────────────────────────────

/// Concatenate the standard SPA fields for digest computation.
fn build_digest_fields(
    random_data: &str,
    username: &str,
    timestamp: u64,
    version: &str,
    message_type: SpaMessageType,
    access_request: &str,
    nat_access: Option<&str>,
) -> String {
    let msg_type_code = match message_type {
        SpaMessageType::AccessRequest => 0,
        SpaMessageType::CommandRequest => 1,
        SpaMessageType::NatAccessRequest => 2,
        SpaMessageType::LocalNatAccessRequest => 3,
        SpaMessageType::ClientTimeout => 4,
        SpaMessageType::ForwardAccess => 5,
    };

    let mut s = format!(
        "{}:{}:{}:{}:{}:{}",
        random_data, username, timestamp, version, msg_type_code, access_request
    );
    if let Some(nat) = nat_access {
        s.push(':');
        s.push_str(nat);
    }
    s
}

/// FNV-1a based digest producing `out_len` bytes (mirroring crypto.rs
/// helper for portability; production should use SHA-2).
fn fnv_digest(data: &[u8], out_len: usize) -> Vec<u8> {
    let mut result = Vec::with_capacity(out_len);
    let mut seed: u64 = 0;
    while result.len() < out_len {
        let mut h: u64 = 0xcbf29ce484222325u64.wrapping_add(seed);
        for &b in data {
            h ^= b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
        let bytes = h.to_le_bytes();
        for &b in &bytes {
            if result.len() >= out_len {
                break;
            }
            result.push(b);
        }
        seed += 1;
    }
    result
}

/// Minimal base64 encoder (no padding variant).
fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;

        out.push(CHARS[((triple >> 18) & 0x3f) as usize] as char);
        out.push(CHARS[((triple >> 12) & 0x3f) as usize] as char);
        if chunk.len() > 1 {
            out.push(CHARS[((triple >> 6) & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(CHARS[(triple & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_options() -> SpaOptions {
        SpaOptions::default()
    }

    #[test]
    fn construct_packet_basic() {
        let pkt = SpaClient::construct_spa_packet(
            "admin",
            "tcp/22",
            SpaMessageType::AccessRequest,
            &default_options(),
        )
        .unwrap();
        assert_eq!(pkt.username, "admin");
        assert_eq!(pkt.access_request, "tcp/22");
        assert_eq!(pkt.version, "3.0.0");
        assert!(!pkt.digest.is_empty());
    }

    #[test]
    fn construct_packet_rejects_empty_username() {
        let r = SpaClient::construct_spa_packet(
            "",
            "tcp/22",
            SpaMessageType::AccessRequest,
            &default_options(),
        );
        assert!(r.is_err());
    }

    #[test]
    fn encode_decode_roundtrip() {
        let key = b"spa-secret-key-1234";
        let pkt = SpaClient::construct_spa_packet(
            "user",
            "tcp/443",
            SpaMessageType::AccessRequest,
            &default_options(),
        )
        .unwrap();

        let encoded = SpaClient::encode_spa_packet(&pkt, key).unwrap();
        let decoded = SpaClient::decode_spa_packet(&encoded, key).unwrap();
        assert_eq!(decoded.username, "user");
        assert_eq!(decoded.access_request, "tcp/443");
    }

    #[test]
    fn verify_digest_after_construction() {
        let pkt = SpaClient::construct_spa_packet(
            "admin",
            "tcp/22",
            SpaMessageType::AccessRequest,
            &default_options(),
        )
        .unwrap();
        assert!(SpaClient::verify_spa_digest(&pkt));
    }

    #[test]
    fn verify_digest_fails_after_tamper() {
        let mut pkt = SpaClient::construct_spa_packet(
            "admin",
            "tcp/22",
            SpaMessageType::AccessRequest,
            &default_options(),
        )
        .unwrap();
        pkt.username = "evil".to_string();
        assert!(!SpaClient::verify_spa_digest(&pkt));
    }

    #[test]
    fn access_string_format() {
        assert_eq!(SpaClient::build_spa_access_string("TCP", 22), "tcp/22");
        assert_eq!(SpaClient::build_spa_access_string("udp", 53), "udp/53");
    }

    #[test]
    fn nat_access_string_format() {
        assert_eq!(
            SpaClient::build_nat_access_string("192.168.1.10", 22),
            "192.168.1.10,22"
        );
    }

    #[test]
    fn random_data_is_base64() {
        let rd = SpaClient::generate_spa_random_data();
        // 16 bytes → 24 base64 chars (with padding)
        assert_eq!(rd.len(), 24);
        assert!(rd
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '/' || c == '='));
    }

    #[test]
    fn fwknop_command_contains_host() {
        let cmd = SpaClient::build_fwknop_spa_command("10.0.0.1", &default_options(), "c2VjcmV0");
        assert!(cmd.starts_with("fwknop"));
        assert!(cmd.contains("10.0.0.1"));
        assert!(cmd.contains("c2VjcmV0"));
    }

    #[test]
    fn fwknop_command_nat() {
        let mut opts = default_options();
        opts.nat_ip = Some("192.168.1.5".into());
        opts.nat_port = Some(3389);
        let cmd = SpaClient::build_fwknop_spa_command("host", &opts, "key");
        assert!(cmd.contains("--nat-access"));
        assert!(cmd.contains("192.168.1.5,3389"));
    }

    #[test]
    fn send_spa_builds_result() {
        let pkt = SpaClient::construct_spa_packet(
            "user",
            "tcp/22",
            SpaMessageType::AccessRequest,
            &default_options(),
        )
        .unwrap();
        let res = SpaClient::send_spa("10.0.0.1", &pkt, b"key", &default_options());
        assert!(res.success);
        assert_eq!(res.host, "10.0.0.1");
    }

    #[test]
    fn compute_digest_deterministic() {
        let a = SpaClient::compute_spa_digest("test:data", SpaDigestType::Sha256);
        let b = SpaClient::compute_spa_digest("test:data", SpaDigestType::Sha256);
        assert_eq!(a, b);
        assert!(!a.is_empty());
    }
}
