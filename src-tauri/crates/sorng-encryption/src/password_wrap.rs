//! Password-wrapped master DEK persistence (`dek.enc`).
//!
//! When the OS vault is unavailable (Linux without a Secret Service,
//! WSL, portable USB usage), the master DEK is instead Argon2id-wrapped
//! with the user's password. The wrap blob lives in
//! `<app_data_dir>/dek.enc` next to the encrypted artifacts. Changing
//! the user's password only rewrites this small file — every artifact
//! file keeps its existing ciphertext untouched.
//!
//! ## Wire format
//!
//! ```text
//!  offset  size   description
//!  ──────  ────   ──────────────────────────────────────────────────────
//!   0       6     b"SORNG\0"               magic, shared with envelope.rs
//!   6       1     version                  u8, currently 2
//!   7       1     kind                     u8 = 1 ("wrapped-dek")
//!   8       4     argon2_memory_kib        u32 LE
//!  12       4     argon2_time_cost         u32 LE
//!  16       4     argon2_parallelism       u32 LE
//!  20      16     argon2_salt              random per-write
//!  36      12     nonce                    AES-256-GCM nonce
//!  48     ..      32-byte DEK + 16-byte GCM tag = 48 bytes
//! ```
//!
//! `kind` distinguishes this file from artifact envelopes so a misnamed
//! file is rejected loudly rather than silently mis-decrypted.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::Argon2;
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};

use crate::dek::{MasterDek, KEY_LEN};
use crate::envelope::{MAGIC, NONCE_LEN, SALT_LEN};

/// `kind` discriminant in the preamble. Reserved values:
/// - `0` — artifact envelope (handled by `envelope.rs`)
/// - `1` — wrapped DEK (this module)
const KIND_WRAPPED_DEK: u8 = 1;

/// Current wrapped-DEK format version. Matches the envelope version
/// for symmetry but the upgrade paths are independent.
pub const CURRENT_VERSION: u8 = 2;

/// Total on-disk size: 48-byte header + 48-byte wrapped DEK.
pub const FILE_LEN: usize = 96;
const WRAPPED_LEN: usize = KEY_LEN + 16; // DEK + GCM tag

/// User-tunable Argon2id parameters. Mirrored verbatim in the
/// `EncryptionSettings.argon2id` TypeScript shape so the Settings →
/// Security panel can pass them through without re-validation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Argon2Params {
    pub memory_kib: u32,
    pub time_cost: u32,
    pub parallelism: u32,
}

impl Argon2Params {
    /// OWASP-recommended interactive-login defaults: 64 MiB, 3
    /// iterations, parallelism 4. The same values
    /// `sorng-vault::envelope` uses for its password envelope so
    /// behaviour stays consistent.
    pub const OWASP: Self = Self {
        memory_kib: 65_536,
        time_cost: 3,
        parallelism: 4,
    };

    /// Sanity-check the parameters against the floor of what
    /// `argon2::Params::new` will accept, plus a generous ceiling so a
    /// user accidentally typing "65536 GiB" doesn't lock the process
    /// for an hour. Returns the offending parameter name on failure.
    pub fn validate(self) -> Result<(), &'static str> {
        if self.memory_kib < 8 {
            return Err("argon2_memory_kib must be at least 8 KiB");
        }
        if self.memory_kib > 4 * 1024 * 1024 {
            return Err("argon2_memory_kib above 4 GiB rejected");
        }
        if self.time_cost == 0 {
            return Err("argon2_time_cost must be at least 1");
        }
        if self.time_cost > 50 {
            return Err("argon2_time_cost above 50 rejected");
        }
        if self.parallelism == 0 {
            return Err("argon2_parallelism must be at least 1");
        }
        if self.parallelism > 64 {
            return Err("argon2_parallelism above 64 rejected");
        }
        Ok(())
    }
}

/// Errors specific to wrapping / unwrapping the master DEK with a
/// password. Kept distinct from `EnvelopeError` so callers can react
/// differently (e.g. wrong password is a UI prompt, missing magic is a
/// "did you delete dek.enc?" diagnostic).
#[derive(Debug, thiserror::Error)]
pub enum WrapError {
    #[error("dek.enc is shorter than the {0}-byte expected layout")]
    Truncated(usize),
    #[error("missing SORNG magic prefix in dek.enc")]
    MissingMagic,
    #[error("unsupported wrapped-DEK version: {0}")]
    UnsupportedVersion(u8),
    #[error("unexpected kind discriminant {0}: this file is not a wrapped DEK")]
    WrongKind(u8),
    #[error("Argon2id parameter rejected: {0}")]
    InvalidParams(&'static str),
    #[error("Argon2id derivation failed: {0}")]
    Kdf(String),
    #[error("AES-256-GCM authentication failed — wrong password or corrupted dek.enc")]
    AuthenticationFailed,
}

/// Wrap a master DEK with a password. Caller supplies the desired
/// Argon2id parameters; salt and nonce are freshly randomised per call
/// so two writes of the same password+DEK produce different ciphertexts.
pub fn wrap(
    password: &str,
    dek: &MasterDek,
    params: Argon2Params,
) -> Result<Vec<u8>, WrapError> {
    params.validate().map_err(WrapError::InvalidParams)?;

    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);

    let kek = derive_kek(password, &salt, params)?;
    let cipher = Aes256Gcm::new((&kek).into());
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Re-derive the raw DEK bytes here without using `MasterDek::raw()`
    // (it's `#[cfg(test)]`-only) by deriving the same artifact-kind-free
    // bytes through the public `from_bytes` round-trip. We expose a
    // crate-internal accessor instead — cleaner.
    let dek_bytes = dek_bytes_for_wrap(dek);

    let wrapped = cipher
        .encrypt(nonce, dek_bytes.as_slice())
        .map_err(|_| WrapError::AuthenticationFailed)?;
    debug_assert_eq!(wrapped.len(), WRAPPED_LEN);

    let mut out = Vec::with_capacity(FILE_LEN);
    out.extend_from_slice(MAGIC);
    out.push(CURRENT_VERSION);
    out.push(KIND_WRAPPED_DEK);
    out.extend_from_slice(&params.memory_kib.to_le_bytes());
    out.extend_from_slice(&params.time_cost.to_le_bytes());
    out.extend_from_slice(&params.parallelism.to_le_bytes());
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&wrapped);
    debug_assert_eq!(out.len(), FILE_LEN);
    Ok(out)
}

/// Decode and unwrap a `dek.enc` blob using the supplied password.
/// Returns the reconstructed [`MasterDek`] on success.
pub fn unwrap(password: &str, file_bytes: &[u8]) -> Result<MasterDek, WrapError> {
    if file_bytes.len() < FILE_LEN {
        return Err(WrapError::Truncated(FILE_LEN));
    }
    if &file_bytes[0..6] != MAGIC {
        return Err(WrapError::MissingMagic);
    }
    if file_bytes[6] != CURRENT_VERSION {
        return Err(WrapError::UnsupportedVersion(file_bytes[6]));
    }
    if file_bytes[7] != KIND_WRAPPED_DEK {
        return Err(WrapError::WrongKind(file_bytes[7]));
    }
    let memory_kib = u32::from_le_bytes(file_bytes[8..12].try_into().unwrap());
    let time_cost = u32::from_le_bytes(file_bytes[12..16].try_into().unwrap());
    let parallelism = u32::from_le_bytes(file_bytes[16..20].try_into().unwrap());
    let params = Argon2Params {
        memory_kib,
        time_cost,
        parallelism,
    };
    params.validate().map_err(WrapError::InvalidParams)?;

    let mut salt = [0u8; SALT_LEN];
    salt.copy_from_slice(&file_bytes[20..36]);
    let mut nonce_bytes = [0u8; NONCE_LEN];
    nonce_bytes.copy_from_slice(&file_bytes[36..48]);

    let kek = derive_kek(password, &salt, params)?;
    let cipher = Aes256Gcm::new((&kek).into());
    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, &file_bytes[48..])
        .map_err(|_| WrapError::AuthenticationFailed)?;
    if plaintext.len() != KEY_LEN {
        return Err(WrapError::AuthenticationFailed);
    }
    MasterDek::from_bytes(&plaintext).ok_or(WrapError::AuthenticationFailed)
}

/// Argon2id KDF. Pure helper so both wrap and unwrap go through the
/// same code path and a regression in one is caught by the other.
fn derive_kek(password: &str, salt: &[u8], params: Argon2Params) -> Result<[u8; 32], WrapError> {
    let argon_params = argon2::Params::new(
        params.memory_kib,
        params.time_cost,
        params.parallelism,
        Some(32),
    )
    .map_err(|e| WrapError::Kdf(format!("argon2 params: {e}")))?;
    let argon = Argon2::new(
        argon2::Algorithm::Argon2id,
        argon2::Version::V0x13,
        argon_params,
    );
    let mut out = [0u8; 32];
    argon
        .hash_password_into(password.as_bytes(), salt, &mut out)
        .map_err(|e| WrapError::Kdf(format!("argon2 hash: {e}")))?;
    Ok(out)
}

/// Extract the raw DEK bytes for wrapping. Tightly scoped to this
/// module so the bytes never leave the crate boundary in plaintext.
fn dek_bytes_for_wrap(dek: &MasterDek) -> Vec<u8> {
    // We can't call `dek.raw()` (it's `#[cfg(test)]`-only on purpose).
    // Round-trip via the public HKDF + Vec interface: derive a temp
    // sub-key with a sentinel label that's never used elsewhere, then
    // XOR-recover the master bytes? That's contrived. Better: lift the
    // accessor to `pub(crate)` for this single call site.
    //
    // Since we want a tight blast radius, do the lift here via a
    // dedicated helper on `MasterDek` rather than exposing `raw()`.
    dek.bytes_for_password_wrap().to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_with_owasp_defaults() {
        let dek = MasterDek::generate();
        let blob = wrap("hunter2", &dek, Argon2Params::OWASP).unwrap();
        assert_eq!(blob.len(), FILE_LEN);
        let recovered = unwrap("hunter2", &blob).unwrap();
        // Compare via sub-key derivation; raw access stays test-private.
        let a = dek.sub_key(crate::dek::ArtifactKind::Settings);
        let b = recovered.sub_key(crate::dek::ArtifactKind::Settings);
        assert_eq!(a.bytes(), b.bytes());
    }

    #[test]
    fn wrong_password_fails_authentication() {
        let dek = MasterDek::generate();
        let blob = wrap("right", &dek, Argon2Params::OWASP).unwrap();
        assert!(matches!(
            unwrap("wrong", &blob),
            Err(WrapError::AuthenticationFailed)
        ));
    }

    #[test]
    fn truncated_file_is_rejected() {
        let dek = MasterDek::generate();
        let blob = wrap("p", &dek, Argon2Params::OWASP).unwrap();
        for cut in [0, 1, 47, 95] {
            assert!(
                matches!(unwrap("p", &blob[..cut]), Err(WrapError::Truncated(FILE_LEN))),
                "cut={cut} should reject as truncated"
            );
        }
    }

    #[test]
    fn missing_magic_is_rejected() {
        let mut blob = vec![0u8; FILE_LEN];
        blob[0..6].copy_from_slice(b"ABCDEF");
        assert!(matches!(unwrap("p", &blob), Err(WrapError::MissingMagic)));
    }

    #[test]
    fn wrong_version_is_rejected() {
        let dek = MasterDek::generate();
        let mut blob = wrap("p", &dek, Argon2Params::OWASP).unwrap();
        blob[6] = 99;
        assert!(matches!(
            unwrap("p", &blob),
            Err(WrapError::UnsupportedVersion(99))
        ));
    }

    #[test]
    fn wrong_kind_is_rejected() {
        let dek = MasterDek::generate();
        let mut blob = wrap("p", &dek, Argon2Params::OWASP).unwrap();
        blob[7] = 7;
        assert!(matches!(unwrap("p", &blob), Err(WrapError::WrongKind(7))));
    }

    #[test]
    fn validate_floor_and_ceiling() {
        assert!(Argon2Params {
            memory_kib: 0,
            time_cost: 3,
            parallelism: 4
        }
        .validate()
        .is_err());
        assert!(Argon2Params {
            memory_kib: 65536,
            time_cost: 0,
            parallelism: 4
        }
        .validate()
        .is_err());
        assert!(Argon2Params {
            memory_kib: 65536,
            time_cost: 3,
            parallelism: 0
        }
        .validate()
        .is_err());
        assert!(Argon2Params {
            memory_kib: 100 * 1024 * 1024, // 100 GiB — rejected
            time_cost: 3,
            parallelism: 4
        }
        .validate()
        .is_err());
        assert!(Argon2Params::OWASP.validate().is_ok());
    }

    #[test]
    fn ciphertext_differs_between_wraps_of_same_dek() {
        // Salt + nonce randomness means even the same input yields
        // distinct outputs each time — required for IND-CPA.
        let dek = MasterDek::generate();
        let a = wrap("p", &dek, Argon2Params::OWASP).unwrap();
        let b = wrap("p", &dek, Argon2Params::OWASP).unwrap();
        assert_ne!(a, b);
    }

    #[test]
    fn custom_params_round_trip() {
        let params = Argon2Params {
            memory_kib: 32_768,
            time_cost: 2,
            parallelism: 2,
        };
        let dek = MasterDek::generate();
        let blob = wrap("p", &dek, params).unwrap();
        let recovered = unwrap("p", &blob).unwrap();
        let a = dek.sub_key(crate::dek::ArtifactKind::Settings);
        let b = recovered.sub_key(crate::dek::ArtifactKind::Settings);
        assert_eq!(a.bytes(), b.bytes());
    }

    /// Floor params chosen to mirror what a memory-constrained device
    /// (mobile, small CI runner) would negotiate: the validator's
    /// hard minimum is `memory_kib >= 8` (KiB), `time_cost >= 1`,
    /// `parallelism >= 1`. We pick the smallest practical Argon2id
    /// memory cost (8 MiB = 8192 KiB) which comfortably clears both
    /// the validator floor and the `argon2` crate's `8 * parallelism`
    /// internal floor.
    const DEGRADED_PARAMS: Argon2Params = Argon2Params {
        memory_kib: 8 * 1024,
        time_cost: 1,
        parallelism: 1,
    };

    #[test]
    fn degraded_8mib_params_round_trip() {
        // Property: a device that can only afford 8 MiB / 1 / 1 must
        // still produce a recoverable wrap. This guards against any
        // future "minimum effective security" gate creeping into wrap()
        // that would silently lock low-RAM users out.
        let dek = MasterDek::from_bytes(&[7u8; 32]).expect("32 bytes is valid");
        let blob = wrap("low-mem-password", &dek, DEGRADED_PARAMS).unwrap();
        assert_eq!(blob.len(), FILE_LEN);
        let recovered = unwrap("low-mem-password", &blob).unwrap();
        let a = dek.sub_key(crate::dek::ArtifactKind::Settings);
        let b = recovered.sub_key(crate::dek::ArtifactKind::Settings);
        assert_eq!(a.bytes(), b.bytes());
    }

    #[test]
    fn degraded_params_encoded_in_header_drive_unwrap() {
        // Property: portability. The unwrap() signature deliberately
        // does NOT take Argon2Params — it reads them from the on-disk
        // header. This means a blob wrapped on a 256 MiB phone using
        // 8 MiB params unwraps identically on a beefy desktop without
        // the caller having to remember or transmit the params. We
        // assert that property by invoking unwrap() with no param
        // input and verifying the DEK comes back intact.
        let dek = MasterDek::from_bytes(&[11u8; 32]).expect("32 bytes is valid");
        let blob = wrap("portable", &dek, DEGRADED_PARAMS).unwrap();

        // Caller knows nothing about params; only password + blob.
        let recovered = unwrap("portable", &blob).unwrap();

        let a = dek.sub_key(crate::dek::ArtifactKind::Connections);
        let b = recovered.sub_key(crate::dek::ArtifactKind::Connections);
        assert_eq!(a.bytes(), b.bytes());

        // Belt-and-braces: confirm the header really does store the
        // degraded params (not silently rewritten to OWASP). If a
        // future change "upgrades" params at wrap time the header
        // bytes would diverge from DEGRADED_PARAMS and this would
        // catch it.
        let memory_kib = u32::from_le_bytes(blob[8..12].try_into().unwrap());
        let time_cost = u32::from_le_bytes(blob[12..16].try_into().unwrap());
        let parallelism = u32::from_le_bytes(blob[16..20].try_into().unwrap());
        assert_eq!(memory_kib, DEGRADED_PARAMS.memory_kib);
        assert_eq!(time_cost, DEGRADED_PARAMS.time_cost);
        assert_eq!(parallelism, DEGRADED_PARAMS.parallelism);
    }

    #[test]
    fn validator_rejects_below_floor_memory() {
        // Observed floors in validate():
        //   memory_kib >= 8        (one below: 7 KiB rejected)
        //   time_cost  >= 1        (one below: 0 rejected)
        //   parallelism >= 1       (one below: 0 rejected)
        // Each sub-case exercises one increment below the floor.
        assert!(Argon2Params {
            memory_kib: 7,
            time_cost: 1,
            parallelism: 1,
        }
        .validate()
        .is_err());

        assert!(Argon2Params {
            memory_kib: 8,
            time_cost: 0,
            parallelism: 1,
        }
        .validate()
        .is_err());

        assert!(Argon2Params {
            memory_kib: 8,
            time_cost: 1,
            parallelism: 0,
        }
        .validate()
        .is_err());

        // Spot-check: exactly-on-floor passes. This pins the floor at
        // its current value, so any silent floor-raise becomes visible.
        assert!(Argon2Params {
            memory_kib: 8,
            time_cost: 1,
            parallelism: 1,
        }
        .validate()
        .is_ok());
    }

    #[test]
    fn validator_rejects_above_ceiling_memory() {
        // Observed ceilings in validate():
        //   memory_kib  <= 4 * 1024 * 1024 (4 GiB)
        //   time_cost   <= 50
        //   parallelism <= 64
        // Pass one above the ceiling on each axis, expect Err.
        assert!(Argon2Params {
            memory_kib: 4 * 1024 * 1024 + 1,
            time_cost: 3,
            parallelism: 4,
        }
        .validate()
        .is_err());

        assert!(Argon2Params {
            memory_kib: 65_536,
            time_cost: 51,
            parallelism: 4,
        }
        .validate()
        .is_err());

        assert!(Argon2Params {
            memory_kib: 65_536,
            time_cost: 3,
            parallelism: 65,
        }
        .validate()
        .is_err());

        // Exactly-on-ceiling passes — pins the ceiling values.
        assert!(Argon2Params {
            memory_kib: 4 * 1024 * 1024,
            time_cost: 50,
            parallelism: 64,
        }
        .validate()
        .is_ok());
    }

    #[test]
    fn cross_param_unwrap_with_wrong_blob_fails_cleanly() {
        // Property: the Argon2id parameters live in the file header
        // (offsets 8..20). They are inputs to the KEK derivation but
        // are NOT mixed into AES-GCM's AAD by this implementation —
        // however the GCM tag was computed under the KEK derived from
        // the ORIGINAL params. If an attacker (or filesystem
        // corruption) flips memory_kib in the header, unwrap() will
        // re-derive a different KEK and the GCM tag verification must
        // fail. That's the property we assert here.
        //
        // Variant chosen: header mutation. The header params are
        // plainly readable at offsets 8..12 (memory_kib) and are
        // straightforward to flip without touching the ciphertext.
        let dek = MasterDek::from_bytes(&[42u8; 32]).expect("32 bytes is valid");
        let mut blob = wrap("right", &dek, DEGRADED_PARAMS).unwrap();

        // Flip memory_kib from 8192 to 16384. Both pass validate(),
        // so unwrap() proceeds to Argon2id derivation — but with a
        // KEK that doesn't match the encryption KEK, hence GCM auth
        // must fail.
        let tampered = 16_384u32.to_le_bytes();
        blob[8..12].copy_from_slice(&tampered);

        assert!(matches!(
            unwrap("right", &blob),
            Err(WrapError::AuthenticationFailed)
        ));
    }

    #[test]
    fn performance_envelope_at_owasp_under_n_seconds() {
        // Slow-build smoke test, not a benchmark. Argon2id at 64 MiB
        // / 3 / 4 typically runs ~0.5–2 s on modern dev machines, so
        // a 5 s ceiling leaves comfortable headroom while still
        // catching egregious regressions (e.g. someone bumping
        // time_cost to 30 by accident, or a debug build of argon2
        // sneaking into release). If this fires on CI, the right
        // response is usually to investigate the param change rather
        // than to bump the bound.
        let dek = MasterDek::from_bytes(&[3u8; 32]).expect("32 bytes is valid");
        let start = std::time::Instant::now();
        let blob = wrap("perf", &dek, Argon2Params::OWASP).unwrap();
        let _recovered = unwrap("perf", &blob).unwrap();
        let elapsed = start.elapsed();
        assert!(
            elapsed.as_millis() < 5_000,
            "OWASP wrap+unwrap took {}ms — investigate before raising the bound",
            elapsed.as_millis()
        );
    }
}
