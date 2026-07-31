//! # SSH Agent Protocol Codec
//!
//! Implementation of the SSH agent wire protocol as specified in
//! draft-miller-ssh-agent. Handles encoding and decoding of all
//! agent message types for both requests and responses.

/// Maximum SSH-agent payload accepted from any local or bridged peer.
pub const MAX_AGENT_PAYLOAD_LEN: usize = 256 * 1024;
/// Maximum public/private key field accepted by the codec.
pub const MAX_KEY_DATA_LEN: usize = 128 * 1024;
/// Maximum text field accepted from an agent peer.
pub const MAX_TEXT_LEN: usize = 4 * 1024;
/// Maximum identities accepted in a single response.
pub const MAX_IDENTITIES: usize = 1024;

// ── Protocol Constants ──────────────────────────────────────────────

/// Protocol message type constants (draft-miller-ssh-agent §7).
pub mod msg {
    // ── Requests ──
    pub const SSH_AGENTC_REQUEST_IDENTITIES: u8 = 11;
    pub const SSH_AGENTC_SIGN_REQUEST: u8 = 13;
    pub const SSH_AGENTC_ADD_IDENTITY: u8 = 17;
    pub const SSH_AGENTC_REMOVE_IDENTITY: u8 = 18;
    pub const SSH_AGENTC_REMOVE_ALL_IDENTITIES: u8 = 19;
    pub const SSH_AGENTC_ADD_ID_CONSTRAINED: u8 = 25;
    pub const SSH_AGENTC_ADD_SMARTCARD_KEY: u8 = 20;
    pub const SSH_AGENTC_REMOVE_SMARTCARD_KEY: u8 = 21;
    pub const SSH_AGENTC_LOCK: u8 = 22;
    pub const SSH_AGENTC_UNLOCK: u8 = 23;
    pub const SSH_AGENTC_ADD_SMARTCARD_KEY_CONSTRAINED: u8 = 26;
    pub const SSH_AGENTC_EXTENSION: u8 = 27;

    // ── Responses ──
    pub const SSH_AGENT_FAILURE: u8 = 5;
    pub const SSH_AGENT_SUCCESS: u8 = 6;
    pub const SSH_AGENT_IDENTITIES_ANSWER: u8 = 12;
    pub const SSH_AGENT_SIGN_RESPONSE: u8 = 14;
    pub const SSH_AGENT_EXTENSION_FAILURE: u8 = 28;

    // ── Constraint types ──
    pub const SSH_AGENT_CONSTRAIN_LIFETIME: u8 = 1;
    pub const SSH_AGENT_CONSTRAIN_CONFIRM: u8 = 2;
    pub const SSH_AGENT_CONSTRAIN_EXTENSION: u8 = 255;

    // ── Sign flags ──
    pub const SSH_AGENT_RSA_SHA2_256: u32 = 2;
    pub const SSH_AGENT_RSA_SHA2_512: u32 = 4;
}

// ── Agent Message ───────────────────────────────────────────────────

/// Parsed SSH agent protocol message.
#[derive(Debug, Clone)]
pub enum AgentMessage {
    // ── Requests (from client) ──
    /// Request a list of all public keys held by the agent.
    RequestIdentities,

    /// Request the agent to sign data with a key.
    SignRequest {
        /// Public key blob (wire format).
        key_blob: Vec<u8>,
        /// Data to sign.
        data: Vec<u8>,
        /// Flags (e.g. SSH_AGENT_RSA_SHA2_256).
        flags: u32,
    },

    /// Add a private key to the agent.
    AddIdentity {
        /// Key type name (e.g. "ssh-ed25519").
        key_type: String,
        /// Key material (type-specific blob).
        key_data: Vec<u8>,
        /// Comment string.
        comment: String,
    },

    /// Add a private key with constraints.
    AddIdentityConstrained {
        /// Key type name.
        key_type: String,
        /// Key material.
        key_data: Vec<u8>,
        /// Comment string.
        comment: String,
        /// Constraints.
        constraints: Vec<ProtocolConstraint>,
    },

    /// Remove a specific key.
    RemoveIdentity {
        /// Public key blob.
        key_blob: Vec<u8>,
    },

    /// Remove all keys.
    RemoveAllIdentities,

    /// Add a key from a PKCS#11 token.
    AddSmartcardKey {
        /// PKCS#11 provider library path.
        provider: String,
        /// PIN.
        pin: String,
    },

    /// Add a PKCS#11 key with constraints.
    AddSmartcardKeyConstrained {
        provider: String,
        pin: String,
        constraints: Vec<ProtocolConstraint>,
    },

    /// Remove PKCS#11 keys.
    RemoveSmartcardKey { provider: String, pin: String },

    /// Lock the agent with a passphrase.
    Lock { passphrase: String },

    /// Unlock the agent.
    Unlock { passphrase: String },

    /// Extension request (session-bind@openssh.com, etc.).
    Extension { name: String, data: Vec<u8> },

    // ── Responses (from agent) ──
    /// Generic success.
    Success,

    /// Generic failure.
    Failure,

    /// List of identities.
    IdentitiesAnswer { identities: Vec<ProtocolIdentity> },

    /// Signature response.
    SignResponse { signature: Vec<u8> },

    /// Extension failure.
    ExtensionFailure,
}

/// An identity in the protocol (public key + comment).
#[derive(Debug, Clone)]
pub struct ProtocolIdentity {
    /// Public key blob (wire format).
    pub key_blob: Vec<u8>,
    /// Comment.
    pub comment: String,
}

/// A constraint in the wire protocol.
#[derive(Debug, Clone)]
pub struct ProtocolConstraint {
    /// Constraint type byte.
    pub constraint_type: u8,
    /// Constraint data.
    pub data: Vec<u8>,
}

// ── Wire Format Helpers ─────────────────────────────────────────────

/// Read a u32 from a byte slice (big-endian, SSH wire format).
pub fn read_u32(data: &[u8], offset: usize) -> Result<(u32, usize), String> {
    if offset + 4 > data.len() {
        return Err("Buffer underflow reading u32".to_string());
    }
    let val = u32::from_be_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
    ]);
    Ok((val, offset + 4))
}

/// Read a string (length-prefixed) from a byte slice.
pub fn read_string(data: &[u8], offset: usize) -> Result<(Vec<u8>, usize), String> {
    let (len, offset) = read_u32(data, offset)?;
    let len = len as usize;
    if offset + len > data.len() {
        return Err("Buffer underflow reading string".to_string());
    }
    let val = data[offset..offset + len].to_vec();
    Ok((val, offset + len))
}

/// Read a UTF-8 string.
pub fn read_utf8_string(data: &[u8], offset: usize) -> Result<(String, usize), String> {
    let (bytes, offset) = read_string(data, offset)?;
    let s = String::from_utf8(bytes).map_err(|e| format!("Invalid UTF-8: {}", e))?;
    Ok((s, offset))
}

/// Write a u32 in big-endian.
pub fn write_u32(val: u32) -> Vec<u8> {
    val.to_be_bytes().to_vec()
}

/// Write a length-prefixed string.
pub fn write_string(data: &[u8]) -> Vec<u8> {
    let mut buf = write_u32(data.len() as u32);
    buf.extend_from_slice(data);
    buf
}

/// Validate an identities answer before any aggregate response buffer is
/// allocated. The returned length is the SSH-agent payload length and does not
/// include the four-byte packet prefix.
pub fn validate_identities_answer<'a, I>(identities: I) -> Result<usize, String>
where
    I: IntoIterator<Item = (&'a [u8], &'a str)>,
{
    // Message type plus identity count.
    let mut payload_len = 1usize + 4;
    let mut identity_count = 0usize;

    for (key_blob, comment) in identities {
        identity_count = identity_count
            .checked_add(1)
            .ok_or_else(|| "SSH-agent identity count overflow".to_string())?;
        ensure_limit("identity count", identity_count, MAX_IDENTITIES)?;
        ensure_limit("identity key", key_blob.len(), MAX_KEY_DATA_LEN)?;
        ensure_limit("identity comment", comment.len(), MAX_TEXT_LEN)?;

        payload_len = payload_len
            .checked_add(4)
            .and_then(|len| len.checked_add(key_blob.len()))
            .and_then(|len| len.checked_add(4))
            .and_then(|len| len.checked_add(comment.len()))
            .ok_or_else(|| "SSH-agent identity response length overflow".to_string())?;
        ensure_limit(
            "identity response payload",
            payload_len,
            MAX_AGENT_PAYLOAD_LEN,
        )?;
    }

    Ok(payload_len)
}

/// Encode a full agent message into a wire-format packet (length-prefixed).
pub fn encode_message(msg: &AgentMessage) -> Vec<u8> {
    let payload = encode_payload(msg);
    let mut packet = write_u32(payload.len() as u32);
    packet.extend(payload);
    packet
}

/// Encode a message only when its complete payload is within the configured
/// SSH-agent frame limit. Identity responses are preflighted before encoding,
/// so an oversized key list cannot allocate a correspondingly oversized wire
/// buffer.
pub fn try_encode_message(msg: &AgentMessage) -> Result<Vec<u8>, String> {
    if let AgentMessage::IdentitiesAnswer { identities } = msg {
        validate_identities_answer(
            identities
                .iter()
                .map(|identity| (identity.key_blob.as_slice(), identity.comment.as_str())),
        )?;
    }

    let payload = encode_payload(msg);
    ensure_limit(
        "agent response payload",
        payload.len(),
        MAX_AGENT_PAYLOAD_LEN,
    )?;

    let mut packet = Vec::with_capacity(4 + payload.len());
    packet.extend(write_u32(payload.len() as u32));
    packet.extend(payload);
    Ok(packet)
}

#[cfg(test)]
mod outbound_limit_tests {
    use super::*;

    #[test]
    fn oversized_identity_answer_is_rejected_before_encoding() {
        let message = AgentMessage::IdentitiesAnswer {
            identities: vec![
                ProtocolIdentity {
                    key_blob: vec![0; MAX_KEY_DATA_LEN],
                    comment: String::new(),
                },
                ProtocolIdentity {
                    key_blob: vec![0; MAX_KEY_DATA_LEN],
                    comment: String::new(),
                },
            ],
        };

        assert!(try_encode_message(&message).is_err());
    }
}

/// Encode just the payload (type byte + contents).
fn encode_payload(msg: &AgentMessage) -> Vec<u8> {
    match msg {
        AgentMessage::Success => vec![msg::SSH_AGENT_SUCCESS],
        AgentMessage::Failure => vec![msg::SSH_AGENT_FAILURE],
        AgentMessage::ExtensionFailure => vec![msg::SSH_AGENT_EXTENSION_FAILURE],

        AgentMessage::RequestIdentities => vec![msg::SSH_AGENTC_REQUEST_IDENTITIES],

        AgentMessage::IdentitiesAnswer { identities } => {
            let mut buf = vec![msg::SSH_AGENT_IDENTITIES_ANSWER];
            buf.extend(write_u32(identities.len() as u32));
            for id in identities {
                buf.extend(write_string(&id.key_blob));
                buf.extend(write_string(id.comment.as_bytes()));
            }
            buf
        }

        AgentMessage::SignRequest {
            key_blob,
            data,
            flags,
        } => {
            let mut buf = vec![msg::SSH_AGENTC_SIGN_REQUEST];
            buf.extend(write_string(key_blob));
            buf.extend(write_string(data));
            buf.extend(write_u32(*flags));
            buf
        }

        AgentMessage::SignResponse { signature } => {
            let mut buf = vec![msg::SSH_AGENT_SIGN_RESPONSE];
            buf.extend(write_string(signature));
            buf
        }

        AgentMessage::AddIdentity {
            key_type,
            key_data,
            comment,
        } => {
            let mut buf = vec![msg::SSH_AGENTC_ADD_IDENTITY];
            buf.extend(write_string(key_type.as_bytes()));
            buf.extend(key_data.clone());
            buf.extend(write_string(comment.as_bytes()));
            buf
        }

        AgentMessage::AddIdentityConstrained {
            key_type,
            key_data,
            comment,
            constraints,
        } => {
            let mut buf = vec![msg::SSH_AGENTC_ADD_ID_CONSTRAINED];
            buf.extend(write_string(key_type.as_bytes()));
            buf.extend(key_data.clone());
            buf.extend(write_string(comment.as_bytes()));
            for c in constraints {
                buf.push(c.constraint_type);
                buf.extend(&c.data);
            }
            buf
        }

        AgentMessage::RemoveIdentity { key_blob } => {
            let mut buf = vec![msg::SSH_AGENTC_REMOVE_IDENTITY];
            buf.extend(write_string(key_blob));
            buf
        }

        AgentMessage::RemoveAllIdentities => vec![msg::SSH_AGENTC_REMOVE_ALL_IDENTITIES],

        AgentMessage::Lock { passphrase } => {
            let mut buf = vec![msg::SSH_AGENTC_LOCK];
            buf.extend(write_string(passphrase.as_bytes()));
            buf
        }

        AgentMessage::Unlock { passphrase } => {
            let mut buf = vec![msg::SSH_AGENTC_UNLOCK];
            buf.extend(write_string(passphrase.as_bytes()));
            buf
        }

        AgentMessage::AddSmartcardKey { provider, pin } => {
            let mut buf = vec![msg::SSH_AGENTC_ADD_SMARTCARD_KEY];
            buf.extend(write_string(provider.as_bytes()));
            buf.extend(write_string(pin.as_bytes()));
            buf
        }

        AgentMessage::AddSmartcardKeyConstrained {
            provider,
            pin,
            constraints,
        } => {
            let mut buf = vec![msg::SSH_AGENTC_ADD_SMARTCARD_KEY_CONSTRAINED];
            buf.extend(write_string(provider.as_bytes()));
            buf.extend(write_string(pin.as_bytes()));
            for c in constraints {
                buf.push(c.constraint_type);
                buf.extend(&c.data);
            }
            buf
        }

        AgentMessage::RemoveSmartcardKey { provider, pin } => {
            let mut buf = vec![msg::SSH_AGENTC_REMOVE_SMARTCARD_KEY];
            buf.extend(write_string(provider.as_bytes()));
            buf.extend(write_string(pin.as_bytes()));
            buf
        }

        AgentMessage::Extension { name, data } => {
            let mut buf = vec![msg::SSH_AGENTC_EXTENSION];
            buf.extend(write_string(name.as_bytes()));
            buf.extend(data);
            buf
        }
    }
}

/// Parse a wire-format packet into an AgentMessage.
pub fn decode_message(packet: &[u8]) -> Result<AgentMessage, String> {
    if packet.is_empty() {
        return Err("Empty packet".to_string());
    }

    let msg_type = packet[0];
    let data = &packet[1..];

    match msg_type {
        msg::SSH_AGENT_SUCCESS => Ok(AgentMessage::Success),
        msg::SSH_AGENT_FAILURE => Ok(AgentMessage::Failure),
        msg::SSH_AGENT_EXTENSION_FAILURE => Ok(AgentMessage::ExtensionFailure),

        msg::SSH_AGENTC_REQUEST_IDENTITIES => Ok(AgentMessage::RequestIdentities),

        msg::SSH_AGENTC_SIGN_REQUEST => {
            let (key_blob, offset) = read_string(data, 0)?;
            let (sign_data, offset) = read_string(data, offset)?;
            let (flags, _) = if offset + 4 <= data.len() {
                read_u32(data, offset)?
            } else {
                (0u32, offset)
            };
            Ok(AgentMessage::SignRequest {
                key_blob,
                data: sign_data,
                flags,
            })
        }

        msg::SSH_AGENTC_ADD_IDENTITY => {
            let (key_type_bytes, offset) = read_string(data, 0)?;
            let key_type = String::from_utf8(key_type_bytes)
                .map_err(|e| format!("Invalid key type: {}", e))?;
            // Remaining data is key material + comment
            // For simplicity, store the remaining as key_data and extract comment
            let remaining = data[offset..].to_vec();
            Ok(AgentMessage::AddIdentity {
                key_type,
                key_data: remaining.clone(),
                comment: String::new(),
            })
        }

        msg::SSH_AGENTC_REMOVE_IDENTITY => {
            let (key_blob, _) = read_string(data, 0)?;
            Ok(AgentMessage::RemoveIdentity { key_blob })
        }

        msg::SSH_AGENTC_REMOVE_ALL_IDENTITIES => Ok(AgentMessage::RemoveAllIdentities),

        msg::SSH_AGENTC_LOCK => {
            let (passphrase, _) = read_utf8_string(data, 0)?;
            Ok(AgentMessage::Lock { passphrase })
        }

        msg::SSH_AGENTC_UNLOCK => {
            let (passphrase, _) = read_utf8_string(data, 0)?;
            Ok(AgentMessage::Unlock { passphrase })
        }

        msg::SSH_AGENTC_ADD_SMARTCARD_KEY => {
            let (provider, offset) = read_utf8_string(data, 0)?;
            let (pin, _) = read_utf8_string(data, offset)?;
            Ok(AgentMessage::AddSmartcardKey { provider, pin })
        }

        msg::SSH_AGENTC_REMOVE_SMARTCARD_KEY => {
            let (provider, offset) = read_utf8_string(data, 0)?;
            let (pin, _) = read_utf8_string(data, offset)?;
            Ok(AgentMessage::RemoveSmartcardKey { provider, pin })
        }

        msg::SSH_AGENTC_EXTENSION => {
            let (name, offset) = read_utf8_string(data, 0)?;
            let ext_data = data[offset..].to_vec();
            Ok(AgentMessage::Extension {
                name,
                data: ext_data,
            })
        }

        msg::SSH_AGENT_IDENTITIES_ANSWER => {
            let (count, mut offset) = read_u32(data, 0)?;
            let mut identities = Vec::with_capacity(count as usize);
            for _ in 0..count {
                let (key_blob, next) = read_string(data, offset)?;
                let (comment, next) = read_utf8_string(data, next)?;
                identities.push(ProtocolIdentity { key_blob, comment });
                offset = next;
            }
            Ok(AgentMessage::IdentitiesAnswer { identities })
        }

        msg::SSH_AGENT_SIGN_RESPONSE => {
            let (signature, _) = read_string(data, 0)?;
            Ok(AgentMessage::SignResponse { signature })
        }

        _ => Err(format!("Unknown message type: {}", msg_type)),
    }
}

fn ensure_limit(label: &str, actual: usize, maximum: usize) -> Result<(), String> {
    if actual <= maximum {
        Ok(())
    } else {
        Err(format!("{} exceeds the configured limit", label))
    }
}

/// Extension names from OpenSSH.
pub mod extensions {
    /// Session binding (OpenSSH 8.9+).
    pub const SESSION_BIND: &str = "session-bind@openssh.com";
    /// Restrict destination host.
    pub const RESTRICT_DESTINATION: &str = "restrict-destination-v00@openssh.com";
    /// Query supported extensions.
    pub const QUERY: &str = "query";
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_roundtrip_request_identities() {
        let msg = AgentMessage::RequestIdentities;
        let encoded = encode_message(&msg);
        // Skip the 4-byte length prefix
        let decoded = decode_message(&encoded[4..]).unwrap();
        assert!(matches!(decoded, AgentMessage::RequestIdentities));
    }

    #[test]
    fn test_roundtrip_success() {
        let msg = AgentMessage::Success;
        let encoded = encode_message(&msg);
        let decoded = decode_message(&encoded[4..]).unwrap();
        assert!(matches!(decoded, AgentMessage::Success));
    }

    #[test]
    fn test_roundtrip_identities_answer() {
        let msg = AgentMessage::IdentitiesAnswer {
            identities: vec![ProtocolIdentity {
                key_blob: vec![1, 2, 3],
                comment: "test-key".to_string(),
            }],
        };
        let encoded = encode_message(&msg);
        let decoded = decode_message(&encoded[4..]).unwrap();
        let AgentMessage::IdentitiesAnswer { identities } = decoded else {
            unreachable!("Expected IdentitiesAnswer");
        };
        assert_eq!(identities.len(), 1);
        assert_eq!(identities[0].comment, "test-key");
        assert_eq!(identities[0].key_blob, vec![1, 2, 3]);
    }

    #[test]
    fn test_roundtrip_sign_request() {
        let msg = AgentMessage::SignRequest {
            key_blob: vec![0xAA, 0xBB],
            data: vec![0xCC, 0xDD],
            flags: msg::SSH_AGENT_RSA_SHA2_256,
        };
        let encoded = encode_message(&msg);
        let decoded = decode_message(&encoded[4..]).unwrap();
        let AgentMessage::SignRequest {
            key_blob,
            data,
            flags,
        } = decoded
        else {
            unreachable!("Expected SignRequest");
        };
        assert_eq!(key_blob, vec![0xAA, 0xBB]);
        assert_eq!(data, vec![0xCC, 0xDD]);
        assert_eq!(flags, msg::SSH_AGENT_RSA_SHA2_256);
    }

    #[test]
    fn test_roundtrip_lock_unlock() {
        let lock = AgentMessage::Lock {
            passphrase: "secret".to_string(),
        };
        let encoded = encode_message(&lock);
        let decoded = decode_message(&encoded[4..]).unwrap();
        let AgentMessage::Lock { passphrase } = decoded else {
            unreachable!("Expected Lock");
        };
        assert_eq!(passphrase, "secret");
    }

    #[test]
    fn test_wire_helpers() {
        let data = write_string(b"hello");
        let (val, offset) = read_string(&data, 0).unwrap();
        assert_eq!(val, b"hello");
        assert_eq!(offset, 9); // 4 length + 5 data
    }
}
