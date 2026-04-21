//! # Password hashing primitives
//!
//! Rust-backed password hashing for the application, replacing the previous
//! `bcryptjs` JavaScript implementation.
//!
//! - **New hashes** are produced with **Argon2id** using OWASP-recommended
//!   parameters (memory 19 MiB, time cost 2, parallelism 1).
//! - **Legacy bcrypt hashes** (those beginning with `$2a$`, `$2b$`, `$2x$` or
//!   `$2y$`) continue to be verifiable via the `bcrypt` crate so existing
//!   user stores keep working. Callers should detect
//!   [`needs_rehash`] after a successful verify and transparently re-hash
//!   the plaintext with Argon2id on next login.
//!
//! Algorithm choice is encoded in the hash string itself (PHC string format
//! for Argon2, `$2b$…` prefix for bcrypt) so no external metadata is
//! required.

use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Algorithm, Argon2, Params, Version,
};

/// OWASP-recommended Argon2id parameters (as of 2024):
///   m = 19456 KiB (19 MiB), t = 2, p = 1
const ARGON2_MEMORY_KIB: u32 = 19_456;
const ARGON2_TIME_COST: u32 = 2;
const ARGON2_PARALLELISM: u32 = 1;

/// Builds the project-wide Argon2id hasher with OWASP params.
fn argon2_hasher() -> Argon2<'static> {
    // `Params::new` only fails on out-of-range values; the constants above
    // are statically valid, so this unwrap is infallible.
    let params = Params::new(
        ARGON2_MEMORY_KIB,
        ARGON2_TIME_COST,
        ARGON2_PARALLELISM,
        None,
    )
    .expect("valid Argon2 params");
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
}

/// Returns `true` if the given hash string looks like a legacy bcrypt hash.
///
/// Bcrypt PHC-ish strings always start with `$2a$`, `$2b$`, `$2x$` or `$2y$`.
pub fn is_bcrypt_hash(hash: &str) -> bool {
    hash.starts_with("$2a$")
        || hash.starts_with("$2b$")
        || hash.starts_with("$2x$")
        || hash.starts_with("$2y$")
}

/// Hashes a plaintext password with Argon2id (OWASP params).
///
/// Returns a PHC-format string suitable for storage and later passing to
/// [`verify_password`].
pub fn hash_password(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    argon2_hasher()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| format!("argon2 hash failed: {e}"))
}

/// Verifies a plaintext password against a stored hash.
///
/// Transparently dispatches between Argon2id (current) and bcrypt (legacy)
/// based on the hash's prefix. Returns `Ok(false)` for mismatches; only
/// returns `Err` when the hash itself is malformed.
pub fn verify_password(password: &str, hash: &str) -> Result<bool, String> {
    if is_bcrypt_hash(hash) {
        // Legacy bcrypt path. `bcrypt::verify` returns Ok(false) on mismatch
        // and Err only on malformed hashes; treat the latter as a hard error
        // so callers can surface data-corruption issues.
        bcrypt::verify(password, hash).map_err(|e| format!("bcrypt verify failed: {e}"))
    } else {
        let parsed = PasswordHash::new(hash).map_err(|e| format!("malformed argon2 hash: {e}"))?;
        Ok(argon2_hasher()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok())
    }
}

/// Returns `true` if the stored hash should be re-hashed with the current
/// algorithm. Currently: any bcrypt hash. Callers should invoke
/// [`hash_password`] and persist the new value on next successful login.
pub fn needs_rehash(hash: &str) -> bool {
    is_bcrypt_hash(hash)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn argon2_roundtrip() {
        let h = hash_password("hunter2").unwrap();
        assert!(h.starts_with("$argon2id$"));
        assert!(verify_password("hunter2", &h).unwrap());
        assert!(!verify_password("wrong", &h).unwrap());
        assert!(!needs_rehash(&h));
    }

    #[test]
    fn argon2_unique_salts() {
        let a = hash_password("same").unwrap();
        let b = hash_password("same").unwrap();
        assert_ne!(a, b, "salt should randomise output");
    }

    #[test]
    fn bcrypt_legacy_verifies() {
        // Pre-computed bcrypt hash of "hunter2" (cost 4 for fast tests).
        let legacy = bcrypt::hash("hunter2", 4).unwrap();
        assert!(is_bcrypt_hash(&legacy));
        assert!(needs_rehash(&legacy));
        assert!(verify_password("hunter2", &legacy).unwrap());
        assert!(!verify_password("nope", &legacy).unwrap());
    }

    #[test]
    fn malformed_hash_is_error() {
        assert!(verify_password("x", "not-a-real-hash").is_err());
    }

    #[test]
    fn is_bcrypt_hash_prefixes() {
        assert!(is_bcrypt_hash("$2a$10$xxx"));
        assert!(is_bcrypt_hash("$2b$10$xxx"));
        assert!(is_bcrypt_hash("$2y$10$xxx"));
        assert!(!is_bcrypt_hash("$argon2id$v=19$m=19456,t=2,p=1$abc$def"));
    }
}
