//! Read-only observations of this probe's libssh2 session. Never changes method preferences.
use sorng_core::diagnostics::DiagnosticStep;
use ssh2::{Error, ErrorCode, HostKeyType, MethodType, Session};
use std::io;
use std::time::{Duration, Instant};

const FAMILIES: [(MethodType, &str); 8] = [
    (MethodType::Kex, "KEX"),
    (MethodType::HostKey, "Host-key signature"),
    (MethodType::CryptCs, "Cipher client->server"),
    (MethodType::CryptSc, "Cipher server->client"),
    (MethodType::MacCs, "MAC client->server"),
    (MethodType::MacSc, "MAC server->client"),
    (MethodType::CompCs, "Compression client->server"),
    (MethodType::CompSc, "Compression server->client"),
];

pub(super) fn safe_text(value: &str, limit: usize) -> String {
    let mut chars = value.chars();
    let mut text: String = chars
        .by_ref()
        .take(limit)
        .map(|c| {
            if c.is_ascii() && !c.is_ascii_control() {
                c
            } else {
                '?'
            }
        })
        .collect();
    if chars.next().is_some() {
        text.push_str(" [truncated]");
    }
    text
}

pub(super) fn effective_timeout(seconds: u64) -> Duration {
    Duration::from_secs(seconds.clamp(1, 300))
}

pub(super) fn scope_step(requested: u64) -> DiagnosticStep {
    let timeout = effective_timeout(requested).as_secs();
    DiagnosticStep {
        name: "Probe Scope".into(), status: "info".into(), duration_ms: 0,
        message: "Independent direct TCP probe with libssh2 default settings".into(),
        detail: Some(format!(
            "Requested timeout: {requested}s; effective connect/per-operation timeout: {timeout}s (clamped to 1..300s); banner deadline: {}s. \
             Not a whole-probe deadline: OS DNS and local key/agent operations are not bounded by this timeout. \
             Uses the first resolved endpoint only, with separate banner and handshake TCP connections; they may reach different backend servers. \
             No production proxy, jump/hop, VPN routing policy, configured algorithm, keepalive or authentication-flow parity. \
             No Trust Center/known_hosts verification is performed; a fingerprint is an observation, not verified server identity. \
             Full server algorithm offers and underlying crypto-provider failures are not exposed by ssh2; libssh2 can replace a specific KEX error with a generic message. \
             No credentials, private-key contents or packet traces are included.", timeout.min(5))),
    }
}

pub(super) fn capabilities_step(session: &Session) -> DiagnosticStep {
    let mut detail = vec![format!(
        "Backend: ssh2/libssh2; target {}-{}. Crypto provider is not exposed by the ssh2 API. \
         Repository bundled Windows build uses WinCNG with ECDSA enabled (build overrides can differ). \
         Lists below come from Session::supported_algs in this running build; they are capabilities, not the actual wire offers or security recommendations. \
         No algorithm preferences were changed; legacy names, if present, are not recommendations to enable them.",
        std::env::consts::ARCH, std::env::consts::OS
    )];
    let mut failed = false;
    for (family, name) in FAMILIES {
        let value = match session.supported_algs(family) {
            Ok(algs) => safe_text(&algs.join(", "), 2048),
            Err(error) => {
                failed = true;
                format!("unavailable: {}", error_identity(&error))
            }
        };
        detail.push(format!("{name}: {value}"));
    }
    DiagnosticStep {
        name: "Client Algorithms".into(),
        status: if failed { "warn" } else { "info" }.into(),
        message: "Client-supported algorithm families reported by this libssh2 build".into(),
        detail: Some(detail.join("\n")),
        duration_ms: 0,
    }
}

pub(super) fn negotiated_step(session: &Session, complete: bool) -> DiagnosticStep {
    let values = FAMILIES.map(|(family, name)| (name, session.methods(family)));
    algorithm_observation_step(&values, session.banner_bytes(), complete)
}

fn algorithm_observation_step(
    values: &[(&str, Option<&str>)],
    banner: Option<&[u8]>,
    complete: bool,
) -> DiagnosticStep {
    let mut detail = vec![if complete {
        "Negotiated methods reported after successful handshake. This does not verify host-key trust."
    } else {
        "Partial selections only: failed handshake; these are not proof that encryption was established. Missing values mean unavailable, not no common algorithm."
    }.to_string()];
    detail.push(format!(
        "Handshake connection server banner: {}",
        banner
            .map(|b| safe_text(&String::from_utf8_lossy(b), 255))
            .unwrap_or_else(|| "unavailable".into())
    ));
    for (name, value) in values {
        detail.push(format!(
            "{name}: {}",
            value
                .map(|v| safe_text(v, 256))
                .unwrap_or_else(|| "unavailable".into())
        ));
    }
    detail.push("MAC may be implicit in an AEAD cipher; interpret each direction together with its cipher. Server proposal lists are unavailable via ssh2.".into());
    DiagnosticStep {
        name: "Negotiated Algorithms".into(),
        status: "info".into(),
        duration_ms: 0,
        message: if complete {
            "Negotiated SSH algorithms"
        } else {
            "Algorithm selections available at handshake failure (possibly partial)"
        }
        .into(),
        detail: Some(detail.join("\n")),
    }
}

// Symbols follow the installed libssh2.h. Preserve unknown numeric codes rather than guessing.
pub(super) fn error_identity(error: &Error) -> String {
    let (symbol, category) = match error.code() {
        ErrorCode::Session(-1) => ("LIBSSH2_ERROR_SOCKET_NONE", "socket"),
        ErrorCode::Session(-2) => ("LIBSSH2_ERROR_BANNER_RECV", "banner receive"),
        ErrorCode::Session(-3) => ("LIBSSH2_ERROR_BANNER_SEND", "banner send"),
        ErrorCode::Session(-4) => ("LIBSSH2_ERROR_INVALID_MAC", "integrity"),
        ErrorCode::Session(-5) => (
            "LIBSSH2_ERROR_KEX_FAILURE",
            "key exchange (cause undetermined)",
        ),
        ErrorCode::Session(-6) => ("LIBSSH2_ERROR_ALLOC", "allocation"),
        ErrorCode::Session(-7) => ("LIBSSH2_ERROR_SOCKET_SEND", "transport send"),
        ErrorCode::Session(-8) => (
            "LIBSSH2_ERROR_KEY_EXCHANGE_FAILURE",
            "key exchange (cause undetermined)",
        ),
        ErrorCode::Session(-9) => ("LIBSSH2_ERROR_TIMEOUT", "timeout"),
        ErrorCode::Session(-10) => ("LIBSSH2_ERROR_HOSTKEY_INIT", "host-key initialization"),
        ErrorCode::Session(-11) => ("LIBSSH2_ERROR_HOSTKEY_SIGN", "host-key signature"),
        ErrorCode::Session(-12) => ("LIBSSH2_ERROR_DECRYPT", "decryption"),
        ErrorCode::Session(-13) => ("LIBSSH2_ERROR_SOCKET_DISCONNECT", "transport disconnect"),
        ErrorCode::Session(-14) => ("LIBSSH2_ERROR_PROTO", "protocol"),
        ErrorCode::Session(-16) => ("LIBSSH2_ERROR_FILE", "local file"),
        ErrorCode::Session(-17) => ("LIBSSH2_ERROR_METHOD_NONE", "method configuration"),
        ErrorCode::Session(-18) => ("LIBSSH2_ERROR_AUTHENTICATION_FAILED", "authentication"),
        ErrorCode::Session(-19) => (
            "LIBSSH2_ERROR_PUBLICKEY_UNVERIFIED",
            "public-key authentication",
        ),
        ErrorCode::Session(-30) => ("LIBSSH2_ERROR_SOCKET_TIMEOUT", "socket timeout"),
        ErrorCode::Session(-33) => ("LIBSSH2_ERROR_METHOD_NOT_SUPPORTED", "method unsupported"),
        ErrorCode::Session(-37) => ("LIBSSH2_ERROR_EAGAIN", "would block"),
        ErrorCode::Session(-43) => ("LIBSSH2_ERROR_SOCKET_RECV", "transport receive"),
        ErrorCode::Session(-44) => ("LIBSSH2_ERROR_ENCRYPT", "encryption"),
        ErrorCode::Session(-45) => ("LIBSSH2_ERROR_BAD_SOCKET", "socket"),
        ErrorCode::Session(-48) => (
            "LIBSSH2_ERROR_KEYFILE_AUTH_FAILED",
            "key-file authentication",
        ),
        ErrorCode::Session(-49) => ("LIBSSH2_ERROR_RANDGEN", "random generation"),
        ErrorCode::Session(-51) => (
            "LIBSSH2_ERROR_ALGO_UNSUPPORTED",
            "algorithm unsupported (not proof of peer mismatch)",
        ),
        ErrorCode::Session(_) => ("unmapped libssh2 code", "session"),
        ErrorCode::SFTP(_) => ("SFTP status", "SFTP"),
    };
    format!("{}; symbol={symbol}; category={category}", error.code())
}

fn confirmed_no_match(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    [
        "no matching key exchange",
        "no matching kex",
        "no matching cipher",
        "no matching mac",
        "no matching host key",
        "no matching hostkey",
        "no matching compression",
        "no match for method",
    ]
    .iter()
    .any(|p| lower.contains(p))
}

pub(super) fn handshake_step(result: &Result<(), Error>, elapsed: Duration) -> DiagnosticStep {
    match result {
        Ok(()) => DiagnosticStep {
            name: "Key Exchange".into(), status: "pass".into(), duration_ms: elapsed.as_millis() as u64,
            message: "SSH handshake completed successfully".into(),
            detail: Some("Encryption established for this probe. Host-key trust has not been verified; production connection success is not established.".into()),
        },
        Err(error) => {
            let guidance = if confirmed_no_match(error.message()) {
                "Explicit no-match error reported. Compare the named family against this client's capabilities and the server's configured offers. Use a mutually supported modern algorithm; do not enable weak algorithms or lower global security settings."
            } else {
                "The error does not establish an algorithm mismatch. Compare the selected endpoint, both banners, and any partial methods below; correlate the attempt time with server SSH logs. Check server disconnects, protocol/crypto failures and network interruptions. Compare configured production algorithms and proxy/hop routing separately; do not enable weak algorithms or lower global security settings."
            };
            DiagnosticStep {
                name: "Key Exchange".into(), status: "fail".into(), duration_ms: elapsed.as_millis() as u64,
                message: format!("SSH handshake failed: [{}] {}", error.code(), safe_text(error.message(), 512)),
                detail: Some(format!("{}\n{guidance}", error_identity(error))),
            }
        }
    }
}

/// Bounded, incremental SSH identification reader. Preamble contents are discarded.
/// The callback must enforce the supplied remaining deadline on each blocking read.
pub(super) fn read_identification(
    mut read: impl FnMut(&mut [u8], Duration) -> io::Result<usize>,
    timeout: Duration,
) -> io::Result<(String, usize)> {
    let start = Instant::now();
    let mut line = Vec::new();
    let mut total = 0;
    let mut preamble_lines = 0;
    let invalid = |message| io::Error::new(io::ErrorKind::InvalidData, message);
    loop {
        let remaining = timeout
            .checked_sub(start.elapsed())
            .filter(|d| !d.is_zero())
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::TimedOut,
                    "SSH identification deadline expired",
                )
            })?;
        let mut buf = [0; 256];
        let n = match read(&mut buf, remaining) {
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            other => other?,
        };
        if n == 0 {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "Connection closed before a complete SSH identification line",
            ));
        }
        for &byte in &buf[..n] {
            total += 1;
            if total > 4096 {
                return Err(invalid("SSH identification exceeded 4096-byte limit"));
            }
            line.push(byte);
            if line.len() > 255 {
                return Err(invalid(
                    "Identification/preamble line exceeded 255-byte limit",
                ));
            }
            if byte != b'\n' {
                continue;
            }
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            if line.starts_with(b"SSH-") {
                if !line.iter().all(|c| (0x20..=0x7e).contains(c)) {
                    return Err(invalid(
                        "Invalid control/non-ASCII byte in SSH identification",
                    ));
                }
                let text =
                    String::from_utf8(line).map_err(|_| invalid("Invalid SSH identification"))?;
                let version = text
                    .strip_prefix("SSH-2.0-")
                    .or_else(|| text.strip_prefix("SSH-1.99-"))
                    .ok_or_else(|| {
                        invalid("Unsupported SSH protocol identification (expected 2.0 or 1.99)")
                    })?;
                if version.is_empty() || version.starts_with(' ') {
                    return Err(invalid("Missing SSH software identification"));
                }
                return Ok((text, preamble_lines));
            }
            preamble_lines += 1;
            if preamble_lines > 32 {
                return Err(invalid("SSH identification exceeded 32 preamble lines"));
            }
            line.clear();
        }
    }
}

/// RSA bits are the mpint modulus bit length, not the size of the SSH wire blob.
/// This observes public-key parameters only; it performs no trust verification.
pub fn observed_host_key_bits(raw: &[u8], kind: HostKeyType) -> Option<u32> {
    fn field<'a>(input: &mut &'a [u8]) -> Option<&'a [u8]> {
        let size = u32::from_be_bytes(input.get(..4)?.try_into().ok()?) as usize;
        *input = input.get(4..)?;
        let value = input.get(..size)?;
        *input = input.get(size..)?;
        Some(value)
    }
    fn positive_bits(bytes: &[u8]) -> Option<u32> {
        if bytes.first()? & 0x80 != 0 {
            return None;
        }
        let first = bytes.iter().position(|&b| b != 0)?;
        u32::try_from((bytes.len() - first - 1) * 8 + (8 - bytes[first].leading_zeros()) as usize)
            .ok()
    }
    match kind {
        HostKeyType::Rsa | HostKeyType::Dss => {
            // Avoid parsing an unexpectedly huge public-key blob.
            if raw.len() > 65536 {
                return None;
            }
            let mut input = raw;
            let name = field(&mut input)?;
            if matches!(kind, HostKeyType::Rsa) {
                if name != b"ssh-rsa" {
                    return None;
                }
                positive_bits(field(&mut input)?)?; // exponent
                let bits = positive_bits(field(&mut input)?)?;
                input.is_empty().then_some(bits)
            } else {
                if name != b"ssh-dss" {
                    return None;
                }
                let bits = positive_bits(field(&mut input)?)?; // p
                for _ in 0..3 {
                    positive_bits(field(&mut input)?)?;
                }
                input.is_empty().then_some(bits)
            }
        }
        HostKeyType::Ed25519 | HostKeyType::Ecdsa256 => Some(256),
        HostKeyType::Ecdsa384 => Some(384),
        HostKeyType::Ecdsa521 => Some(521),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn ssh_diagnostics_capabilities_are_from_the_running_library() {
        let session = Session::new().unwrap();
        let step = capabilities_step(&session);
        assert_eq!(step.status, "info");
        let detail = step.detail.unwrap();
        for (family, name) in FAMILIES {
            let expected = session.supported_algs(family).unwrap().join(", ");
            assert!(!expected.is_empty(), "{name}");
            assert!(detail.contains(&format!("{name}: {expected}")));
        }
        println!("{detail}");
        assert!(detail.contains("not the actual wire offers"));
        assert!(detail.contains("No algorithm preferences were changed"));
    }

    #[test]
    fn ssh_diagnostics_failures_keep_codes_and_do_not_invent_mismatches() {
        for (code, symbol) in [
            (-5, "KEX_FAILURE"),
            (-8, "KEY_EXCHANGE_FAILURE"),
            (-9, "TIMEOUT"),
            (-43, "SOCKET_RECV"),
            (-51, "ALGO_UNSUPPORTED"),
        ] {
            let error = Error::new(
                ErrorCode::Session(code),
                "Unable to exchange encryption keys",
            );
            let step = handshake_step(&Err(error), Duration::from_millis(12));
            assert_eq!(step.status, "fail");
            assert_eq!(step.duration_ms, 12);
            assert!(step.message.contains(&format!("Session({code})")));
            let detail = step.detail.unwrap();
            assert!(detail.contains(symbol));
            assert!(detail.contains("does not establish an algorithm mismatch"));
        }
        let sftp = error_identity(&Error::new(ErrorCode::SFTP(5), "unused"));
        assert!(sftp.contains("category=SFTP"));
        assert!(!sftp.contains("KEX"));
        assert!(
            error_identity(&Error::new(ErrorCode::Session(-999), "unused")).contains("unmapped")
        );
    }

    #[test]
    fn ssh_diagnostics_only_explicit_no_match_confirms_a_mismatch() {
        let step = handshake_step(
            &Err(Error::new(
                ErrorCode::Session(-5),
                "no matching cipher found",
            )),
            Duration::ZERO,
        );
        assert!(step
            .detail
            .unwrap()
            .contains("Explicit no-match error reported"));
        assert!(!confirmed_no_match("Unable to exchange encryption keys"));
        assert!(!confirmed_no_match("algorithm unsupported"));
    }

    #[test]
    fn ssh_diagnostics_success_and_partial_observations_have_different_claims() {
        let success = handshake_step(&Ok(()), Duration::from_millis(10));
        assert_eq!(success.status, "pass");
        assert!(success
            .detail
            .unwrap()
            .contains("trust has not been verified"));
        let selections = [
            ("KEX", Some("ecdh-sha2-nistp256")),
            ("Cipher client->server", None),
        ];
        let partial = algorithm_observation_step(&selections, Some(b"SSH-2.0-fixture\x1b"), false)
            .detail
            .unwrap();
        assert!(partial.contains("Partial selections only"));
        assert!(partial.contains("Cipher client->server: unavailable"));
        assert!(partial.contains("KEX: ecdh-sha2-nistp256"));
        assert!(!partial.contains('\x1b'));
        let complete = algorithm_observation_step(&selections, None, true)
            .detail
            .unwrap();
        assert!(complete.contains("after successful handshake"));
        assert!(complete.contains("banner: unavailable"));
        let fresh = negotiated_step(&Session::new().unwrap(), false)
            .detail
            .unwrap();
        assert!(fresh.contains("KEX: unavailable"));
    }

    fn identification(bytes: &[u8], chunk: usize) -> io::Result<(String, usize)> {
        let mut input = io::Cursor::new(bytes);
        read_identification(
            |out, _| {
                let len = out.len().min(chunk);
                input.read(&mut out[..len])
            },
            Duration::from_secs(1),
        )
    }

    #[test]
    fn ssh_diagnostics_banner_handles_fragments_and_discards_preamble_and_packets() {
        for chunk in [1, 3, 256] {
            let result = identification(
                b"Private preamble\r\nNotice\nSSH-2.0-fixture_1.0 comment\r\n\0binary packet",
                chunk,
            )
            .unwrap();
            assert_eq!(result, ("SSH-2.0-fixture_1.0 comment".into(), 2));
        }
        assert!(identification(b"SSH-1.99-fixture\n", 256).is_ok());
        assert!(identification(b"SSH-1.5-fixture\n", 256).is_err());
    }

    #[test]
    fn ssh_diagnostics_banner_is_bounded_and_rejects_malformed_identification() {
        for bytes in [
            b"SSH-2.0-incomplete".as_slice(),
            b"SSH-2.0-\r\n",
            b"SSH-2.0- bad\n",
            b"SSH-2.0-a\x1b[31m\n",
            b"HTTP/1.0 200 OK\r\n",
        ] {
            assert!(identification(bytes, 256).is_err());
        }
        assert!(identification(&vec![b'A'; 256], 256)
            .unwrap_err()
            .to_string()
            .contains("255-byte"));
        assert!(identification("a\n".repeat(33).as_bytes(), 256)
            .unwrap_err()
            .to_string()
            .contains("32 preamble"));
        assert!(
            identification(format!("{}\n", "a".repeat(249)).repeat(17).as_bytes(), 256)
                .unwrap_err()
                .to_string()
                .contains("4096-byte")
        );
        let error = read_identification(
            |_, _| panic!("expired deadline must not read"),
            Duration::ZERO,
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        let error = read_identification(
            |_, remaining| {
                assert!(remaining <= Duration::from_millis(100));
                Err(io::Error::from(io::ErrorKind::TimedOut))
            },
            Duration::from_millis(100),
        )
        .unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
    }

    #[test]
    fn ssh_diagnostics_timeouts_and_report_text_are_bounded() {
        assert_eq!(effective_timeout(0), Duration::from_secs(1));
        assert_eq!(effective_timeout(u64::MAX), Duration::from_secs(300));
        assert_eq!(effective_timeout(10), Duration::from_secs(10));
        let detail = scope_step(u64::MAX).detail.unwrap();
        for limitation in [
            "per-operation",
            "OS DNS",
            "No production proxy",
            "No Trust Center",
            "separate banner and handshake",
            "Full server algorithm offers",
        ] {
            assert!(detail.contains(limitation), "{limitation}");
        }
        assert_eq!(safe_text("ab\n\x1bcd", 4), "ab?? [truncated]");
    }

    fn rsa_blob(modulus: &[u8]) -> Vec<u8> {
        let mut blob = Vec::new();
        for field in [b"ssh-rsa".as_slice(), &[1, 0, 1], modulus] {
            blob.extend_from_slice(&(field.len() as u32).to_be_bytes());
            blob.extend_from_slice(field);
        }
        blob
    }

    #[test]
    fn ssh_diagnostics_rsa_bits_measure_modulus_not_serialized_blob() {
        for bits in [1024, 2048, 2049, 3072, 4096] {
            let mut modulus = vec![0; (bits + 7) / 8];
            modulus[0] = 1 << ((bits - 1) % 8);
            if modulus[0] & 0x80 != 0 {
                modulus.insert(0, 0);
            }
            let blob = rsa_blob(&modulus);
            assert_eq!(
                observed_host_key_bits(&blob, HostKeyType::Rsa),
                Some(bits as u32)
            );
            assert_ne!(blob.len() * 8, bits);
        }
        for blob in [
            vec![],
            rsa_blob(&[]),
            rsa_blob(&[0]),
            rsa_blob(&[0x80]),
            vec![0xff; 4],
        ] {
            assert_eq!(observed_host_key_bits(&blob, HostKeyType::Rsa), None);
        }
        let mut blob = rsa_blob(&[1]);
        blob.push(0);
        assert_eq!(observed_host_key_bits(&blob, HostKeyType::Rsa), None);
    }
}
