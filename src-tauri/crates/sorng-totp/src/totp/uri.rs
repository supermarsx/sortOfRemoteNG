//! `otpauth://` URI parsing and generation per the Google Authenticator
//! key-URI format:
//! <https://github.com/google/google-authenticator/wiki/Key-Uri-Format>
//!
//! Format: `otpauth://totp/ISSUER:LABEL?secret=BASE32&issuer=ISSUER&algorithm=SHA1&digits=6&period=30`

use crate::totp::types::*;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Parse
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Parse an `otpauth://` URI into a `TotpEntry`.
pub fn parse_otpauth_uri(uri: &str) -> Result<TotpEntry, TotpError> {
    let url = url::Url::parse(uri).map_err(|e| {
        TotpError::new(TotpErrorKind::InvalidUri, format!("Invalid URI: {}", e))
    })?;

    if url.scheme() != "otpauth" {
        return Err(TotpError::new(
            TotpErrorKind::InvalidUri,
            format!("Expected scheme 'otpauth', got '{}'", url.scheme()),
        ));
    }

    let otp_type = match url.host_str() {
        Some("totp") => OtpType::Totp,
        Some("hotp") => OtpType::Hotp,
        other => {
            return Err(TotpError::new(
                TotpErrorKind::InvalidUri,
                format!("Unknown OTP type: {:?}", other),
            ))
        }
    };

    // Path is "/LABEL" or "/ISSUER:LABEL"
    let path = url.path();
    let path = path.strip_prefix('/').unwrap_or(path);
    let path_decoded = url_decode(path);

    let (path_issuer, label) = if let Some(colon_pos) = path_decoded.find(':') {
        let issuer = path_decoded[..colon_pos].trim().to_string();
        let label = path_decoded[colon_pos + 1..].trim().to_string();
        (Some(issuer), label)
    } else {
        (None, path_decoded.to_string())
    };

    // Query parameters
    let mut secret = None;
    let mut param_issuer = None;
    let mut algorithm = Algorithm::Sha1;
    let mut digits = 6u8;
    let mut period = 30u32;
    let mut counter = 0u64;

    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "secret" => secret = Some(value.to_string()),
            "issuer" => param_issuer = Some(value.to_string()),
            "algorithm" => {
                if let Some(algo) = Algorithm::from_str_loose(&value) {
                    algorithm = algo;
                }
            }
            "digits" => {
                if let Ok(d) = value.parse::<u8>() {
                    if d == 6 || d == 7 || d == 8 {
                        digits = d;
                    }
                }
            }
            "period" => {
                if let Ok(p) = value.parse::<u32>() {
                    if p > 0 {
                        period = p;
                    }
                }
            }
            "counter" => {
                if let Ok(c) = value.parse::<u64>() {
                    counter = c;
                }
            }
            _ => {} // ignore unknown params
        }
    }

    let secret = secret.ok_or_else(|| {
        TotpError::new(TotpErrorKind::InvalidUri, "Missing 'secret' parameter")
    })?;

    // Prefer issuer from query param, then from path prefix
    let issuer = param_issuer.or(path_issuer);

    let mut entry = TotpEntry::new(label, secret)
        .with_algorithm(algorithm)
        .with_digits(digits)
        .with_period(period);
    entry.otp_type = otp_type;

    if let Some(iss) = issuer {
        entry = entry.with_issuer(iss);
    }
    if otp_type == OtpType::Hotp {
        entry.counter = counter;
    }

    Ok(entry)
}

/// Parse multiple URIs (one per line), skipping blanks and comments.
pub fn parse_otpauth_uris(text: &str) -> Vec<Result<TotpEntry, TotpError>> {
    text.lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(parse_otpauth_uri)
        .collect()
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Generate
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Generate an `otpauth://` URI from a `TotpEntry`.
pub fn build_otpauth_uri(entry: &TotpEntry) -> String {
    let otp_type = entry.otp_type.to_string();
    let label = url_encode(&entry.label);

    let path = match &entry.issuer {
        Some(iss) if !iss.is_empty() => format!("{}:{}", url_encode(iss), label),
        _ => label.clone(),
    };

    let secret = entry.normalised_secret();

    let mut params = vec![format!("secret={}", secret)];

    if let Some(ref iss) = entry.issuer {
        params.push(format!("issuer={}", url_encode(iss)));
    }

    if entry.algorithm != Algorithm::Sha1 {
        params.push(format!("algorithm={}", entry.algorithm.uri_name()));
    }

    if entry.digits != 6 {
        params.push(format!("digits={}", entry.digits));
    }

    if entry.otp_type == OtpType::Totp && entry.period != 30 {
        params.push(format!("period={}", entry.period));
    }

    if entry.otp_type == OtpType::Hotp {
        params.push(format!("counter={}", entry.counter));
    }

    format!(
        "otpauth://{}/{}?{}",
        otp_type,
        path,
        params.join("&")
    )
}

/// Generate URIs for multiple entries (one per line).
pub fn build_otpauth_uris(entries: &[TotpEntry]) -> String {
    entries
        .iter()
        .map(build_otpauth_uri)
        .collect::<Vec<_>>()
        .join("\n")
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  URL encoding helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

fn url_encode(s: &str) -> String {
    let mut output = String::with_capacity(s.len());
    for byte in s.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                output.push(byte as char);
            }
            b' ' => output.push_str("%20"),
            b'@' => output.push_str("%40"),
            _ => output.push_str(&format!("%{:02X}", byte)),
        }
    }
    output
}

fn url_decode(s: &str) -> String {
    let mut result = String::new();
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '%' {
            let hex: String = chars.by_ref().take(2).collect();
            if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                result.push(byte as char);
            } else {
                result.push('%');
                result.push_str(&hex);
            }
        } else if c == '+' {
            result.push(' ');
        } else {
            result.push(c);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Parse basic TOTP URI ─────────────────────────────────────

    #[test]
    fn parse_basic_totp() {
        let uri = "otpauth://totp/Example:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Example";
        let entry = parse_otpauth_uri(uri).unwrap();
        assert_eq!(entry.label, "alice@example.com");
        assert_eq!(entry.issuer.as_deref(), Some("Example"));
        assert_eq!(entry.secret, "JBSWY3DPEHPK3PXP");
        assert_eq!(entry.algorithm, Algorithm::Sha1);
        assert_eq!(entry.digits, 6);
        assert_eq!(entry.period, 30);
        assert_eq!(entry.otp_type, OtpType::Totp);
    }

    #[test]
    fn parse_totp_all_params() {
        let uri = "otpauth://totp/GitHub:user?secret=ABC&algorithm=SHA256&digits=8&period=60&issuer=GitHub";
        let entry = parse_otpauth_uri(uri).unwrap();
        assert_eq!(entry.algorithm, Algorithm::Sha256);
        assert_eq!(entry.digits, 8);
        assert_eq!(entry.period, 60);
        assert_eq!(entry.issuer.as_deref(), Some("GitHub"));
    }

    #[test]
    fn parse_hotp_with_counter() {
        let uri = "otpauth://hotp/TestLabel?secret=JBSWY3DPEHPK3PXP&counter=42";
        let entry = parse_otpauth_uri(uri).unwrap();
        assert_eq!(entry.otp_type, OtpType::Hotp);
        assert_eq!(entry.counter, 42);
        assert_eq!(entry.label, "TestLabel");
        assert!(entry.issuer.is_none());
    }

    #[test]
    fn parse_totp_no_issuer() {
        let uri = "otpauth://totp/myaccount?secret=ABCDEFGH";
        let entry = parse_otpauth_uri(uri).unwrap();
        assert_eq!(entry.label, "myaccount");
        assert!(entry.issuer.is_none());
    }

    #[test]
    fn parse_totp_issuer_in_path_only() {
        let uri = "otpauth://totp/Acme:user@ex.com?secret=JBSWY3DPEHPK3PXP";
        let entry = parse_otpauth_uri(uri).unwrap();
        assert_eq!(entry.issuer.as_deref(), Some("Acme"));
        assert_eq!(entry.label, "user@ex.com");
    }

    #[test]
    fn parse_totp_encoded_chars() {
        let uri = "otpauth://totp/My%20Corp:my%20user?secret=JBSWY3DPEHPK3PXP&issuer=My%20Corp";
        let entry = parse_otpauth_uri(uri).unwrap();
        assert_eq!(entry.issuer.as_deref(), Some("My Corp"));
        assert_eq!(entry.label, "my user");
    }

    // ── Parse errors ─────────────────────────────────────────────

    #[test]
    fn parse_invalid_scheme() {
        let result = parse_otpauth_uri("https://example.com");
        assert!(result.is_err());
    }

    #[test]
    fn parse_missing_secret() {
        let result = parse_otpauth_uri("otpauth://totp/Test?issuer=X");
        assert!(result.is_err());
    }

    #[test]
    fn parse_invalid_otp_type() {
        let result = parse_otpauth_uri("otpauth://unknown/Test?secret=ABC");
        assert!(result.is_err());
    }

    #[test]
    fn parse_not_a_url() {
        let result = parse_otpauth_uri("not a url at all");
        assert!(result.is_err());
    }

    // ── Generate URI ─────────────────────────────────────────────

    #[test]
    fn build_basic_totp_uri() {
        let entry = TotpEntry::new("alice@example.com", "JBSWY3DPEHPK3PXP")
            .with_issuer("Example");
        let uri = build_otpauth_uri(&entry);
        assert!(uri.starts_with("otpauth://totp/"));
        assert!(uri.contains("secret=JBSWY3DPEHPK3PXP"));
        assert!(uri.contains("issuer=Example"));
    }

    #[test]
    fn build_uri_non_default_params() {
        let entry = TotpEntry::new("user", "ABCDEF")
            .with_issuer("Acme")
            .with_algorithm(Algorithm::Sha512)
            .with_digits(8)
            .with_period(60);
        let uri = build_otpauth_uri(&entry);
        assert!(uri.contains("algorithm=SHA512"));
        assert!(uri.contains("digits=8"));
        assert!(uri.contains("period=60"));
    }

    #[test]
    fn build_hotp_uri() {
        let entry = TotpEntry::new("user", "ABCDEF").as_hotp(99);
        let uri = build_otpauth_uri(&entry);
        assert!(uri.starts_with("otpauth://hotp/"));
        assert!(uri.contains("counter=99"));
    }

    #[test]
    fn build_uri_omits_defaults() {
        let entry = TotpEntry::new("user", "ABCDEF");
        let uri = build_otpauth_uri(&entry);
        // SHA1, 6 digits, 30s period are defaults—should not appear
        assert!(!uri.contains("algorithm="));
        assert!(!uri.contains("digits="));
        assert!(!uri.contains("period="));
    }

    // ── Roundtrip ────────────────────────────────────────────────

    #[test]
    fn parse_build_roundtrip() {
        let original =
            "otpauth://totp/GitHub:user%40mail.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&algorithm=SHA256&digits=8&period=60";
        let entry = parse_otpauth_uri(original).unwrap();
        let rebuilt = build_otpauth_uri(&entry);
        let re_parsed = parse_otpauth_uri(&rebuilt).unwrap();
        assert_eq!(re_parsed.label, entry.label);
        assert_eq!(re_parsed.issuer, entry.issuer);
        assert_eq!(re_parsed.algorithm, entry.algorithm);
        assert_eq!(re_parsed.digits, entry.digits);
        assert_eq!(re_parsed.period, entry.period);
        assert_eq!(re_parsed.normalised_secret(), entry.normalised_secret());
    }

    // ── Multi-line parse ─────────────────────────────────────────

    #[test]
    fn parse_uris_multi_line() {
        let text = "\
otpauth://totp/A:a?secret=AAAA
# comment
otpauth://totp/B:b?secret=BBBB

otpauth://hotp/C:c?secret=CCCC&counter=1
";
        let results = parse_otpauth_uris(text);
        assert_eq!(results.len(), 3);
        assert!(results[0].is_ok());
        assert!(results[1].is_ok());
        assert!(results[2].is_ok());
    }

    // ── Multi URI generation ─────────────────────────────────────

    #[test]
    fn build_uris_multiple() {
        let entries = vec![
            TotpEntry::new("a", "AAAA"),
            TotpEntry::new("b", "BBBB"),
        ];
        let output = build_otpauth_uris(&entries);
        let lines: Vec<&str> = output.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].starts_with("otpauth://"));
        assert!(lines[1].starts_with("otpauth://"));
    }

    // ── URL encoding helpers ─────────────────────────────────────

    #[test]
    fn url_encode_basic() {
        assert_eq!(url_encode("hello"), "hello");
        assert_eq!(url_encode("hello world"), "hello%20world");
        assert_eq!(url_encode("a@b"), "a%40b");
    }

    #[test]
    fn url_decode_basic() {
        assert_eq!(url_decode("hello%20world"), "hello world");
        assert_eq!(url_decode("a%40b"), "a@b");
        assert_eq!(url_decode("no+plus"), "no plus");
    }
}
