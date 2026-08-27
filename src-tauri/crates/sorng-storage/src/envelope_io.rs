//! P4 envelope helpers shared by the per-database file layer
//! (`src-tauri/src/database_files.rs`) and the per-database trust store
//! (`trust_store.rs`).
//!
//! Both artifacts sit under the same SDBF preamble (`sdbf.rs`); this module
//! only covers the *inner* SORNG v2 envelope keyed off a pre-derived
//! [`SubKey`]. Keeping the sub-key derivation out of here is what lets the
//! synchronous rustls / SSH verifiers use it without touching the async
//! `EncryptionState` — the trust runtime derives the sub-key once (async,
//! at database activation) and caches it.

use rand::rngs::OsRng;
use rand::RngCore;
use sorng_encryption::envelope::{
    self as enc_envelope, EnvelopeHeader, MAGIC as SORNG_ENVELOPE_MAGIC, NONCE_LEN,
};
use sorng_encryption::SubKey;

/// `true` when the payload bytes start with the SORNG envelope magic —
/// i.e. they are P4-encrypted rather than legacy plaintext JSON.
pub fn is_envelope_blob(bytes: &[u8]) -> bool {
    bytes.len() >= SORNG_ENVELOPE_MAGIC.len()
        && &bytes[..SORNG_ENVELOPE_MAGIC.len()] == SORNG_ENVELOPE_MAGIC
}

/// Encrypt plaintext bytes into a SORNG v2 envelope under `sub_key`.
/// Returns the envelope-wrapped bytes ready for `sdbf::safe_write`.
pub fn encrypt_with_subkey(sub_key: &SubKey, plain: &[u8]) -> Result<Vec<u8>, String> {
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    // Vault-mode header: Argon2 fields stay zero; the mode byte is only
    // consulted by the unlock screen at boot (mirrors database_files.rs).
    let header = EnvelopeHeader::new_vault(nonce);
    enc_envelope::write_envelope(sub_key, &header, plain)
        .map_err(|e| format!("envelope encrypt: {e}"))
}

/// Decrypt a SORNG v2 envelope under `sub_key`, returning the plaintext.
pub fn decrypt_with_subkey(sub_key: &SubKey, envelope: &[u8]) -> Result<Vec<u8>, String> {
    let (_header, plain) = enc_envelope::read_envelope(sub_key, envelope)
        .map_err(|e| format!("envelope decrypt: {e}"))?;
    Ok(plain)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sorng_encryption::{ArtifactKind, MasterDek};

    #[test]
    fn round_trip_and_wrong_artifact_key_fails() {
        let dek = MasterDek::generate();
        let key = dek.sub_key(ArtifactKind::TrustStore);
        let blob = encrypt_with_subkey(&key, b"{\"x\":1}").unwrap();
        assert!(is_envelope_blob(&blob));
        assert!(!is_envelope_blob(b"{\"x\":1}"));
        assert_eq!(decrypt_with_subkey(&key, &blob).unwrap(), b"{\"x\":1}");
        // A trust blob must not open under the Connections sub-key.
        let other = dek.sub_key(ArtifactKind::Connections);
        assert!(decrypt_with_subkey(&other, &blob).is_err());
    }
}
