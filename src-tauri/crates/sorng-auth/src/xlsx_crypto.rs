//! OOXML Agile Encryption pair for Excel/Word/PowerPoint exports.
//!
//! Pure-Rust agile encryption (MS-OFFCRYPTO §2.3.4.10) wired against two
//! maintained crates:
//!   * `ms-offcrypto-writer` produces the CFB container with the
//!     encrypted EncryptedPackage stream and matching EncryptionInfo
//!     XML. The output opens in Microsoft Excel.
//!   * `office-crypto` reverses the process for files received from
//!     Excel users.
//!
//! The decrypt path runs against a *patched* copy of `office-crypto`
//! 0.2.0 vendored at `src-tauri/patches/office-crypto`. Upstream's
//! `decrypt_ooxml` had an off-by-one that corrupted the trailing
//! segment of any multi-segment payload and underflowed for plaintexts
//! shorter than `SEGMENT_LENGTH`; the patched loop condition consumes
//! every full segment with its matching block index and leaves only
//! the final partial segment for the last-block path. See the
//! `PATCH (sortOfRemoteNG)` comment in
//! `patches/office-crypto/src/crypto.rs`.

use std::io::{Cursor, Write};

use ms_offcrypto_writer::Ecma376AgileWriter;
use office_crypto::decrypt_from_bytes;
// ms-offcrypto-writer is built against rand 0.9; the workspace pins
// rand to 0.8 for unrelated callers (see Cargo.toml note about the
// aes-gcm 0.10 trait bounds). Pulled in under `rand_v9` so the trait
// bounds match without disturbing anyone else.
use rand_v9::rng;

/// Encrypt a plaintext OOXML payload (the unencrypted zip bytes of an
/// `.xlsx` / `.docx` / `.pptx`) into the agile-encrypted CFB container
/// that Office applications recognise.
pub fn encrypt_xlsx(plaintext: &[u8], password: &str) -> Result<Vec<u8>, String> {
    let mut rng = rng();
    let buf = Cursor::new(Vec::<u8>::new());
    let mut writer = Ecma376AgileWriter::create(&mut rng, password, buf)
        .map_err(|e| format!("xlsx encrypt: writer init failed: {e}"))?;
    writer
        .write_all(plaintext)
        .map_err(|e| format!("xlsx encrypt: write failed: {e}"))?;
    let inner = writer
        .into_inner()
        .map_err(|e| format!("xlsx encrypt: finalize failed: {e}"))?;
    Ok(inner.into_inner())
}

/// Decrypt an agile-encrypted OOXML CFB container back to the plaintext
/// zip bytes. Mirrors `encrypt_xlsx` and is also the path used when an
/// import file is a CFB envelope produced by Excel itself.
///
/// `office-crypto` skips the agile-encryption verifier hash and will
/// silently return gibberish bytes on a wrong password. Every OOXML
/// file is a zip archive, so we add a zip-magic sanity check on the
/// decrypted output: anything that doesn't start with the
/// `PK\x03\x04` (or zip-empty `PK\x05\x06`) signature is treated as
/// a wrong-password failure.
pub fn decrypt_xlsx(ciphertext: &[u8], password: &str) -> Result<Vec<u8>, String> {
    let plaintext = decrypt_from_bytes(ciphertext.to_vec(), password)
        .map_err(|e| format!("xlsx decrypt: {e}"))?;
    if !looks_like_zip(&plaintext) {
        return Err(
            "xlsx decrypt: output is not a valid zip archive (wrong password or corrupted envelope)"
                .to_owned(),
        );
    }
    Ok(plaintext)
}

fn looks_like_zip(bytes: &[u8]) -> bool {
    // Local file header (most non-empty archives) or empty archive
    // central directory end record.
    bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(b"PK\x05\x06")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_payload() -> Vec<u8> {
        let mut v = b"PK\x03\x04".to_vec();
        v.extend((0..100_000u32).map(|i| (i & 0xff) as u8));
        v
    }

    #[test]
    fn encrypt_produces_cfb_container_with_correct_magic() {
        // The encrypt direction must produce a valid CFB/OLE compound
        // file. Real Excel verifies the rest of the structure on open;
        // here we sanity-check the wrapper signature.
        let sample = sample_payload();
        let cipher = encrypt_xlsx(&sample, "correct horse").expect("encrypt");
        assert_eq!(
            &cipher[0..8],
            &[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1],
            "encrypted output should begin with the CFB magic header",
        );
        // The container must also be substantially larger than the
        // raw plaintext — the agile envelope adds a CFB skeleton,
        // EncryptionInfo XML, salts and HMAC tags.
        assert!(
            cipher.len() > sample.len(),
            "ciphertext ({} bytes) should exceed plaintext ({} bytes)",
            cipher.len(),
            sample.len(),
        );
    }

    #[test]
    fn encrypt_is_deterministic_for_size_not_content() {
        // Two different passwords on the same plaintext still produce
        // different ciphertexts; the random salts make the bodies
        // diverge even though the structural envelope is the same.
        let sample = sample_payload();
        let a = encrypt_xlsx(&sample, "alpha").expect("encrypt a");
        let b = encrypt_xlsx(&sample, "beta").expect("encrypt b");
        assert_ne!(a, b, "different passwords must produce different bytes");
    }

    #[test]
    fn decrypt_garbage_returns_error() {
        // Decrypt path: feed it something that's clearly not a CFB
        // container and confirm we get an error rather than a panic.
        let result = decrypt_xlsx(b"not-a-cfb-container", "anything");
        assert!(result.is_err());
    }

    /// Full encrypt → decrypt → match round-trip using the patched
    /// office-crypto. Exercises a multi-segment payload (the bug we
    /// patched only manifested when there were two or more agile
    /// segments).
    #[test]
    fn round_trip_multi_segment() {
        let sample = sample_payload();
        let cipher = encrypt_xlsx(&sample, "correct horse").expect("encrypt");
        let plain = decrypt_xlsx(&cipher, "correct horse").expect("decrypt");
        assert_eq!(plain.len(), sample.len(), "decrypted length mismatch");
        assert_eq!(plain, sample, "decrypted bytes diverge from plaintext");
    }

    /// Round-trip at the SEGMENT_LENGTH boundary — the size where the
    /// upstream bug *didn't* manifest, kept as a regression guard.
    /// Real OOXML payloads always start with the zip local-file header
    /// `PK\x03\x04`; the decrypt wrapper enforces that as a wrong-
    /// password sentinel.
    #[test]
    fn round_trip_exact_segment_length() {
        let mut sample = b"PK\x03\x04".to_vec();
        sample.extend((0..4092u32).map(|i| (i & 0xff) as u8));
        let cipher = encrypt_xlsx(&sample, "pw").expect("encrypt");
        let plain = decrypt_xlsx(&cipher, "pw").expect("decrypt");
        assert_eq!(plain, sample);
    }

    /// Round-trip with a payload smaller than SEGMENT_LENGTH — the
    /// case where the upstream loop's `total_size - SEGMENT_LENGTH`
    /// underflowed and panicked in debug builds.
    #[test]
    fn round_trip_sub_segment() {
        let sample = b"PK\x03\x04tiny xlsx payload".to_vec();
        let cipher = encrypt_xlsx(&sample, "pw").expect("encrypt");
        let plain = decrypt_xlsx(&cipher, "pw").expect("decrypt");
        assert_eq!(plain, sample);
    }

    #[test]
    fn wrong_password_fails_round_trip() {
        let sample = sample_payload();
        let cipher = encrypt_xlsx(&sample, "right").expect("encrypt");
        assert!(decrypt_xlsx(&cipher, "wrong").is_err());
    }
}
