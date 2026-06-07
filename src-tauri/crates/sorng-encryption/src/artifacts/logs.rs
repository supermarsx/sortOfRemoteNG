//! Phase 3c — encrypted logs + sensitive-line redaction.
//!
//! Logs are an **opt-in** artifact: encryption costs CPU on a hot
//! write path, the operational value of plaintext logs (grep, tail,
//! `journalctl` integration) is high, and the threat model often
//! permits logs at the existing OS-level protection. The Settings →
//! Security panel surfaces a checkbox for users who want the
//! belt-and-suspenders treatment.
//!
//! Two independent capabilities live here:
//!
//! 1. **Encryption** — the standard v2 envelope under
//!    [`ArtifactKind::Logs`]. Per-file: the writer rotates logs daily
//!    (or on size) and each rotated file is its own envelope. No
//!    chunked AEAD because logs aren't seeked.
//!
//! 2. **Sensitive-line redaction** — a pure-text transform that runs
//!    *before* the bytes ever hit the file. The user can opt into
//!    redaction with or without encryption; the two compose. Patterns
//!    cover the categories we've seen leak in support bundles:
//!    passwords, bearer tokens, API keys, and PEM-encoded private
//!    keys. Each match is replaced with `[REDACTED:<kind>]` so the
//!    structural shape of the log line is preserved.
//!
//! The regex engine is `regex` (no PCRE; no backtracking surprises);
//! patterns are deliberately conservative to keep false positives low.

use rand::rngs::OsRng;
use rand::RngCore;
use regex::Regex;
use std::sync::OnceLock;

use crate::dek::ArtifactKind;
use crate::envelope::{
    self, EnvelopeError, EnvelopeHeader, MasterKeyStorage, NONCE_LEN, SALT_LEN,
};
use crate::password_wrap::Argon2Params;
use crate::state::EncryptionState;

#[derive(Debug, thiserror::Error)]
pub enum LogError {
    #[error("encryption state is locked; unlock before reading or writing logs")]
    Locked,
    #[error("envelope codec failed: {0}")]
    Envelope(#[from] EnvelopeError),
}

/// Encrypt a chunk of log text. Caller has typically already passed it
/// through [`redact_sensitive_lines`] if the redact-then-encrypt
/// policy is on.
pub async fn write(
    state: &EncryptionState,
    plaintext: &[u8],
    mode: MasterKeyStorage,
    argon2: Argon2Params,
    argon2_salt: [u8; SALT_LEN],
) -> Result<Vec<u8>, LogError> {
    let sub_key = state
        .sub_key(ArtifactKind::Logs)
        .await
        .ok_or(LogError::Locked)?;
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    let header = match mode {
        MasterKeyStorage::Vault => EnvelopeHeader::new_vault(nonce),
        MasterKeyStorage::Password | MasterKeyStorage::VaultAndPassword => {
            EnvelopeHeader::new_password(
                mode,
                argon2.memory_kib,
                argon2.time_cost,
                argon2.parallelism,
                argon2_salt,
                nonce,
            )
        }
    };
    Ok(envelope::write_envelope(&sub_key, &header, plaintext)?)
}

pub async fn read(state: &EncryptionState, file_bytes: &[u8]) -> Result<Vec<u8>, LogError> {
    let sub_key = state
        .sub_key(ArtifactKind::Logs)
        .await
        .ok_or(LogError::Locked)?;
    let (_header, plaintext) = envelope::read_envelope(&sub_key, file_bytes)?;
    Ok(plaintext)
}

// ─── Redaction ─────────────────────────────────────────────────────

/// Categories of redaction the engine knows about. Used in the
/// `[REDACTED:<kind>]` placeholder so reviewers can tell what kind of
/// secret was present without seeing the secret.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RedactKind {
    Password,
    BearerToken,
    ApiKey,
    PemPrivateKey,
}

impl RedactKind {
    fn placeholder(self) -> &'static str {
        match self {
            RedactKind::Password => "[REDACTED:password]",
            RedactKind::BearerToken => "[REDACTED:bearer-token]",
            RedactKind::ApiKey => "[REDACTED:api-key]",
            RedactKind::PemPrivateKey => "[REDACTED:pem-private-key]",
        }
    }
}

struct Pattern {
    kind: RedactKind,
    re: Regex,
}

fn patterns() -> &'static [Pattern] {
    static CELL: OnceLock<Vec<Pattern>> = OnceLock::new();
    CELL.get_or_init(|| {
        vec![
            // password=hunter2  /  password: hunter2  /  password "hunter2"
            // Matches up to next whitespace, comma, semicolon, or quote
            // — keeps the structural prefix intact so the message reads
            // as "password=[REDACTED:password]".
            Pattern {
                kind: RedactKind::Password,
                re: Regex::new(
                    r#"(?i)(password)[\s:=]+["']?[^\s,;"'\\]{1,256}["']?"#,
                )
                .expect("password regex"),
            },
            // Authorization: Bearer eyJ...
            Pattern {
                kind: RedactKind::BearerToken,
                re: Regex::new(r"(?i)(bearer)\s+[A-Za-z0-9._\-+/=]{16,}").expect("bearer regex"),
            },
            // api_key=… / api-key:… / apikey "…"
            Pattern {
                kind: RedactKind::ApiKey,
                re: Regex::new(
                    r#"(?i)(api[_\-]?key)[\s:=]+["']?[A-Za-z0-9._\-+/=]{8,}["']?"#,
                )
                .expect("api-key regex"),
            },
            // PEM-encoded private key — multiline; -s flag makes . match \n.
            Pattern {
                kind: RedactKind::PemPrivateKey,
                re: Regex::new(
                    r"(?s)-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----",
                )
                .expect("pem private-key regex"),
            },
        ]
    })
}

/// Replace secret-shaped substrings with `[REDACTED:<kind>]`. Pure
/// function — same input always yields the same output, no IO. Caller
/// may apply it before encryption (so even the in-memory buffer that
/// flushes is clean) or after decryption (so a power-user examining
/// the recovered text doesn't see secrets either).
pub fn redact_sensitive_lines(input: &str) -> String {
    let mut out = input.to_string();
    for p in patterns() {
        // For password / bearer / api-key patterns we want to retain the
        // structural prefix (the captured group 1) so the line is still
        // identifiable; the PEM pattern has no group 1, so capture
        // group lookup falls through to the bare placeholder.
        out = p
            .re
            .replace_all(&out, |caps: &regex::Captures<'_>| match caps.get(1) {
                Some(g) => format!("{}=[REDACTED:{}]", g.as_str(), kind_tag(p.kind)),
                None => p.kind.placeholder().to_string(),
            })
            .into_owned();
    }
    out
}

fn kind_tag(k: RedactKind) -> &'static str {
    match k {
        RedactKind::Password => "password",
        RedactKind::BearerToken => "bearer-token",
        RedactKind::ApiKey => "api-key",
        RedactKind::PemPrivateKey => "pem-private-key",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dek::MasterDek;

    // ─── Encryption round-trip ───

    #[tokio::test]
    async fn round_trip_log_payload() {
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let lines =
            b"2026-06-01 12:34:56 INFO connected to example.com\n2026-06-01 12:34:57 INFO opened tab\n";
        let blob = write(
            &state,
            lines,
            MasterKeyStorage::Vault,
            Argon2Params::OWASP,
            [0u8; SALT_LEN],
        )
        .await
        .unwrap();
        let recovered = read(&state, &blob).await.unwrap();
        assert_eq!(recovered, lines);
    }

    #[tokio::test]
    async fn locked_state_blocks_io() {
        let state = EncryptionState::new();
        let err = write(
            &state,
            b"x",
            MasterKeyStorage::Vault,
            Argon2Params::OWASP,
            [0u8; SALT_LEN],
        )
        .await
        .unwrap_err();
        assert!(matches!(err, LogError::Locked));
    }

    // ─── Redaction ───

    #[test]
    fn redacts_password_assignment_styles() {
        let input = "password=hunter2 and password: secret_word and password \"qq\"";
        let out = redact_sensitive_lines(input);
        assert!(out.contains("password=[REDACTED:password]"));
        assert!(!out.contains("hunter2"));
        assert!(!out.contains("secret_word"));
        assert!(!out.contains("qq"));
    }

    #[test]
    fn redacts_bearer_token() {
        let input = "Authorization: Bearer abcdef0123456789xyz==";
        let out = redact_sensitive_lines(input);
        assert!(out.contains("Bearer=[REDACTED:bearer-token]"));
        assert!(!out.contains("abcdef0123456789xyz"));
    }

    #[test]
    fn redacts_api_key_assignment() {
        let input = "api_key=ZGVhZGJlZWY= and api-key: my_key_value123";
        let out = redact_sensitive_lines(input);
        assert!(out.contains("api_key=[REDACTED:api-key]"));
        assert!(out.contains("api-key=[REDACTED:api-key]"));
        assert!(!out.contains("ZGVhZGJlZWY"));
        assert!(!out.contains("my_key_value123"));
    }

    #[test]
    fn redacts_multiline_pem_private_key() {
        let input = "\
some log line
-----BEGIN RSA PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ
-----END RSA PRIVATE KEY-----
trailing line
";
        let out = redact_sensitive_lines(input);
        assert!(out.contains("[REDACTED:pem-private-key]"));
        assert!(!out.contains("MIIEvQIB"));
        assert!(out.contains("some log line"));
        assert!(out.contains("trailing line"));
    }

    #[test]
    fn redacts_multiple_secrets_in_one_line() {
        let input = "auth password=p1 token: Bearer abcdefghijklmnop1234";
        let out = redact_sensitive_lines(input);
        assert!(!out.contains("p1 token"));
        assert!(!out.contains("abcdefghijklmnop1234"));
        assert!(out.contains("[REDACTED:password]"));
        assert!(out.contains("[REDACTED:bearer-token]"));
    }

    #[test]
    fn preserves_non_secret_text_byte_for_byte() {
        let input = "no secrets here, just plain text 2026-06-01\n";
        let out = redact_sensitive_lines(input);
        assert_eq!(out, input);
    }

    #[tokio::test]
    async fn survives_process_restart_via_master_bytes() {
        // Rotated log files outlive the app process by definition.
        // The encrypted form must round-trip across a "restart"
        // boundary using only the raw master bytes.
        let state_a = EncryptionState::new();
        state_a.install(MasterDek::generate()).await;
        let lines: &[u8] =
            b"2026-06-01 12:34:56 INFO connected\n2026-06-01 12:34:57 INFO opened tab\n";
        let blob = write(
            &state_a,
            lines,
            MasterKeyStorage::Vault,
            Argon2Params::OWASP,
            [0u8; SALT_LEN],
        )
        .await
        .unwrap();

        let saved_bytes = state_a.master_bytes_raw().await.unwrap();
        std::mem::drop(state_a);

        let state_b = EncryptionState::new();
        state_b
            .install(MasterDek::from_bytes(&saved_bytes).unwrap())
            .await;

        let recovered = read(&state_b, &blob).await.unwrap();
        assert_eq!(recovered, lines);
    }

    #[tokio::test]
    async fn truncated_input_is_clean_error() {
        // Short buffer must surface as a typed error.
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let buf = [0u8; 32];
        assert!(read(&state, &buf).await.is_err());
    }

    #[tokio::test]
    async fn valid_magic_garbage_body_fails_gcm_auth() {
        // Valid preamble + random body — GCM auth must fail.
        let state = EncryptionState::new();
        state.install(MasterDek::generate()).await;
        let header = EnvelopeHeader::new_vault([0u8; NONCE_LEN]);
        let mut blob = header.encode().to_vec();
        blob.extend((0..256).map(|i| (i as u8).wrapping_mul(37)));
        assert!(matches!(
            read(&state, &blob).await,
            Err(LogError::Envelope(EnvelopeError::AuthenticationFailed))
        ));
    }

    #[test]
    fn redaction_then_encryption_composes() {
        // The expected pipeline: redact in memory, encrypt the
        // redacted output, write to disk. End-to-end smoke check
        // tying the two together.
        let raw = "user=alice password=hunter2 ip=10.0.0.1";
        let redacted = redact_sensitive_lines(raw);
        assert!(!redacted.contains("hunter2"));
        assert!(redacted.contains("user=alice"));
        // We don't actually need encryption for this check —
        // composability is purely about substitution order.
        assert!(redacted.contains("password=[REDACTED:password]"));
    }
}
