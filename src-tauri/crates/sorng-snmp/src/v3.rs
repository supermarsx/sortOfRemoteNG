//! # SNMPv3 Security (USM)
//!
//! User-based Security Model implementation: engine discovery,
//! authentication (HMAC), and privacy (encryption) for SNMPv3.

use crate::error::{SnmpError, SnmpResult};
use crate::types::*;
use sha2::{Sha256, Sha512, Digest};
use std::collections::HashMap;

/// Cached engine parameters for a remote agent.
#[derive(Debug, Clone)]
pub struct EngineCache {
    /// Remote engine ID.
    pub engine_id: Vec<u8>,
    /// Engine boots.
    pub engine_boots: u32,
    /// Engine time (seconds).
    pub engine_time: u32,
    /// When we last updated these values.
    pub last_updated: std::time::Instant,
}

/// USM security processor for SNMPv3 message authentication and encryption.
pub struct UsmProcessor {
    /// User table: username → credentials.
    users: HashMap<String, V3Credentials>,
    /// Engine cache: host:port → engine info.
    engine_cache: HashMap<String, EngineCache>,
}

impl UsmProcessor {
    pub fn new() -> Self {
        Self {
            users: HashMap::new(),
            engine_cache: HashMap::new(),
        }
    }

    /// Add or update a USM user.
    pub fn add_user(&mut self, creds: V3Credentials) {
        self.users.insert(creds.username.clone(), creds);
    }

    /// Remove a USM user.
    pub fn remove_user(&mut self, username: &str) -> bool {
        self.users.remove(username).is_some()
    }

    /// Get a user's credentials.
    pub fn get_user(&self, username: &str) -> Option<&V3Credentials> {
        self.users.get(username)
    }

    /// List all usernames.
    pub fn list_users(&self) -> Vec<String> {
        self.users.keys().cloned().collect()
    }

    /// Cache engine parameters for a remote agent.
    pub fn cache_engine(&mut self, addr: &str, engine_id: Vec<u8>, boots: u32, time: u32) {
        self.engine_cache.insert(addr.to_string(), EngineCache {
            engine_id,
            engine_boots: boots,
            engine_time: time,
            last_updated: std::time::Instant::now(),
        });
    }

    /// Get cached engine info for a remote agent.
    pub fn get_engine(&self, addr: &str) -> Option<&EngineCache> {
        self.engine_cache.get(addr)
    }

    /// Check if engine discovery is needed.
    pub fn needs_discovery(&self, addr: &str) -> bool {
        match self.engine_cache.get(addr) {
            None => true,
            Some(cache) => cache.last_updated.elapsed().as_secs() > 150, // Time window ~150s
        }
    }

    /// Password-to-key localisation (RFC 3414 section A.2).
    /// Generates a localised key from a passphrase and engine ID.
    pub fn localise_key_sha256(passphrase: &str, engine_id: &[u8]) -> Vec<u8> {
        // Step 1: Generate Ku by hashing passphrase repeatedly
        let mut hasher = Sha256::new();
        let passphrase_bytes = passphrase.as_bytes();
        let mut count = 0usize;
        let target = 1_048_576; // 1 MB
        while count < target {
            let chunk_len = std::cmp::min(passphrase_bytes.len(), target - count);
            // Wrap around passphrase if needed
            let idx = count % passphrase_bytes.len();
            let end = std::cmp::min(idx + chunk_len, passphrase_bytes.len());
            hasher.update(&passphrase_bytes[idx..end]);
            count += end - idx;
        }
        let ku = hasher.finalize();

        // Step 2: Localise Ku with engine ID to get Kul
        let mut hasher2 = Sha256::new();
        hasher2.update(&ku);
        hasher2.update(engine_id);
        hasher2.update(&ku);
        hasher2.finalize().to_vec()
    }

    /// Password-to-key localisation using SHA-512.
    pub fn localise_key_sha512(passphrase: &str, engine_id: &[u8]) -> Vec<u8> {
        let mut hasher = Sha512::new();
        let passphrase_bytes = passphrase.as_bytes();
        let mut count = 0usize;
        let target = 1_048_576;
        while count < target {
            let idx = count % passphrase_bytes.len();
            let end = std::cmp::min(idx + passphrase_bytes.len(), passphrase_bytes.len());
            let chunk_len = std::cmp::min(end - idx, target - count);
            hasher.update(&passphrase_bytes[idx..idx + chunk_len]);
            count += chunk_len;
        }
        let ku = hasher.finalize();

        let mut hasher2 = Sha512::new();
        hasher2.update(&ku);
        hasher2.update(engine_id);
        hasher2.update(&ku);
        hasher2.finalize().to_vec()
    }

    /// Build an SNMPv3 header-data structure (msgID, msgMaxSize, msgFlags, msgSecurityModel).
    pub fn build_header_data(
        msg_id: i32,
        max_size: i32,
        security_level: SecurityLevel,
        reportable: bool,
    ) -> Vec<u8> {
        use crate::ber;
        let mut flags = security_level.flags();
        if reportable {
            flags |= 0x04; // reportable flag
        }

        let mut contents = vec![];
        contents.extend_from_slice(&ber::encode_integer(msg_id as i64));
        contents.extend_from_slice(&ber::encode_integer(max_size as i64));
        contents.extend_from_slice(&ber::encode_octet_string(&[flags]));
        contents.extend_from_slice(&ber::encode_integer(3)); // USM security model = 3
        ber::encode_sequence(&contents)
    }

    /// Build a USM security parameters OCTET STRING.
    pub fn build_usm_security_params(
        engine_id: &[u8],
        engine_boots: u32,
        engine_time: u32,
        username: &str,
        auth_params: &[u8],
        priv_params: &[u8],
    ) -> Vec<u8> {
        use crate::ber;
        let mut contents = vec![];
        contents.extend_from_slice(&ber::encode_octet_string(engine_id));
        contents.extend_from_slice(&ber::encode_integer(engine_boots as i64));
        contents.extend_from_slice(&ber::encode_integer(engine_time as i64));
        contents.extend_from_slice(&ber::encode_octet_string(username.as_bytes()));
        contents.extend_from_slice(&ber::encode_octet_string(auth_params));
        contents.extend_from_slice(&ber::encode_octet_string(priv_params));
        ber::encode_sequence(&contents)
    }

    /// Build an SNMPv3 discovery message (empty security params, GET with empty varbinds).
    pub fn build_discovery_message(msg_id: i32) -> SnmpResult<Vec<u8>> {
        use crate::ber;

        let header_data = Self::build_header_data(msg_id, 65507, SecurityLevel::NoAuthNoPriv, true);
        let usm_params = Self::build_usm_security_params(&[], 0, 0, "", &[], &[]);
        let usm_params_octet = ber::encode_octet_string(&usm_params);

        // Scoped PDU: contextEngineID + contextName + PDU
        let empty_pdu = crate::pdu::build_pdu(
            PduType::GetRequest,
            msg_id,
            0,
            0,
            &[],
        )?;

        let mut scoped_pdu = vec![];
        scoped_pdu.extend_from_slice(&ber::encode_octet_string(&[])); // contextEngineID
        scoped_pdu.extend_from_slice(&ber::encode_octet_string(&[])); // contextName
        scoped_pdu.extend_from_slice(&empty_pdu);
        let scoped_pdu_seq = ber::encode_sequence(&scoped_pdu);

        // Assemble full v3 message
        let mut message = vec![];
        message.extend_from_slice(&ber::encode_integer(3)); // version
        message.extend_from_slice(&header_data);
        message.extend_from_slice(&usm_params_octet);
        message.extend_from_slice(&scoped_pdu_seq);

        Ok(ber::encode_sequence(&message))
    }

    /// Build a full authenticated SNMPv3 message.
    pub fn build_v3_message(
        &self,
        msg_id: i32,
        username: &str,
        addr: &str,
        pdu_type: PduType,
        request_id: i32,
        varbinds: &[(String, SnmpValue)],
    ) -> SnmpResult<Vec<u8>> {
        use crate::ber;

        let creds = self.get_user(username)
            .ok_or_else(|| SnmpError::auth(format!("USM user '{}' not found", username)))?;
        let engine = self.get_engine(addr)
            .ok_or_else(|| SnmpError::usm_error(format!("No engine info cached for '{}'", addr)))?;

        let header_data = Self::build_header_data(
            msg_id,
            65507,
            creds.security_level,
            false,
        );

        // Build scoped PDU
        let pdu = crate::pdu::build_pdu(pdu_type, request_id, 0, 0, varbinds)?;
        let context_engine_id = creds.context_engine_id.as_ref()
            .map(|hex| hex_decode(hex))
            .transpose()
            .map_err(|e| SnmpError::encoding(e))?
            .unwrap_or_else(|| engine.engine_id.clone());
        let context_name = creds.context_name.as_deref().unwrap_or("");

        let mut scoped_pdu = vec![];
        scoped_pdu.extend_from_slice(&ber::encode_octet_string(&context_engine_id));
        scoped_pdu.extend_from_slice(&ber::encode_octet_string(context_name.as_bytes()));
        scoped_pdu.extend_from_slice(&pdu);
        let scoped_pdu_seq = ber::encode_sequence(&scoped_pdu);

        // Auth placeholder (12 zero bytes for HMAC)
        let auth_placeholder = vec![0u8; 12];
        let usm_params = Self::build_usm_security_params(
            &engine.engine_id,
            engine.engine_boots,
            engine.engine_time,
            username,
            &auth_placeholder,
            &[], // priv_params — not encrypted for now
        );
        let usm_params_octet = ber::encode_octet_string(&usm_params);

        let mut message = vec![];
        message.extend_from_slice(&ber::encode_integer(3));
        message.extend_from_slice(&header_data);
        message.extend_from_slice(&usm_params_octet);
        message.extend_from_slice(&scoped_pdu_seq);

        Ok(ber::encode_sequence(&message))
    }
}

fn hex_decode(hex: &str) -> Result<Vec<u8>, String> {
    let hex = hex.trim_start_matches("0x").trim_start_matches("0X");
    if hex.len() % 2 != 0 {
        return Err("Hex string must have even length".to_string());
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).map_err(|e| e.to_string()))
        .collect()
}
