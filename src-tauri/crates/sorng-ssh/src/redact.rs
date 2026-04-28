use lazy_static::lazy_static;
use regex::{Captures, Regex};

lazy_static! {
    static ref PRIVATE_KEY_BLOCK_RE: Regex = Regex::new(
        r"-----BEGIN (?:OPENSSH|RSA|EC) PRIVATE KEY-----[\s\S]*?-----END (?:OPENSSH|RSA|EC) PRIVATE KEY-----",
    )
    .expect("valid private key block regex");
    static ref KEY_VALUE_RE: Regex = Regex::new(
        r#"\b([A-Za-z0-9_-]*(?:password|passphrase|secret|api[_-]?key|token)[A-Za-z0-9_-]*)\b(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)"#,
    )
    .expect("valid key-value secret regex");
    static ref FLAG_PASSWORD_RE: Regex =
        Regex::new(r"(?i)(^|\s)-p(\S+)").expect("valid -p flag regex");
    static ref AWS_TOKEN_RE: Regex =
        Regex::new(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b").expect("valid AWS token regex");
    static ref GCP_TOKEN_RE: Regex =
        Regex::new(r"\bya29\.[0-9A-Za-z\-_]+\b").expect("valid GCP token regex");
}

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

#[cfg(test)]
mod tests {
    use super::redact_secrets;

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
        assert!(redacted.contains("password: [redacted]"));
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
}
