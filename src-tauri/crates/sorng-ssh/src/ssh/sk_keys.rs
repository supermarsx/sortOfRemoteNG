//! # FIDO2 / U2F Security Key Types for SSH
//!
//! Implements the `sk-ssh-ed25519@openssh.com` and `sk-ecdsa-sha2-nistp256@openssh.com`
//! key types introduced in OpenSSH 8.2.  These key types use FIDO2/U2F hardware
//! authenticators for key generation and authentication.
//!
//! ## Wire Formats (OpenSSH)
//!
//! ### Public Key: `sk-ssh-ed25519@openssh.com`
//! ```text
//! string    "sk-ssh-ed25519@openssh.com"
//! string    public key (32 bytes Ed25519)
//! string    application (e.g. "ssh:")
//! ```
//!
//! ### Public Key: `sk-ecdsa-sha2-nistp256@openssh.com`
//! ```text
//! string    "sk-ecdsa-sha2-nistp256@openssh.com"
//! string    "nistp256"
//! ec_point  Q (public point, 65 bytes uncompressed)
//! string    application (e.g. "ssh:")
//! ```
//!
//! ### Signature: `sk-ssh-ed25519@openssh.com`
//! ```text
//! string    "sk-ssh-ed25519@openssh.com"
//! string    signature (64 bytes Ed25519)
//! byte      flags
//! uint32    counter
//! ```
//!
//! ### Signature: `sk-ecdsa-sha2-nistp256@openssh.com`
//! ```text
//! string    "sk-ecdsa-sha2-nistp256@openssh.com"
//! string    ecdsa-sig (DER-encoded r, s)
//! byte      flags
//! uint32    counter
//! ```

use serde::{Deserialize, Serialize};
use std::fmt;

// ─── Constants ───────────────────────────────────────────────────────

/// OpenSSH algorithm identifier for Ed25519-SK.
pub const SK_ED25519_ALGO: &str = "sk-ssh-ed25519@openssh.com";

/// OpenSSH algorithm identifier for ECDSA-SK (NIST P-256).
pub const SK_ECDSA_ALGO: &str = "sk-ecdsa-sha2-nistp256@openssh.com";

/// Default FIDO2 application (relying party) string used by OpenSSH.
pub const DEFAULT_SK_APPLICATION: &str = "ssh:";

/// FIDO2 flag bits (from the authenticator data).
pub const FLAG_USER_PRESENT: u8 = 0x01;
pub const FLAG_USER_VERIFIED: u8 = 0x04;
pub const FLAG_ATTESTED_CREDENTIAL: u8 = 0x40;
pub const FLAG_EXTENSION_DATA: u8 = 0x80;

// ─── Key algorithm enum ─────────────────────────────────────────────

/// SSH security-key algorithm variants.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum SkAlgorithm {
    /// `sk-ssh-ed25519@openssh.com`
    Ed25519Sk,
    /// `sk-ecdsa-sha2-nistp256@openssh.com`
    EcdsaSk,
}

impl SkAlgorithm {
    /// Return the canonical OpenSSH algorithm identifier.
    pub fn as_openssh_str(&self) -> &'static str {
        match self {
            Self::Ed25519Sk => SK_ED25519_ALGO,
            Self::EcdsaSk => SK_ECDSA_ALGO,
        }
    }

    /// Parse from an OpenSSH algorithm string.
    pub fn from_openssh_str(s: &str) -> Option<Self> {
        match s {
            SK_ED25519_ALGO => Some(Self::Ed25519Sk),
            SK_ECDSA_ALGO => Some(Self::EcdsaSk),
            _ => None,
        }
    }

    /// The key length in bytes for the raw public key data (without headers).
    pub fn public_key_len(&self) -> usize {
        match self {
            Self::Ed25519Sk => 32,
            Self::EcdsaSk => 65, // uncompressed point
        }
    }
}

impl fmt::Display for SkAlgorithm {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_openssh_str())
    }
}

// ─── Public key ──────────────────────────────────────────────────────

/// An SK (security-key) public key, as stored in `authorized_keys` or
/// the `.pub` file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkPublicKey {
    /// Algorithm variant.
    pub algorithm: SkAlgorithm,
    /// Raw public key bytes (32 for Ed25519, 65 for ECDSA-P256).
    pub public_key: Vec<u8>,
    /// FIDO2 application / relying-party identifier (default `"ssh:"`).
    pub application: String,
    /// Optional human-readable comment (from the `.pub` file).
    #[serde(default)]
    pub comment: Option<String>,
}

impl SkPublicKey {
    /// Create a new Ed25519-SK public key.
    pub fn new_ed25519(public_key: Vec<u8>, application: String) -> Self {
        Self {
            algorithm: SkAlgorithm::Ed25519Sk,
            public_key,
            application,
            comment: None,
        }
    }

    /// Create a new ECDSA-SK (P-256) public key.
    pub fn new_ecdsa(public_key: Vec<u8>, application: String) -> Self {
        Self {
            algorithm: SkAlgorithm::EcdsaSk,
            public_key,
            application,
            comment: None,
        }
    }

    /// Encode to the OpenSSH wire format (the binary blob before base64).
    pub fn to_wire_bytes(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        let algo = self.algorithm.as_openssh_str();
        write_string(&mut buf, algo.as_bytes());

        match self.algorithm {
            SkAlgorithm::Ed25519Sk => {
                write_string(&mut buf, &self.public_key);
            }
            SkAlgorithm::EcdsaSk => {
                write_string(&mut buf, b"nistp256");
                write_string(&mut buf, &self.public_key);
            }
        }

        write_string(&mut buf, self.application.as_bytes());
        buf
    }

    /// Encode to the OpenSSH authorized_keys / `.pub` format.
    pub fn to_openssh_pubkey(&self) -> String {
        let wire = self.to_wire_bytes();
        let b64 = base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &wire,
        );
        let comment = self
            .comment
            .as_deref()
            .unwrap_or("");
        if comment.is_empty() {
            format!("{} {}", self.algorithm.as_openssh_str(), b64)
        } else {
            format!("{} {} {}", self.algorithm.as_openssh_str(), b64, comment)
        }
    }

    /// Parse from the OpenSSH wire-format binary blob.
    pub fn from_wire_bytes(data: &[u8]) -> Result<Self, String> {
        let mut cursor = 0;

        let algo_bytes = read_string(data, &mut cursor)?;
        let algo_str = std::str::from_utf8(&algo_bytes)
            .map_err(|_| "invalid UTF-8 in algorithm field")?;

        let algorithm = SkAlgorithm::from_openssh_str(algo_str)
            .ok_or_else(|| format!("unknown SK algorithm: {}", algo_str))?;

        let public_key = match algorithm {
            SkAlgorithm::Ed25519Sk => {
                read_string(data, &mut cursor)?
            }
            SkAlgorithm::EcdsaSk => {
                let _curve = read_string(data, &mut cursor)?; // "nistp256"
                read_string(data, &mut cursor)?
            }
        };

        let app_bytes = read_string(data, &mut cursor)?;
        let application = std::str::from_utf8(&app_bytes)
            .map_err(|_| "invalid UTF-8 in application field")?
            .to_string();

        Ok(Self {
            algorithm,
            public_key,
            application,
            comment: None,
        })
    }

    /// Parse from an OpenSSH authorized_keys line.
    pub fn from_openssh_pubkey(line: &str) -> Result<Self, String> {
        let parts: Vec<&str> = line.splitn(3, ' ').collect();
        if parts.len() < 2 {
            return Err("invalid public key line".into());
        }

        let _algo_str = parts[0]; // e.g. "sk-ssh-ed25519@openssh.com"
        let b64 = parts[1];
        let comment = parts.get(2).map(|s| s.to_string());

        let wire = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            b64,
        )
        .map_err(|e| format!("base64 decode error: {}", e))?;

        let mut pk = Self::from_wire_bytes(&wire)?;
        pk.comment = comment;
        Ok(pk)
    }

    /// Key fingerprint (SHA-256, hex-encoded).
    pub fn fingerprint_sha256(&self) -> String {
        use sha2::{Digest, Sha256};
        let wire = self.to_wire_bytes();
        let hash = Sha256::digest(&wire);
        format!("SHA256:{}", base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            &hash,
        ))
    }
}

// ─── SK Private Key Envelope ─────────────────────────────────────────

/// An SK private key as stored by OpenSSH.
///
/// Unlike regular private keys the actual private material stays on the
/// hardware token — the "private key" file only contains the public key,
/// the credential handle, and some metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkPrivateKey {
    /// The public half.
    pub public_key: SkPublicKey,
    /// FIDO2 credential ID / key handle (opaque blob from the authenticator).
    pub key_handle: Vec<u8>,
    /// Flags from the key generation ceremony (e.g. resident key, user verification).
    pub flags: SkKeyFlags,
}

/// Flags stored alongside an SK private key.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct SkKeyFlags {
    /// Require user presence (touch) for every operation.    
    pub user_presence_required: bool,
    /// Require user verification (PIN / biometric).
    pub user_verification_required: bool,
    /// Key was created as a resident / discoverable credential.
    pub resident: bool,
}

impl SkKeyFlags {
    /// Encode to the single flags byte used in the OpenSSH format.
    pub fn to_byte(&self) -> u8 {
        let mut f: u8 = 0;
        if self.user_presence_required {
            f |= 0x01; // SSH_SK_USER_PRESENCE_REQD
        }
        if self.user_verification_required {
            f |= 0x04; // SSH_SK_USER_VERIFICATION_REQD
        }
        if self.resident {
            f |= 0x20; // SSH_SK_RESIDENT_KEY
        }
        f
    }

    /// Parse from the single flags byte.
    pub fn from_byte(b: u8) -> Self {
        Self {
            user_presence_required: (b & 0x01) != 0,
            user_verification_required: (b & 0x04) != 0,
            resident: (b & 0x20) != 0,
        }
    }
}

// ─── SK Signature ────────────────────────────────────────────────────

/// Signature produced by an SK authenticator for SSH authentication.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkSignature {
    /// Algorithm used.
    pub algorithm: SkAlgorithm,
    /// The raw cryptographic signature (64 bytes for Ed25519, DER for ECDSA).
    pub signature: Vec<u8>,
    /// Authenticator flags byte (UP, UV, etc.).
    pub flags: u8,
    /// Monotonic signature counter from the authenticator.
    pub counter: u32,
}

impl SkSignature {
    /// Encode to the OpenSSH wire format.
    pub fn to_wire_bytes(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        let algo = self.algorithm.as_openssh_str();
        write_string(&mut buf, algo.as_bytes());
        write_string(&mut buf, &self.signature);
        buf.push(self.flags);
        buf.extend_from_slice(&self.counter.to_be_bytes());
        buf
    }

    /// Parse from the OpenSSH wire format.
    pub fn from_wire_bytes(data: &[u8]) -> Result<Self, String> {
        let mut cursor = 0;

        let algo_bytes = read_string(data, &mut cursor)?;
        let algo_str = std::str::from_utf8(&algo_bytes)
            .map_err(|_| "invalid UTF-8 in signature algorithm")?;
        let algorithm = SkAlgorithm::from_openssh_str(algo_str)
            .ok_or_else(|| format!("unknown SK algorithm in signature: {}", algo_str))?;

        let signature = read_string(data, &mut cursor)?;

        if cursor >= data.len() {
            return Err("truncated signature: missing flags".into());
        }
        let flags = data[cursor];
        cursor += 1;

        if cursor + 4 > data.len() {
            return Err("truncated signature: missing counter".into());
        }
        let counter = u32::from_be_bytes([
            data[cursor],
            data[cursor + 1],
            data[cursor + 2],
            data[cursor + 3],
        ]);

        Ok(Self {
            algorithm,
            signature,
            flags,
            counter,
        })
    }

    /// Check the user-presence flag.
    pub fn user_present(&self) -> bool {
        (self.flags & FLAG_USER_PRESENT) != 0
    }

    /// Check the user-verified flag.
    pub fn user_verified(&self) -> bool {
        (self.flags & FLAG_USER_VERIFIED) != 0
    }
}

// ─── SSH wire-format helpers ─────────────────────────────────────────

/// Write an SSH "string" (uint32 length + bytes).
fn write_string(buf: &mut Vec<u8>, data: &[u8]) {
    let len = data.len() as u32;
    buf.extend_from_slice(&len.to_be_bytes());
    buf.extend_from_slice(data);
}

/// Read an SSH "string" (uint32 length + bytes).
fn read_string(data: &[u8], cursor: &mut usize) -> Result<Vec<u8>, String> {
    if *cursor + 4 > data.len() {
        return Err("truncated string: missing length".into());
    }
    let len = u32::from_be_bytes([
        data[*cursor],
        data[*cursor + 1],
        data[*cursor + 2],
        data[*cursor + 3],
    ]) as usize;
    *cursor += 4;

    if *cursor + len > data.len() {
        return Err(format!(
            "truncated string: need {} bytes but only {} remain",
            len,
            data.len() - *cursor
        ));
    }
    let result = data[*cursor..*cursor + len].to_vec();
    *cursor += len;
    Ok(result)
}

// ─── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn algorithm_roundtrip() {
        assert_eq!(
            SkAlgorithm::from_openssh_str(SK_ED25519_ALGO),
            Some(SkAlgorithm::Ed25519Sk)
        );
        assert_eq!(
            SkAlgorithm::from_openssh_str(SK_ECDSA_ALGO),
            Some(SkAlgorithm::EcdsaSk)
        );
        assert_eq!(SkAlgorithm::Ed25519Sk.as_openssh_str(), SK_ED25519_ALGO);
    }

    #[test]
    fn ed25519_sk_pubkey_wire_roundtrip() {
        let pk = SkPublicKey::new_ed25519(vec![0xAA; 32], "ssh:".into());
        let wire = pk.to_wire_bytes();
        let parsed = SkPublicKey::from_wire_bytes(&wire).unwrap();
        assert_eq!(parsed.algorithm, SkAlgorithm::Ed25519Sk);
        assert_eq!(parsed.public_key, vec![0xAA; 32]);
        assert_eq!(parsed.application, "ssh:");
    }

    #[test]
    fn ecdsa_sk_pubkey_wire_roundtrip() {
        let mut point = vec![0x04]; // uncompressed prefix
        point.extend_from_slice(&[0xBB; 64]);
        let pk = SkPublicKey::new_ecdsa(point.clone(), "ssh:myapp".into());
        let wire = pk.to_wire_bytes();
        let parsed = SkPublicKey::from_wire_bytes(&wire).unwrap();
        assert_eq!(parsed.algorithm, SkAlgorithm::EcdsaSk);
        assert_eq!(parsed.public_key, point);
        assert_eq!(parsed.application, "ssh:myapp");
    }

    #[test]
    fn openssh_pubkey_format() {
        let pk = SkPublicKey {
            algorithm: SkAlgorithm::Ed25519Sk,
            public_key: vec![0x42; 32],
            application: "ssh:".into(),
            comment: Some("test@host".into()),
        };
        let line = pk.to_openssh_pubkey();
        assert!(line.starts_with("sk-ssh-ed25519@openssh.com "));
        assert!(line.ends_with(" test@host"));
        let parsed = SkPublicKey::from_openssh_pubkey(&line).unwrap();
        assert_eq!(parsed.public_key, vec![0x42; 32]);
    }

    #[test]
    fn signature_wire_roundtrip() {
        let sig = SkSignature {
            algorithm: SkAlgorithm::Ed25519Sk,
            signature: vec![0xCC; 64],
            flags: FLAG_USER_PRESENT | FLAG_USER_VERIFIED,
            counter: 42,
        };
        let wire = sig.to_wire_bytes();
        let parsed = SkSignature::from_wire_bytes(&wire).unwrap();
        assert_eq!(parsed.algorithm, SkAlgorithm::Ed25519Sk);
        assert_eq!(parsed.signature, vec![0xCC; 64]);
        assert!(parsed.user_present());
        assert!(parsed.user_verified());
        assert_eq!(parsed.counter, 42);
    }

    #[test]
    fn flags_roundtrip() {
        let flags = SkKeyFlags {
            user_presence_required: true,
            user_verification_required: true,
            resident: true,
        };
        let byte = flags.to_byte();
        let back = SkKeyFlags::from_byte(byte);
        assert!(back.user_presence_required);
        assert!(back.user_verification_required);
        assert!(back.resident);
    }

    #[test]
    fn flags_none() {
        let flags = SkKeyFlags::default();
        assert_eq!(flags.to_byte(), 0);
    }
}
