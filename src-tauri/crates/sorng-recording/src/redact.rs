// sorng-recording – credential redaction for recorded session streams
//
// Session recordings (terminal input/output in particular) can capture typed
// passwords and other secrets verbatim. Recordings are persisted to disk and,
// when encryption-at-rest is locked or not configured, fall back to plaintext
// JSON. To guarantee that secrets never land in a plaintext recording — and to
// keep encrypted recordings free of credentials too — every recorded chunk is
// passed through `redact_stream` before it is stored in the live buffer.
//
// The pattern set mirrors the `sorng-ssh` `redact.rs` approach (private-key
// blocks, key=value secret pairs, `-p<secret>` flags, AWS/GCP tokens). It is
// intentionally replicated here rather than taking a dependency on the heavy
// `sorng-ssh` crate (ssh2/russh/etc.) for a handful of regexes. In addition we
// add terminal-stream-specific handling for interactive password *prompts*
// (e.g. `Password:`, `sudo password for user:`) where the secret follows the
// prompt on the same line.

use lazy_static::lazy_static;
use regex::{Captures, Regex};

lazy_static! {
    static ref PRIVATE_KEY_BLOCK_RE: Regex = Regex::new(
        r"-----BEGIN (?:OPENSSH|RSA|EC|DSA|PGP|ENCRYPTED) PRIVATE KEY-----[\s\S]*?-----END (?:OPENSSH|RSA|EC|DSA|PGP|ENCRYPTED) PRIVATE KEY-----",
    )
    .expect("valid private key block regex");
    static ref KEY_VALUE_RE: Regex = Regex::new(
        r#"(?i)\b([A-Za-z0-9_-]*(?:password|passwd|passphrase|secret|api[_-]?key|token)[A-Za-z0-9_-]*)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)"#,
    )
    .expect("valid key-value secret regex");
    static ref FLAG_PASSWORD_RE: Regex =
        Regex::new(r"(?i)(^|\s)-p(\S+)").expect("valid -p flag regex");
    static ref AWS_TOKEN_RE: Regex =
        Regex::new(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b").expect("valid AWS token regex");
    static ref GCP_TOKEN_RE: Regex =
        Regex::new(r"\bya29\.[0-9A-Za-z\-_]+\b").expect("valid GCP token regex");
    // Interactive password prompt followed by the secret on the same line, e.g.
    //   "Password: hunter2"
    //   "[sudo] password for alice: hunter2"
    //   "Enter passphrase for key '/home/x/id_rsa': hunter2"
    // The secret (anything after the colon up to end-of-line) is redacted.
    static ref PROMPT_SECRET_RE: Regex = Regex::new(
        r"(?im)((?:enter\s+)?(?:\[sudo\]\s+)?(?:password|passphrase)(?:\s+for\b[^\r\n:]*)?\s*:\s*)([^\r\n]+)",
    )
    .expect("valid password prompt regex");
}

/// Generic secret redaction shared by all recording streams.
///
/// `needles` are exact substrings (e.g. a known connection password) that must
/// be scrubbed regardless of surrounding context. Empty needles are ignored.
pub fn redact_secrets(msg: &str, needles: &[&str]) -> String {
    if msg.is_empty() {
        return String::new();
    }

    let mut redacted = PRIVATE_KEY_BLOCK_RE
        .replace_all(msg, "[redacted private key]")
        .into_owned();

    redacted = KEY_VALUE_RE
        .replace_all(&redacted, |caps: &Captures| {
            format!("{}{}[redacted]", &caps[1], &caps[2])
        })
        .into_owned();

    redacted = FLAG_PASSWORD_RE
        .replace_all(&redacted, |caps: &Captures| {
            format!("{}-p[redacted]", &caps[1])
        })
        .into_owned();

    redacted = AWS_TOKEN_RE
        .replace_all(&redacted, "[redacted]")
        .into_owned();
    redacted = GCP_TOKEN_RE
        .replace_all(&redacted, "[redacted]")
        .into_owned();

    for needle in needles.iter().copied().filter(|needle| !needle.is_empty()) {
        redacted = redacted.replace(needle, "[redacted]");
    }

    redacted
}

/// Redaction tuned for interactive terminal streams.
///
/// On top of the shared `redact_secrets` patterns this also scrubs the value
/// that follows an interactive password / passphrase prompt on the same line.
/// Applied to every recorded terminal input/output chunk before it is buffered,
/// so a plaintext recording never contains a typed/echoed secret.
pub fn redact_stream(data: &str) -> String {
    if data.is_empty() {
        return String::new();
    }

    let secrets_scrubbed = redact_secrets(data, &[]);

    PROMPT_SECRET_RE
        .replace_all(&secrets_scrubbed, |caps: &Captures| {
            format!("{}[redacted]", &caps[1])
        })
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::{redact_secrets, redact_stream};

    #[test]
    fn redacts_key_value_pairs_and_needles() {
        let redacted = redact_secrets(
            "proxyCommandPassword=super-secret password: hunter2 token=ya29.abc123",
            &["super-secret"],
        );

        assert!(!redacted.contains("hunter2"));
        assert!(!redacted.contains("super-secret"));
        assert!(!redacted.contains("ya29.abc123"));
        assert!(redacted.contains("proxyCommandPassword=[redacted]"));
    }

    #[test]
    fn redacts_private_key_blocks_and_flag_passwords() {
        let message = "ssh -psecret\n-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----";
        let redacted = redact_secrets(message, &[]);

        assert!(!redacted.contains("-psecret"));
        assert!(!redacted.contains("BEGIN OPENSSH PRIVATE KEY"));
        assert!(redacted.contains("-p[redacted]"));
        assert!(redacted.contains("[redacted private key]"));
    }

    #[test]
    fn redacts_interactive_password_prompt() {
        let redacted = redact_stream("Password: hunter2\r\n");
        assert!(!redacted.contains("hunter2"));
        assert!(redacted.contains("Password: [redacted]"));
    }

    #[test]
    fn redacts_sudo_prompt() {
        let redacted = redact_stream("[sudo] password for alice: TopS3cret!\n");
        assert!(!redacted.contains("TopS3cret!"));
        assert!(redacted.contains("[redacted]"));
    }

    #[test]
    fn redacts_passphrase_prompt() {
        let redacted =
            redact_stream("Enter passphrase for key '/home/x/id_rsa': myphrase123\n");
        assert!(!redacted.contains("myphrase123"));
        assert!(redacted.contains("[redacted]"));
    }

    #[test]
    fn leaves_ordinary_output_untouched() {
        let line = "total 24\r\ndrwxr-xr-x  2 alice users 4096 Jun 11 file.txt\r\n";
        assert_eq!(redact_stream(line), line);
    }
}
