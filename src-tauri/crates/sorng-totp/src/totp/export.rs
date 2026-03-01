//! Export TOTP entries in various formats.
//!
//! Supported formats:
//! - JSON (pretty-printed, our native schema)
//! - CSV with header row
//! - otpauth:// URIs (one per line)
//! - Encrypted JSON (AES-256-GCM, PBKDF2 key derivation)
//! - HTML page with embedded QR codes

use crate::totp::types::*;
use crate::totp::uri;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Public API
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Export entries in the requested format.
pub fn export(
    entries: &[TotpEntry],
    format: ExportFormat,
    password: Option<&str>,
) -> Result<String, TotpError> {
    match format {
        ExportFormat::Json => export_json(entries),
        ExportFormat::Csv => export_csv(entries),
        ExportFormat::OtpAuthUris => Ok(export_otpauth_uris(entries)),
        ExportFormat::EncryptedJson => {
            let pw = password.ok_or_else(|| {
                TotpError::new(
                    TotpErrorKind::InvalidInput,
                    "Password required for encrypted export",
                )
            })?;
            export_encrypted_json(entries, pw)
        }
        ExportFormat::HtmlQrCodes => export_html_qr(entries),
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  JSON
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

fn export_json(entries: &[TotpEntry]) -> Result<String, TotpError> {
    serde_json::to_string_pretty(entries).map_err(|e| {
        TotpError::new(
            TotpErrorKind::ExportFailed,
            format!("JSON serialise error: {}", e),
        )
    })
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  CSV
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

fn export_csv(entries: &[TotpEntry]) -> Result<String, TotpError> {
    let mut out = String::new();
    out.push_str("name,secret,issuer,algorithm,digits,period,type,counter,notes,tags\n");

    for entry in entries {
        let name = csv_escape(&entry.label);
        let secret = csv_escape(&entry.normalised_secret());
        let issuer = csv_escape(entry.issuer.as_deref().unwrap_or(""));
        let algo = entry.algorithm.uri_name();
        let otp_type = entry.otp_type.to_string();
        let notes = csv_escape(entry.notes.as_deref().unwrap_or(""));
        let tags = csv_escape(&entry.tags.join(";"));

        out.push_str(&format!(
            "{},{},{},{},{},{},{},{},{},{}\n",
            name, secret, issuer, algo, entry.digits, entry.period, otp_type, entry.counter,
            notes, tags
        ));
    }

    Ok(out)
}

fn csv_escape(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  otpauth URIs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

fn export_otpauth_uris(entries: &[TotpEntry]) -> String {
    uri::build_otpauth_uris(entries)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Encrypted JSON
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

fn export_encrypted_json(entries: &[TotpEntry], password: &str) -> Result<String, TotpError> {
    let json = export_json(entries)?;
    crate::totp::crypto::encrypt_vault(&json, password)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  HTML with QR codes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

fn export_html_qr(entries: &[TotpEntry]) -> Result<String, TotpError> {
    let mut html = String::new();
    html.push_str("<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n");
    html.push_str("  <meta charset=\"utf-8\">\n");
    html.push_str("  <title>TOTP Export</title>\n");
    html.push_str("  <style>\n");
    html.push_str("    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; background: #fafafa; }\n");
    html.push_str("    h1 { color: #333; }\n");
    html.push_str("    .entry { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 1rem; margin: 1rem 0; display: flex; align-items: center; gap: 1.5rem; }\n");
    html.push_str("    .entry img { width: 200px; height: 200px; }\n");
    html.push_str("    .entry .info { flex: 1; }\n");
    html.push_str("    .entry .info h2 { margin: 0 0 0.5rem; }\n");
    html.push_str("    .entry .info p { margin: 0.25rem 0; color: #666; }\n");
    html.push_str("    .entry .info code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }\n");
    html.push_str("    @media print { .no-print { display: none; } }\n");
    html.push_str("  </style>\n");
    html.push_str("</head>\n<body>\n");
    html.push_str("  <h1>TOTP Export</h1>\n");
    html.push_str(&format!(
        "  <p class=\"no-print\">Generated {} entries on {}. Print this page and store securely.</p>\n",
        entries.len(),
        chrono::Utc::now().format("%Y-%m-%d %H:%M UTC")
    ));

    for entry in entries {
        let display = entry.display_name();
        let uri_str = uri::build_otpauth_uri(entry);
        let qr_data_uri = crate::totp::qr::entry_to_qr_data_uri(entry)
            .unwrap_or_else(|_| String::from("data:image/png;base64,"));
        let algo = entry.algorithm.uri_name();
        let secret_masked = mask_secret(&entry.normalised_secret());

        html.push_str("  <div class=\"entry\">\n");
        html.push_str(&format!(
            "    <img src=\"{}\" alt=\"QR for {}\">\n",
            qr_data_uri,
            html_escape(&display)
        ));
        html.push_str("    <div class=\"info\">\n");
        html.push_str(&format!("      <h2>{}</h2>\n", html_escape(&display)));
        if let Some(ref iss) = entry.issuer {
            html.push_str(&format!(
                "      <p>Issuer: <strong>{}</strong></p>\n",
                html_escape(iss)
            ));
        }
        html.push_str(&format!(
            "      <p>Algorithm: {} &middot; Digits: {} &middot; Period: {}s</p>\n",
            algo, entry.digits, entry.period
        ));
        html.push_str(&format!(
            "      <p>Secret: <code>{}</code></p>\n",
            html_escape(&secret_masked)
        ));
        html.push_str(&format!(
            "      <p style=\"font-size:0.75em;word-break:break-all;\"><code>{}</code></p>\n",
            html_escape(&uri_str)
        ));
        html.push_str("    </div>\n");
        html.push_str("  </div>\n");
    }

    html.push_str("</body>\n</html>\n");
    Ok(html)
}

fn mask_secret(secret: &str) -> String {
    if secret.len() <= 4 {
        return "****".to_string();
    }
    let visible = 4;
    let start = &secret[..visible];
    let masked = "*".repeat(secret.len() - visible);
    format!("{}{}", start, masked)
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_entries() -> Vec<TotpEntry> {
        vec![
            TotpEntry::new("alice@example.com", "JBSWY3DPEHPK3PXP")
                .with_issuer("GitHub")
                .with_algorithm(Algorithm::Sha1),
            TotpEntry::new("bob@work.com", "ABCDEFGHIJKLMNOP")
                .with_issuer("AWS")
                .with_algorithm(Algorithm::Sha256)
                .with_digits(8)
                .with_period(60),
        ]
    }

    // ── JSON export ──────────────────────────────────────────────

    #[test]
    fn export_json_valid() {
        let entries = sample_entries();
        let json = export_json(&entries).unwrap();
        let parsed: Vec<TotpEntry> = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].label, "alice@example.com");
    }

    #[test]
    fn export_json_roundtrip() {
        let entries = sample_entries();
        let json = export_json(&entries).unwrap();
        let parsed: Vec<TotpEntry> = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed[0].issuer.as_deref(), Some("GitHub"));
        assert_eq!(parsed[1].digits, 8);
    }

    // ── CSV export ───────────────────────────────────────────────

    #[test]
    fn export_csv_has_header() {
        let entries = sample_entries();
        let csv = export_csv(&entries).unwrap();
        assert!(csv.starts_with("name,secret,issuer,algorithm,digits,period,type,counter,notes,tags\n"));
    }

    #[test]
    fn export_csv_row_count() {
        let entries = sample_entries();
        let csv = export_csv(&entries).unwrap();
        let lines: Vec<&str> = csv.lines().collect();
        // header + 2 data rows
        assert_eq!(lines.len(), 3);
    }

    #[test]
    fn export_csv_escapes_commas() {
        let mut entry = TotpEntry::new("hello, world", "ABCDEF");
        entry = entry.with_issuer("Acme, Inc.");
        let csv = export_csv(&[entry]).unwrap();
        assert!(csv.contains("\"hello, world\""));
        assert!(csv.contains("\"Acme, Inc.\""));
    }

    // ── otpauth URIs ─────────────────────────────────────────────

    #[test]
    fn export_uris_line_count() {
        let entries = sample_entries();
        let uris = export_otpauth_uris(&entries);
        assert_eq!(uris.lines().count(), 2);
        assert!(uris.lines().all(|l| l.starts_with("otpauth://")));
    }

    // ── HTML export ──────────────────────────────────────────────

    #[test]
    fn export_html_contains_entries() {
        let entries = sample_entries();
        let html = export_html_qr(&entries).unwrap();
        assert!(html.contains("<!DOCTYPE html>"));
        assert!(html.contains("alice@example.com"));
        assert!(html.contains("bob@work.com"));
        assert!(html.contains("data:image/png;base64,"));
    }

    #[test]
    fn export_html_escapes_special_chars() {
        let entry = TotpEntry::new("<script>alert(1)</script>", "ABCDEF");
        let html = export_html_qr(&[entry]).unwrap();
        assert!(html.contains("&lt;script&gt;"));
        assert!(!html.contains("<script>alert"));
    }

    // ── Secret masking ───────────────────────────────────────────

    #[test]
    fn mask_secret_long() {
        assert_eq!(mask_secret("JBSWY3DPEHPK3PXP"), "JBSW************");
    }

    #[test]
    fn mask_secret_short() {
        assert_eq!(mask_secret("AB"), "****");
    }

    // ── CSV escape ───────────────────────────────────────────────

    #[test]
    fn csv_escape_plain() {
        assert_eq!(csv_escape("hello"), "hello");
    }

    #[test]
    fn csv_escape_comma() {
        assert_eq!(csv_escape("a,b"), "\"a,b\"");
    }

    #[test]
    fn csv_escape_quote() {
        assert_eq!(csv_escape("a\"b"), "\"a\"\"b\"");
    }

    // ── Export dispatcher ────────────────────────────────────────

    #[test]
    fn export_dispatches_json() {
        let entries = sample_entries();
        let result = export(&entries, ExportFormat::Json, None).unwrap();
        assert!(result.contains("\"label\""));
    }

    #[test]
    fn export_dispatches_csv() {
        let entries = sample_entries();
        let result = export(&entries, ExportFormat::Csv, None).unwrap();
        assert!(result.starts_with("name,secret,"));
    }

    #[test]
    fn export_dispatches_uris() {
        let entries = sample_entries();
        let result = export(&entries, ExportFormat::OtpAuthUris, None).unwrap();
        assert!(result.starts_with("otpauth://"));
    }

    #[test]
    fn export_encrypted_requires_password() {
        let entries = sample_entries();
        let result = export(&entries, ExportFormat::EncryptedJson, None);
        assert!(result.is_err());
    }
}
