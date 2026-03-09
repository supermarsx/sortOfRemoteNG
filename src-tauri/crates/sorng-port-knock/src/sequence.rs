use chrono::Utc;
use std::collections::HashSet;
use uuid::Uuid;

use crate::error::PortKnockError;
use crate::types::*;

// ─── Sequence Generation ───────────────────────────────────────────

/// Generate a random knock sequence based on the given parameters.
/// Uses a simple hash-based PRNG seeded from the current timestamp and a UUID
/// to produce port numbers within the configured range.
pub fn generate_sequence(params: &SequenceGenParams) -> KnockSequence {
    let mut steps = Vec::with_capacity(params.length as usize);
    let mut used_ports: HashSet<u16> = HashSet::new();

    // Seed: combine timestamp nanos with a UUID for uniqueness
    let seed_uuid = Uuid::new_v4();
    let seed_bytes = seed_uuid.as_bytes();
    let mut state: u64 = Utc::now().timestamp_nanos_opt().unwrap_or(0) as u64;
    for &b in seed_bytes {
        state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(b as u64);
    }

    let protocols = match (params.allow_tcp, params.allow_udp) {
        (true, true) => vec![KnockProtocol::Tcp, KnockProtocol::Udp],
        (true, false) => vec![KnockProtocol::Tcp],
        (false, true) => vec![KnockProtocol::Udp],
        (false, false) => vec![KnockProtocol::Tcp], // fallback
    };

    let well_known_max: u16 = 1023;
    let min_port = if params.avoid_privileged_ports {
        params.min_port.max(1024)
    } else {
        params.min_port.max(1)
    };
    let max_port = params.max_port;

    for i in 0..params.length {
        // Advance PRNG state
        state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);

        let mut port = min_port + ((state >> 16) as u16) % (max_port - min_port + 1);

        // Skip well-known ports if configured
        if params.avoid_well_known_ports && port <= well_known_max && min_port > well_known_max {
            port = min_port + (port % (max_port - min_port + 1));
        }

        // Ensure no duplicates
        let mut attempts = 0;
        while used_ports.contains(&port) && attempts < 1000 {
            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(i as u64);
            port = min_port + ((state >> 16) as u16) % (max_port - min_port + 1);
            attempts += 1;
        }
        used_ports.insert(port);

        // Select protocol
        state = state
            .wrapping_mul(2862933555777941757)
            .wrapping_add(3037000493);
        let proto = protocols[(state as usize) % protocols.len()];

        steps.push(KnockStep {
            port,
            protocol: proto,
            payload: None,
            delay_after_ms: params.inter_knock_delay_ms,
        });
    }

    let now = Utc::now();
    KnockSequence {
        id: Uuid::new_v4().to_string(),
        name: format!("generated-{}", &Uuid::new_v4().to_string()[..8]),
        steps,
        description: format!(
            "Auto-generated {} step sequence targeting port {}/{}",
            params.length, params.target_port, params.target_protocol
        ),
        target_port: params.target_port,
        target_protocol: params.target_protocol,
        timeout_ms: params.timeout_ms,
        max_retries: 3,
        ip_version: IpVersion::Auto,
        created_at: now,
        updated_at: now,
    }
}

// ─── Sequence Validation ───────────────────────────────────────────

/// Validate that a knock sequence has sensible values.
pub fn validate_sequence(sequence: &KnockSequence) -> Result<(), PortKnockError> {
    if sequence.steps.is_empty() {
        return Err(PortKnockError::InvalidSequence(
            "Sequence has no steps".to_string(),
        ));
    }

    for step in sequence.steps.iter() {
        if step.port == 0 {
            return Err(PortKnockError::InvalidPort(step.port));
        }
    }

    if sequence.target_port == 0 {
        return Err(PortKnockError::InvalidPort(sequence.target_port));
    }

    if sequence.timeout_ms == 0 {
        return Err(PortKnockError::InvalidSequence(
            "Timeout must be greater than zero".to_string(),
        ));
    }

    // Check for duplicate ports
    let mut seen = HashSet::new();
    for step in &sequence.steps {
        if !seen.insert((step.port, step.protocol as u8)) {
            return Err(PortKnockError::InvalidSequence(format!(
                "Duplicate port/protocol combination: {}/{}",
                step.port, step.protocol
            )));
        }
    }

    Ok(())
}

// ─── Base64 Encoding / Decoding ────────────────────────────────────

/// Encode a knock sequence to a base64 JSON string.
pub fn encode_sequence_base64(sequence: &KnockSequence) -> Result<String, PortKnockError> {
    let json = serde_json::to_string(sequence)?;
    Ok(base64_encode(json.as_bytes()))
}

/// Decode a knock sequence from a base64 JSON string.
pub fn decode_sequence_base64(encoded: &str) -> Result<KnockSequence, PortKnockError> {
    let bytes = base64_decode(encoded)
        .map_err(|e| PortKnockError::InvalidSequence(format!("Invalid base64: {}", e)))?;
    let json = String::from_utf8(bytes).map_err(|e| {
        PortKnockError::InvalidSequence(format!("Invalid UTF-8 in decoded base64: {}", e))
    })?;
    let sequence: KnockSequence = serde_json::from_str(&json)?;
    Ok(sequence)
}

// ─── Hex Encoding / Decoding ───────────────────────────────────────

/// Encode a knock sequence to a hex-encoded JSON string.
pub fn encode_sequence_hex(sequence: &KnockSequence) -> Result<String, PortKnockError> {
    let json = serde_json::to_string(sequence)?;
    Ok(hex_encode(json.as_bytes()))
}

/// Decode a knock sequence from a hex-encoded JSON string.
pub fn decode_sequence_hex(encoded: &str) -> Result<KnockSequence, PortKnockError> {
    let bytes = hex_decode(encoded)
        .map_err(|e| PortKnockError::InvalidSequence(format!("Invalid hex: {}", e)))?;
    let json = String::from_utf8(bytes).map_err(|e| {
        PortKnockError::InvalidSequence(format!("Invalid UTF-8 in decoded hex: {}", e))
    })?;
    let sequence: KnockSequence = serde_json::from_str(&json)?;
    Ok(sequence)
}

// ─── knockd Format ─────────────────────────────────────────────────

/// Convert a knock sequence to knockd.conf format string.
/// Output example: `"7000:tcp,8000:udp,9000:tcp"`
pub fn sequence_to_knockd_format(sequence: &KnockSequence) -> String {
    sequence
        .steps
        .iter()
        .map(|step| {
            let proto = match step.protocol {
                KnockProtocol::Tcp => "tcp",
                KnockProtocol::Udp => "udp",
            };
            format!("{}:{}", step.port, proto)
        })
        .collect::<Vec<_>>()
        .join(",")
}

/// Parse a knockd-format string like `"7000:tcp,8000:udp,9000:tcp"` into a KnockSequence.
pub fn sequence_from_knockd_format(s: &str, name: &str) -> Result<KnockSequence, PortKnockError> {
    let mut steps = Vec::new();

    for (i, part) in s.split(',').enumerate() {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }

        let segments: Vec<&str> = part.split(':').collect();
        if segments.len() != 2 {
            return Err(PortKnockError::InvalidSequence(format!(
                "Invalid knockd format at position {}: '{}'",
                i, part
            )));
        }

        let port: u16 = segments[0]
            .parse()
            .map_err(|_| PortKnockError::InvalidPort(0))?;

        let protocol = match segments[1].to_lowercase().as_str() {
            "tcp" => KnockProtocol::Tcp,
            "udp" => KnockProtocol::Udp,
            other => {
                return Err(PortKnockError::InvalidProtocol(other.to_string()));
            }
        };

        steps.push(KnockStep {
            port,
            protocol,
            payload: None,
            delay_after_ms: 500,
        });
    }

    if steps.is_empty() {
        return Err(PortKnockError::InvalidSequence(
            "Empty knockd format string".to_string(),
        ));
    }

    let now = Utc::now();
    Ok(KnockSequence {
        id: Uuid::new_v4().to_string(),
        name: name.to_string(),
        steps,
        description: format!("Imported from knockd format: {}", s),
        target_port: 22,
        target_protocol: KnockProtocol::Tcp,
        timeout_ms: 15000,
        max_retries: 3,
        ip_version: IpVersion::Auto,
        created_at: now,
        updated_at: now,
    })
}

// ─── Complexity Score ──────────────────────────────────────────────

/// Calculate a complexity score from 0.0 to 100.0 for a knock sequence.
/// Factors: number of steps, port diversity, protocol mixing, use of high ports,
/// and payload presence.
pub fn calculate_complexity_score(sequence: &KnockSequence) -> f64 {
    if sequence.steps.is_empty() {
        return 0.0;
    }

    let step_count = sequence.steps.len() as f64;

    // Length score: more steps = higher score, capped contribution at ~30 points
    // 1 step → ~5, 4 steps → ~20, 8+ steps → ~30
    let length_score = (step_count.ln() * 10.0 + 5.0).min(30.0);

    // Port diversity: ratio of unique ports to total steps (max 20 points)
    let unique_ports: HashSet<u16> = sequence.steps.iter().map(|s| s.port).collect();
    let diversity_ratio = unique_ports.len() as f64 / step_count;
    let diversity_score = diversity_ratio * 20.0;

    // Protocol mix: using both TCP and UDP is better (max 15 points)
    let has_tcp = sequence
        .steps
        .iter()
        .any(|s| s.protocol == KnockProtocol::Tcp);
    let has_udp = sequence
        .steps
        .iter()
        .any(|s| s.protocol == KnockProtocol::Udp);
    let protocol_score = match (has_tcp, has_udp) {
        (true, true) => 15.0,
        _ => 7.0,
    };

    // High port usage: ports > 10000 are less guessable (max 15 points)
    let high_port_ratio =
        sequence.steps.iter().filter(|s| s.port > 10000).count() as f64 / step_count;
    let high_port_score = high_port_ratio * 15.0;

    // Payload presence: using custom payloads adds complexity (max 10 points)
    let payload_ratio = sequence
        .steps
        .iter()
        .filter(|s| s.payload.is_some())
        .count() as f64
        / step_count;
    let payload_score = payload_ratio * 10.0;

    // Port range spread (max 10 points)
    let min_port = sequence.steps.iter().map(|s| s.port).min().unwrap_or(0) as f64;
    let max_port = sequence.steps.iter().map(|s| s.port).max().unwrap_or(0) as f64;
    let spread = if max_port > min_port {
        ((max_port - min_port) / 65535.0 * 10.0).min(10.0)
    } else {
        0.0
    };

    let total =
        length_score + diversity_score + protocol_score + high_port_score + payload_score + spread;
    total.clamp(0.0, 100.0)
}

// ─── Merge & Reverse ───────────────────────────────────────────────

/// Merge two sequences into one combined sequence.
pub fn merge_sequences(a: &KnockSequence, b: &KnockSequence) -> KnockSequence {
    let mut steps = a.steps.clone();
    steps.extend(b.steps.clone());

    let now = Utc::now();
    KnockSequence {
        id: Uuid::new_v4().to_string(),
        name: format!("{} + {}", a.name, b.name),
        steps,
        description: format!("Merged from '{}' and '{}'", a.name, b.name),
        target_port: a.target_port,
        target_protocol: a.target_protocol,
        timeout_ms: a.timeout_ms.max(b.timeout_ms),
        max_retries: a.max_retries.min(b.max_retries),
        ip_version: a.ip_version,
        created_at: now,
        updated_at: now,
    }
}

/// Reverse a sequence to create the "close" sequence (reverse step order).
pub fn reverse_sequence(sequence: &KnockSequence) -> KnockSequence {
    let mut steps = sequence.steps.clone();
    steps.reverse();

    let now = Utc::now();
    KnockSequence {
        id: Uuid::new_v4().to_string(),
        name: format!("{} (reverse)", sequence.name),
        steps,
        description: format!("Reverse of '{}'", sequence.name),
        target_port: sequence.target_port,
        target_protocol: sequence.target_protocol,
        timeout_ms: sequence.timeout_ms,
        max_retries: sequence.max_retries,
        ip_version: sequence.ip_version,
        created_at: now,
        updated_at: now,
    }
}

// ─── Time-Based One-Time Knock ─────────────────────────────────────

/// Generate a time-based one-time knock sequence.
/// Uses an HMAC-like derivation of the current time window combined with a secret
/// to produce deterministic-but-rotating port numbers. Both client and server
/// using the same secret and time window will derive the same sequence.
pub fn generate_time_based_sequence(params: &SequenceGenParams, secret: &str) -> KnockSequence {
    // 30-second time window (similar to TOTP)
    let window = Utc::now().timestamp() / 30;

    // Derive a seed by hashing the window and secret together
    let mut state = hash_seed(secret.as_bytes(), window as u64);

    let protocols = match (params.allow_tcp, params.allow_udp) {
        (true, true) => vec![KnockProtocol::Tcp, KnockProtocol::Udp],
        (true, false) => vec![KnockProtocol::Tcp],
        (false, true) => vec![KnockProtocol::Udp],
        (false, false) => vec![KnockProtocol::Tcp],
    };

    let min_port = if params.avoid_privileged_ports {
        params.min_port.max(1024)
    } else {
        params.min_port.max(1)
    };
    let max_port = params.max_port;

    let mut steps = Vec::with_capacity(params.length as usize);
    let mut used_ports: HashSet<u16> = HashSet::new();

    for i in 0..params.length {
        state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(i as u64 + 1);
        let mut port = min_port + ((state >> 16) as u16) % (max_port - min_port + 1);

        let mut attempts = 0;
        while used_ports.contains(&port) && attempts < 1000 {
            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(attempts);
            port = min_port + ((state >> 16) as u16) % (max_port - min_port + 1);
            attempts += 1;
        }
        used_ports.insert(port);

        state = state
            .wrapping_mul(2862933555777941757)
            .wrapping_add(3037000493);
        let proto = protocols[(state as usize) % protocols.len()];

        steps.push(KnockStep {
            port,
            protocol: proto,
            payload: None,
            delay_after_ms: params.inter_knock_delay_ms,
        });
    }

    let now = Utc::now();
    KnockSequence {
        id: Uuid::new_v4().to_string(),
        name: format!("totp-{}", window),
        steps,
        description: format!(
            "Time-based sequence for window {} targeting port {}/{}",
            window, params.target_port, params.target_protocol
        ),
        target_port: params.target_port,
        target_protocol: params.target_protocol,
        timeout_ms: params.timeout_ms,
        max_retries: 1,
        ip_version: IpVersion::Auto,
        created_at: now,
        updated_at: now,
    }
}

// ─── Internal Helpers ──────────────────────────────────────────────

/// Simple base64 encoder (no external dependency).
fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

/// Simple base64 decoder (no external dependency).
fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    fn char_to_val(c: u8) -> Result<u32, String> {
        match c {
            b'A'..=b'Z' => Ok((c - b'A') as u32),
            b'a'..=b'z' => Ok((c - b'a' + 26) as u32),
            b'0'..=b'9' => Ok((c - b'0' + 52) as u32),
            b'+' => Ok(62),
            b'/' => Ok(63),
            b'=' => Ok(0),
            _ => Err(format!("Invalid base64 character: {}", c as char)),
        }
    }

    let input = input.trim();
    if input.len() % 4 != 0 {
        return Err("Base64 input length is not a multiple of 4".to_string());
    }

    let bytes = input.as_bytes();
    let mut result = Vec::with_capacity(input.len() * 3 / 4);

    for chunk in bytes.chunks(4) {
        let v0 = char_to_val(chunk[0])?;
        let v1 = char_to_val(chunk[1])?;
        let v2 = char_to_val(chunk[2])?;
        let v3 = char_to_val(chunk[3])?;
        let triple = (v0 << 18) | (v1 << 12) | (v2 << 6) | v3;

        result.push(((triple >> 16) & 0xFF) as u8);
        if chunk[2] != b'=' {
            result.push(((triple >> 8) & 0xFF) as u8);
        }
        if chunk[3] != b'=' {
            result.push((triple & 0xFF) as u8);
        }
    }

    Ok(result)
}

/// Simple hex encoder.
fn hex_encode(data: &[u8]) -> String {
    data.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Simple hex decoder.
fn hex_decode(input: &str) -> Result<Vec<u8>, String> {
    let input = input.trim();
    if input.len() % 2 != 0 {
        return Err("Hex input length must be even".to_string());
    }
    (0..input.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&input[i..i + 2], 16)
                .map_err(|e| format!("Invalid hex at position {}: {}", i, e))
        })
        .collect()
}

/// Derive a u64 hash seed from a secret and a counter value.
/// Uses a simple FNV-1a–style mixing for deterministic output.
fn hash_seed(secret: &[u8], counter: u64) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325; // FNV offset basis
    for &b in secret {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3); // FNV prime
    }
    // Mix in the counter bytes
    for i in 0..8 {
        let byte = ((counter >> (i * 8)) & 0xFF) as u8;
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}
