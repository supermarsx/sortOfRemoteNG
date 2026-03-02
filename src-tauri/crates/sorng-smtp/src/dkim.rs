//! DKIM (DomainKeys Identified Mail) signing — RSA-SHA256.
//!
//! Signs email messages according to RFC 6376 so receiving servers can
//! verify message integrity and authenticate the sending domain.

use base64::Engine;
use chrono::Utc;
use log::debug;
use sha2::{Digest, Sha256};

use crate::types::*;

/// Sign a raw email message with DKIM.
/// Returns the DKIM-Signature header to prepend to the message.
pub fn sign_message(raw_message: &str, config: &DkimConfig) -> SmtpResult<String> {
    if config.private_key_pem.is_empty() {
        return Err(SmtpError::new(
            SmtpErrorKind::DkimError,
            "DKIM private key is empty",
        ));
    }
    if config.domain.is_empty() {
        return Err(SmtpError::new(
            SmtpErrorKind::DkimError,
            "DKIM domain is empty",
        ));
    }
    if config.selector.is_empty() {
        return Err(SmtpError::new(
            SmtpErrorKind::DkimError,
            "DKIM selector is empty",
        ));
    }

    // Split headers and body
    let (headers_raw, body_raw) = split_header_body(raw_message);

    // Canonicalize body
    let canon_body = canonicalize_body(&body_raw, config.body_canon);

    // Hash the canonicalized body
    let body_hash = {
        let mut hasher = Sha256::new();
        hasher.update(canon_body.as_bytes());
        base64::engine::general_purpose::STANDARD.encode(hasher.finalize())
    };
    debug!("DKIM body hash (bh): {}", body_hash);

    // Build the DKIM-Signature header (without the b= value)
    let timestamp = Utc::now().timestamp();
    let mut dkim_header = format!(
        "DKIM-Signature: v=1; a=rsa-sha256; c={}/{}; d={}; s={};\r\n\tt={}; bh={};\r\n\th={};\r\n\tb=",
        config.header_canon,
        config.body_canon,
        config.domain,
        config.selector,
        timestamp,
        body_hash,
        config.signed_headers.join(":"),
    );

    if config.expire_secs > 0 {
        let expire = timestamp + config.expire_secs as i64;
        dkim_header = format!(
            "DKIM-Signature: v=1; a=rsa-sha256; c={}/{}; d={}; s={};\r\n\tt={}; x={}; bh={};\r\n\th={};\r\n\tb=",
            config.header_canon,
            config.body_canon,
            config.domain,
            config.selector,
            timestamp,
            expire,
            body_hash,
            config.signed_headers.join(":"),
        );
    }

    // Canonicalize the signed headers
    let parsed_headers = parse_headers(&headers_raw);
    let canon_headers = canonicalize_signed_headers(
        &parsed_headers,
        &config.signed_headers,
        config.header_canon,
    );

    // Canonicalize the DKIM-Signature header itself (with empty b=)
    let canon_dkim = canonicalize_header(&dkim_header, config.header_canon);

    // Data to sign = canonicalized signed headers + canonicalized DKIM-Signature header
    let sign_input = format!("{}{}", canon_headers, canon_dkim);

    // RSA-SHA256 sign
    let signature = rsa_sha256_sign(&sign_input, &config.private_key_pem)?;

    // Append the signature to the DKIM header
    let sig_b64 = base64::engine::general_purpose::STANDARD.encode(&signature);
    // Fold the signature at 76 chars
    let folded_sig = fold_base64(&sig_b64, 76);
    dkim_header.push_str(&folded_sig);

    Ok(dkim_header)
}

/// Verify that a DKIM configuration is valid (key can parse, fields are set).
pub fn validate_config(config: &DkimConfig) -> SmtpResult<()> {
    if config.private_key_pem.is_empty() {
        return Err(SmtpError::new(SmtpErrorKind::DkimError, "Private key is empty"));
    }
    if config.domain.is_empty() {
        return Err(SmtpError::new(SmtpErrorKind::DkimError, "Domain is empty"));
    }
    if config.selector.is_empty() {
        return Err(SmtpError::new(SmtpErrorKind::DkimError, "Selector is empty"));
    }
    if config.signed_headers.is_empty() {
        return Err(SmtpError::new(
            SmtpErrorKind::DkimError,
            "No headers to sign",
        ));
    }

    // Try to parse the private key
    parse_rsa_private_key(&config.private_key_pem)?;
    Ok(())
}

/// Generate the DKIM DNS TXT record value from the public key.
pub fn generate_dns_record(selector: &str, domain: &str, public_key_pem: &str) -> String {
    // Extract the base64 data from PEM
    let b64: String = public_key_pem
        .lines()
        .filter(|l| !l.starts_with("-----"))
        .collect::<Vec<_>>()
        .join("");

    format!(
        "{}._domainkey.{} IN TXT \"v=DKIM1; k=rsa; p={}\"",
        selector, domain, b64
    )
}

// ── Canonicalization ────────────────────────────────────────────────

/// Split raw message into (headers, body).
fn split_header_body(raw: &str) -> (String, String) {
    if let Some(pos) = raw.find("\r\n\r\n") {
        (raw[..pos + 2].to_string(), raw[pos + 4..].to_string())
    } else if let Some(pos) = raw.find("\n\n") {
        (raw[..pos + 1].to_string(), raw[pos + 2..].to_string())
    } else {
        (raw.to_string(), String::new())
    }
}

/// Canonicalize headers according to the specified method.
fn canonicalize_header(header: &str, method: DkimCanonicalization) -> String {
    match method {
        DkimCanonicalization::Simple => {
            // Simple: no changes
            header.to_string()
        }
        DkimCanonicalization::Relaxed => {
            // Relaxed: lowercase name, unfold, collapse whitespace
            if let Some(colon) = header.find(':') {
                let name = header[..colon].trim().to_lowercase();
                let value = header[colon + 1..]
                    .replace("\r\n", "")
                    .replace('\n', "");
                let value = collapse_whitespace(value.trim());
                format!("{}:{}", name, value)
            } else {
                header.to_string()
            }
        }
    }
}

/// Canonicalize the body.
fn canonicalize_body(body: &str, method: DkimCanonicalization) -> String {
    match method {
        DkimCanonicalization::Simple => {
            // Remove trailing empty lines
            let mut result = body.to_string();
            while result.ends_with("\r\n\r\n") {
                result.truncate(result.len() - 2);
            }
            if !result.ends_with("\r\n") {
                result.push_str("\r\n");
            }
            result
        }
        DkimCanonicalization::Relaxed => {
            // Remove trailing whitespace from lines, collapse WSP, remove trailing empty lines
            let mut lines: Vec<String> = body
                .split('\n')
                .map(|l| {
                    let l = l.trim_end_matches('\r').trim_end();
                    collapse_whitespace(l)
                })
                .collect();

            // Remove trailing empty lines
            while lines.last().map(|l| l.is_empty()).unwrap_or(false) {
                lines.pop();
            }

            let mut result = lines.join("\r\n");
            if !result.is_empty() {
                result.push_str("\r\n");
            }
            result
        }
    }
}

/// Parse raw headers into (name, full_line) pairs.
fn parse_headers(headers_raw: &str) -> Vec<(String, String)> {
    let mut result = Vec::new();
    let mut current_name = String::new();
    let mut current_line = String::new();

    for line in headers_raw.lines() {
        if line.starts_with(' ') || line.starts_with('\t') {
            // Continuation
            current_line.push_str("\r\n");
            current_line.push_str(line);
        } else {
            if !current_name.is_empty() {
                result.push((current_name.clone(), current_line.clone()));
            }
            if let Some(colon) = line.find(':') {
                current_name = line[..colon].trim().to_lowercase();
                current_line = line.to_string();
            } else {
                current_name.clear();
                current_line.clear();
            }
        }
    }
    if !current_name.is_empty() {
        result.push((current_name, current_line));
    }
    result
}

/// Canonicalize the signed headers.
fn canonicalize_signed_headers(
    headers: &[(String, String)],
    signed: &[String],
    method: DkimCanonicalization,
) -> String {
    let mut result = String::new();
    for name in signed {
        let lower_name = name.to_lowercase();
        if let Some((_, full_line)) = headers.iter().rev().find(|(n, _)| n == &lower_name) {
            let canon = canonicalize_header(full_line, method);
            result.push_str(&canon);
            result.push_str("\r\n");
        }
    }
    result
}

/// Collapse runs of whitespace to a single space.
fn collapse_whitespace(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let mut in_ws = false;
    for ch in s.chars() {
        if ch == ' ' || ch == '\t' {
            if !in_ws {
                result.push(' ');
                in_ws = true;
            }
        } else {
            result.push(ch);
            in_ws = false;
        }
    }
    result
}

/// Fold base64 into lines of max_len.
fn fold_base64(b64: &str, max_len: usize) -> String {
    b64.as_bytes()
        .chunks(max_len)
        .map(|c| std::str::from_utf8(c).unwrap_or(""))
        .collect::<Vec<_>>()
        .join("\r\n\t")
}

// ── RSA-SHA256 ──────────────────────────────────────────────────────

/// Parse an RSA private key from PEM.
fn parse_rsa_private_key(pem: &str) -> SmtpResult<rsa::RsaPrivateKey> {
    use rsa::pkcs8::DecodePrivateKey;
    rsa::RsaPrivateKey::from_pkcs8_pem(pem).or_else(|_| {
        use rsa::pkcs1::DecodeRsaPrivateKey;
        rsa::RsaPrivateKey::from_pkcs1_pem(pem).map_err(|e| {
            SmtpError::new(
                SmtpErrorKind::DkimError,
                format!("Failed to parse RSA private key: {}", e),
            )
        })
    })
}

/// RSA-SHA256 signature.
fn rsa_sha256_sign(data: &str, pem: &str) -> SmtpResult<Vec<u8>> {
    use rsa::pkcs1v15::SigningKey;
    use rsa::signature::{SignatureEncoding, Signer};

    let private_key = parse_rsa_private_key(pem)?;
    let signing_key = SigningKey::<Sha256>::new(private_key);
    let signature = signing_key.sign(data.as_bytes());

    Ok(signature.to_vec())
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_header_body_crlf() {
        let raw = "From: a@b.com\r\nTo: c@d.com\r\n\r\nBody here";
        let (h, b) = split_header_body(raw);
        assert!(h.contains("From:"));
        assert_eq!(b, "Body here");
    }

    #[test]
    fn split_header_body_lf() {
        let raw = "From: a@b.com\nTo: c@d.com\n\nBody";
        let (h, b) = split_header_body(raw);
        assert!(h.contains("From:"));
        assert_eq!(b, "Body");
    }

    #[test]
    fn canonicalize_body_simple() {
        let body = "Hello\r\n\r\n\r\n";
        let canon = canonicalize_body(body, DkimCanonicalization::Simple);
        assert_eq!(canon, "Hello\r\n");
    }

    #[test]
    fn canonicalize_body_relaxed() {
        let body = "Hello   World  \r\n\r\n\r\n";
        let canon = canonicalize_body(body, DkimCanonicalization::Relaxed);
        assert_eq!(canon, "Hello World\r\n");
    }

    #[test]
    fn canonicalize_header_simple() {
        let h = "Subject: Hello World";
        let canon = canonicalize_header(h, DkimCanonicalization::Simple);
        assert_eq!(canon, h);
    }

    #[test]
    fn canonicalize_header_relaxed() {
        let h = "Subject:   Hello   World  ";
        let canon = canonicalize_header(h, DkimCanonicalization::Relaxed);
        assert_eq!(canon, "subject:Hello World");
    }

    #[test]
    fn collapse_whitespace_works() {
        assert_eq!(collapse_whitespace("a  b\t\tc"), "a b c");
        assert_eq!(collapse_whitespace("  leading"), " leading");
        assert_eq!(collapse_whitespace("normal"), "normal");
    }

    #[test]
    fn fold_base64_works() {
        let input = "A".repeat(200);
        let folded = fold_base64(&input, 76);
        let lines: Vec<&str> = folded.split("\r\n\t").collect();
        assert!(lines.len() >= 3);
        assert!(lines[0].len() <= 76);
    }

    #[test]
    fn generate_dns_record_format() {
        let rec = generate_dns_record("s1", "example.com", "-----BEGIN PUBLIC KEY-----\nMIIB\nIjAN\n-----END PUBLIC KEY-----");
        assert!(rec.contains("s1._domainkey.example.com"));
        assert!(rec.contains("v=DKIM1"));
        assert!(rec.contains("p=MIIBIjAN"));
    }

    #[test]
    fn parse_headers_simple() {
        let raw = "From: a@b.com\r\nTo: c@d.com\r\nSubject: Test\r\n";
        let headers = parse_headers(raw);
        assert_eq!(headers.len(), 3);
        assert_eq!(headers[0].0, "from");
        assert_eq!(headers[1].0, "to");
        assert_eq!(headers[2].0, "subject");
    }

    #[test]
    fn parse_headers_with_continuation() {
        let raw = "Subject: Very Long\r\n Subject Line\r\nFrom: a@b.com\r\n";
        let headers = parse_headers(raw);
        assert_eq!(headers.len(), 2);
        assert!(headers[0].1.contains("Very Long"));
        assert!(headers[0].1.contains("Subject Line"));
    }

    #[test]
    fn validate_config_empty_key() {
        let config = DkimConfig::default();
        assert!(validate_config(&config).is_err());
    }

    #[test]
    fn validate_config_empty_domain() {
        let mut config = DkimConfig::default();
        config.private_key_pem = "-----BEGIN PRIVATE KEY-----\nfoo\n-----END PRIVATE KEY-----".into();
        assert!(validate_config(&config).is_err());
    }

    #[test]
    fn sign_message_empty_key_fails() {
        let config = DkimConfig::default();
        let result = sign_message("From: a@b.com\r\n\r\nBody", &config);
        assert!(result.is_err());
    }
}
