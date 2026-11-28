//! Evidence from the actual routed session, before authentication. No extra probe,
//! packet tracing, credentials or security fallback is involved.
use super::types::{JumpHostConfig, SshConnectionConfig};
use ssh2::{MethodType, Session};

pub(super) struct Preferences<'a> {
    ciphers: &'a [String],
    macs: &'a [String],
    kex: &'a [String],
    host_keys: &'a [String],
}
impl<'a> From<&'a SshConnectionConfig> for Preferences<'a> {
    fn from(c: &'a SshConnectionConfig) -> Self {
        Self {
            ciphers: &c.preferred_ciphers,
            macs: &c.preferred_macs,
            kex: &c.preferred_kex,
            host_keys: &c.preferred_host_key_algorithms,
        }
    }
}
impl<'a> From<&'a JumpHostConfig> for Preferences<'a> {
    fn from(c: &'a JumpHostConfig) -> Self {
        Self {
            ciphers: &c.preferred_ciphers,
            macs: &c.preferred_macs,
            kex: &c.preferred_kex,
            host_keys: &c.preferred_host_key_algorithms,
        }
    }
}
const FAMILIES: [(MethodType, &str); 8] = [
    (MethodType::Kex, "Key exchange"),
    (MethodType::HostKey, "Host-key signature"),
    (MethodType::CryptCs, "Cipher client → server"),
    (MethodType::CryptSc, "Cipher server → client"),
    (MethodType::MacCs, "MAC client → server"),
    (MethodType::MacSc, "MAC server → client"),
    (MethodType::CompCs, "Compression client → server"),
    (MethodType::CompSc, "Compression server → client"),
];
impl Preferences<'_> {
    fn for_method(&self, method: MethodType) -> &[String] {
        match method {
            MethodType::Kex => self.kex,
            MethodType::HostKey => self.host_keys,
            MethodType::CryptCs | MethodType::CryptSc => self.ciphers,
            MethodType::MacCs | MethodType::MacSc => self.macs,
            _ => &[],
        }
    }
}
fn safe(value: &str, limit: usize) -> String {
    value
        .chars()
        .take(limit)
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect()
}
fn evidence(session: &Session, prefs: &Preferences<'_>) -> String {
    let mut lines = vec![format!("Backend: ssh2/libssh2 ({}-{})", std::env::consts::OS, std::env::consts::ARCH),
        format!("Server banner: {}", session.banner().map(|b| safe(b, 255)).unwrap_or_else(|| "unavailable".into())),
        "Selections below may be partial; a failed handshake does not establish encryption or host-key trust.".into()];
    for (method, name) in FAMILIES {
        let requested = prefs.for_method(method);
        let supported = session.supported_algs(method).ok();
        let unsupported: Vec<_> = requested
            .iter()
            .filter(|name| {
                supported
                    .as_ref()
                    .is_some_and(|s| !s.contains(&name.as_str()))
            })
            .cloned()
            .collect();
        lines.push(format!(
            "{name}:\n  Configured: {}\n  Supported by this build: {}\n  Selected: {}{}",
            if requested.is_empty() {
                "library defaults (compression follows its configuration)".into()
            } else {
                safe(&requested.join(", "), 2048)
            },
            supported
                .map(|s| safe(&s.join(", "), 2048))
                .unwrap_or_else(|| "unavailable".into()),
            session
                .methods(method)
                .map(|m| safe(m, 256))
                .unwrap_or_else(|| "unavailable".into()),
            if unsupported.is_empty() {
                String::new()
            } else {
                format!(
                    "\n  Configured but unsupported locally: {}",
                    safe(&unsupported.join(", "), 2048)
                )
            }
        ));
    }
    lines.join("\n")
}
fn failure(session: &Session, prefs: &Preferences<'_>, error: &ssh2::Error, stage: &str) -> String {
    let reason = match error.code() {
        ssh2::ErrorCode::Session(-5) => "LIBSSH2_ERROR_KEX_FAILURE: key exchange failed; the library did not preserve the underlying cause.",
        ssh2::ErrorCode::Session(-8) => "LIBSSH2_ERROR_KEY_EXCHANGE_FAILURE: key exchange could not complete.",
        ssh2::ErrorCode::Session(-9) => "LIBSSH2_ERROR_TIMEOUT: the SSH operation timed out.",
        ssh2::ErrorCode::Session(-13) => "LIBSSH2_ERROR_SOCKET_DISCONNECT: the peer disconnected.",
        ssh2::ErrorCode::Session(-33) => "LIBSSH2_ERROR_METHOD_NOT_SUPPORTED: a configured algorithm family is unsupported locally.",
        _ => "The native library returned the error above; see the observed negotiation evidence below.",
    };
    format!("SSH handshake failed: {} {}\nStage: {}\nRecorded in UTC: {}\n{reason}\n{}\nNext step: compare the configured and locally supported algorithms in Connection → Protocol → Security. Check this timestamp in the server SSH log for the peer's reason. Full server proposal lists and crypto-provider internals are not exposed by ssh2; an unavailable selection does not prove an algorithm mismatch. MACs can be implicit in AEAD ciphers. Authentication has not started.",
        error.code(), safe(error.message(), 512), safe(stage, 160), chrono::Utc::now().to_rfc3339(), evidence(session, prefs))
}
pub(super) fn apply(session: &mut Session, prefs: Preferences<'_>) -> Result<(), String> {
    for (method, name) in FAMILIES.into_iter().take(6) {
        let requested = prefs.for_method(method);
        if requested.is_empty() {
            continue;
        }
        if requested.len() > 64
            || requested.iter().any(|value| {
                value.is_empty()
                    || value.len() > 128
                    || !value
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"@._+-".contains(&b))
            })
        {
            return Err(format!("Invalid SSH {name} preferences: use at most 64 algorithm names of 1–128 ASCII letters, digits or @._+- characters."));
        }
        if let Ok(supported) = session.supported_algs(method) {
            if !requested
                .iter()
                .any(|name| supported.contains(&name.as_str()))
            {
                return Err(format!(
                    "SSH algorithm configuration failed: The configured algorithm list has no algorithm supported by this client build\nStage: Configure {name} before handshake\nRecorded in UTC: {}\nThis is a local capability check; no SSH handshake was attempted and no native failure code was returned.\n{}\nNext step: select a supported {name} algorithm in Protocol → Security, or reset the override to inherit global settings. Authentication has not started.",
                    chrono::Utc::now().to_rfc3339(), evidence(session, &prefs)
                ));
            }
        }
        session
            .method_pref(method, &requested.join(","))
            .map_err(|e| {
                failure(
                    session,
                    &prefs,
                    &e,
                    &format!("Configure {name} before handshake"),
                )
            })?;
    }
    Ok(())
}
pub(super) fn run(
    session: &mut Session,
    prefs: Preferences<'_>,
    stage: &str,
) -> Result<(), String> {
    session
        .handshake()
        .map_err(|error| failure(session, &prefs, &error, stage))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn generic_failure_reports_evidence_without_inventing_peer_offers() {
        let session = Session::new().unwrap();
        let config: SshConnectionConfig = serde_json::from_value(serde_json::json!({"host":"example", "port":22, "username":"secret-user", "password":"secret-password", "strict_host_key_checking":true, "jump_hosts":[], "preferred_kex":["fictional-kex"]})).unwrap();
        let error = ssh2::Error::new(
            ssh2::ErrorCode::Session(-5),
            "Unable to exchange encryption keys",
        );
        let text = failure(
            &session,
            &Preferences::from(&config),
            &error,
            "Final target",
        );
        for expected in [
            "LIBSSH2_ERROR_KEX_FAILURE",
            "Configured: fictional-kex",
            "Configured but unsupported locally: fictional-kex",
            "Selected: unavailable",
            "Full server proposal lists",
            "Authentication has not started",
            "Recorded in UTC",
        ] {
            assert!(text.contains(expected), "{expected}");
        }
        assert!(!text.contains("secret-user"));
        assert!(!text.contains("secret-password"));
    }
    #[test]
    fn unsupported_preferences_fail_before_handshake_with_build_capabilities() {
        let mut session = Session::new().unwrap();
        let values = vec!["fictional-kex".into()];
        let prefs = Preferences {
            ciphers: &[],
            macs: &[],
            kex: &values,
            host_keys: &[],
        };
        let text = apply(&mut session, prefs).unwrap_err();
        assert!(text.contains("Supported by this build"));
        assert!(text.contains("Configure Key exchange"));
    }
    #[test]
    fn preference_names_cannot_inject_additional_lists_or_diagnostic_lines() {
        for value in ["a,b", "a\nb", "a\0b", ""] {
            let mut session = Session::new().unwrap();
            let values = vec![value.into()];
            assert!(apply(
                &mut session,
                Preferences {
                    ciphers: &[],
                    macs: &[],
                    kex: &values,
                    host_keys: &[]
                }
            )
            .unwrap_err()
            .starts_with("Invalid SSH Key exchange preferences"));
        }
    }
}
