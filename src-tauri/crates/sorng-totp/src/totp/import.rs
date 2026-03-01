//! Multi-format import for TOTP/HOTP entries.
//!
//! Supported formats:
//! - `otpauth://` URIs (single or multi-line)
//! - Google Authenticator migration payloads (`otpauth-migration://offline?data=…`)
//! - Aegis JSON (plain & encrypted header only)
//! - 2FAS JSON
//! - andOTP JSON
//! - FreeOTP+ JSON / token list
//! - Bitwarden JSON (TOTP field)
//! - RAIVO JSON
//! - Authy JSON (partial—tokens only, no encrypted backup)
//! - Generic CSV with header row

use serde_json::Value;
use std::collections::HashMap;

use crate::totp::types::*;
use crate::totp::uri;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Auto-detect + import
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Auto-detect the format and import entries.
pub fn auto_import(data: &str) -> ImportResult {
    if let Some(fmt) = detect_format(data) {
        import_as(data, fmt)
    } else {
        ImportResult {
            format: ImportFormat::GenericCsv,
            total_found: 0,
            imported: 0,
            skipped_duplicate: 0,
            errors: vec!["Could not auto-detect import format".into()],
            entries: vec![],
        }
    }
}

/// Detect the most likely format of the input data.
pub fn detect_format(data: &str) -> Option<ImportFormat> {
    let trimmed = data.trim();

    // otpauth-migration:// first (before otpauth://)
    if trimmed.starts_with("otpauth-migration://") {
        return Some(ImportFormat::GoogleAuthMigration);
    }

    // Single or multi-line otpauth:// URIs
    if trimmed.starts_with("otpauth://") {
        return Some(ImportFormat::OtpAuthUri);
    }

    // Try JSON
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        if let Ok(val) = serde_json::from_str::<Value>(trimmed) {
            return detect_json_format(&val);
        }
    }

    // CSV heuristic
    if trimmed.contains(',') && trimmed.lines().count() >= 2 {
        let first_line = trimmed.lines().next().unwrap_or("").to_lowercase();
        if first_line.contains("secret") || first_line.contains("issuer") || first_line.contains("name") || first_line.contains("otp") {
            return Some(ImportFormat::GenericCsv);
        }
    }

    None
}

/// Import with a specific format.
pub fn import_as(data: &str, format: ImportFormat) -> ImportResult {
    match format {
        ImportFormat::OtpAuthUri => import_otpauth_uris(data),
        ImportFormat::GoogleAuthMigration => import_google_auth_migration(data),
        ImportFormat::AegisJson => import_aegis_json(data),
        ImportFormat::TwoFasJson => import_twofas_json(data),
        ImportFormat::AndOtpJson => import_andotp_json(data),
        ImportFormat::FreeOtpPlusJson => import_freeotp_json(data),
        ImportFormat::BitwardenJson => import_bitwarden_json(data),
        ImportFormat::RaivoJson => import_raivo_json(data),
        ImportFormat::AuthyJson => import_authy_json(data),
        ImportFormat::GenericCsv => import_generic_csv(data),
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Format detection helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

fn detect_json_format(val: &Value) -> Option<ImportFormat> {
    // Aegis: { "version": N, "db": { "entries": [...] } }
    if val.get("db").and_then(|d| d.get("entries")).is_some() {
        return Some(ImportFormat::AegisJson);
    }

    // 2FAS: { "services": [...], "updatedAt": ... } or { "servicesEncrypted": ... }
    if val.get("services").is_some() || val.get("servicesEncrypted").is_some() {
        return Some(ImportFormat::TwoFasJson);
    }

    // Bitwarden: { "items": [...] } or { "encrypted": true, "items": [...] }
    if val.get("items").is_some() {
        return Some(ImportFormat::BitwardenJson);
    }

    // RAIVO JSON is an array of objects with "pinned", "timer", "secret"
    if let Some(arr) = val.as_array() {
        if let Some(first) = arr.first() {
            // andOTP: array of { "secret", "type", "algorithm" }
            if first.get("type").and_then(|t| t.as_str()).map_or(false, |t| t == "TOTP" || t == "HOTP" || t == "totp" || t == "hotp") {
                return Some(ImportFormat::AndOtpJson);
            }
            // RAIVO: array of { "secret", "timer", "issuer" }
            if first.get("timer").is_some() && first.get("secret").is_some() {
                return Some(ImportFormat::RaivoJson);
            }
            // FreeOTP+: array of { "secret", "issuerExt" or "tokenType" }
            if first.get("issuerExt").is_some() || first.get("tokenType").is_some() {
                return Some(ImportFormat::FreeOtpPlusJson);
            }
            // Authy: array of { "decryptedSeed", "name" } or { "secret", "name", "originalName" }
            if first.get("decryptedSeed").is_some() || first.get("originalName").is_some() {
                return Some(ImportFormat::AuthyJson);
            }
            // Generic JSON array with "secret" field → treat as andOTP-like
            if first.get("secret").is_some() {
                return Some(ImportFormat::AndOtpJson);
            }
        }
    }

    None
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  otpauth:// URIs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

fn import_otpauth_uris(data: &str) -> ImportResult {
    let results = uri::parse_otpauth_uris(data);
    let total = results.len();
    let mut entries = Vec::new();
    let mut warnings = Vec::new();
    let mut _failed = 0usize;

    for (i, r) in results.into_iter().enumerate() {
        match r {
            Ok(e) => entries.push(e),
            Err(e) => {
                _failed += 1;
                warnings.push(format!("Line {}: {}", i + 1, e));
            }
        }
    }

    ImportResult {
        format: ImportFormat::OtpAuthUri,
        total_found: total,
        imported: entries.len(),
        skipped_duplicate: 0,
        errors: warnings,
        entries,
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Google Authenticator migration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Parse Google Authenticator migration payload.
///
/// The format is `otpauth-migration://offline?data=BASE64`, where the
/// base64 encodes a Protocol Buffer.  We do a best-effort manual decode
/// of the protobuf wire format (no protobuf dependency).
fn import_google_auth_migration(data: &str) -> ImportResult {
    let trimmed = data.trim();
    let mut warnings = Vec::new();

    // Extract base64 payload
    let b64 = if trimmed.starts_with("otpauth-migration://") {
        // Extract the data= parameter
        if let Some(pos) = trimmed.find("data=") {
            let payload = &trimmed[pos + 5..];
            // URL-decode in case of + and %xx
            url_decode_simple(payload)
        } else {
            warnings.push("No 'data=' parameter found".into());
            return ImportResult {
                format: ImportFormat::GoogleAuthMigration,
                total_found: 0,
                imported: 0,
                skipped_duplicate: 0,
                errors: warnings,
                entries: vec![],
            };
        }
    } else {
        // Maybe just raw base64
        trimmed.to_string()
    };

    let decoded = match base64_decode(&b64) {
        Ok(d) => d,
        Err(e) => {
            warnings.push(format!("Base64 decode error: {}", e));
            return ImportResult {
                format: ImportFormat::GoogleAuthMigration,
                total_found: 0,
                imported: 0,
                skipped_duplicate: 0,
                errors: warnings,
                entries: vec![],
            };
        }
    };

    let entries = parse_migration_protobuf(&decoded, &mut warnings);
    let total = entries.len();

    ImportResult {
        format: ImportFormat::GoogleAuthMigration,
        total_found: total,
        imported: entries.len(),
        skipped_duplicate: 0,
        errors: warnings,
        entries,
    }
}

/// Best-effort protobuf parser for OTP migration payload.
/// The outer message has repeated field 1 (OtpParameters).
/// Each OtpParameters has:
///   1: secret (bytes)
///   2: name (string)
///   3: issuer (string)
///   4: algorithm (varint: 0=unspecified,1=SHA1,2=SHA256,3=SHA512)
///   5: digits (varint: 0=unspecified,1=SIX,2=EIGHT)
///   6: type (varint: 0=unspecified,1=HOTP,2=TOTP)
///   7: counter (varint)
fn parse_migration_protobuf(data: &[u8], warnings: &mut Vec<String>) -> Vec<TotpEntry> {
    let mut entries = Vec::new();
    let mut pos = 0;

    while pos < data.len() {
        // Read field tag
        let (tag, new_pos) = match read_varint(data, pos) {
            Some(v) => v,
            None => break,
        };
        pos = new_pos;

        let field_number = tag >> 3;
        let wire_type = tag & 0x07;

        match (field_number, wire_type) {
            (1, 2) => {
                // Length-delimited: embedded OtpParameters message
                let (len, new_pos) = match read_varint(data, pos) {
                    Some(v) => v,
                    None => break,
                };
                pos = new_pos;
                let end = pos + len as usize;
                if end > data.len() {
                    warnings.push("Truncated migration protobuf".into());
                    break;
                }
                let sub_data = &data[pos..end];
                if let Some(entry) = parse_otp_parameters(sub_data, warnings) {
                    entries.push(entry);
                }
                pos = end;
            }
            (_, 0) => {
                // Varint – skip
                if let Some((_, np)) = read_varint(data, pos) {
                    pos = np;
                } else {
                    break;
                }
            }
            (_, 2) => {
                // Length-delimited – skip
                let (len, new_pos) = match read_varint(data, pos) {
                    Some(v) => v,
                    None => break,
                };
                pos = new_pos + len as usize;
            }
            (_, 5) => pos += 4,
            (_, 1) => pos += 8,
            _ => break,
        }
    }

    entries
}

fn parse_otp_parameters(data: &[u8], warnings: &mut Vec<String>) -> Option<TotpEntry> {
    let mut secret_bytes: Option<Vec<u8>> = None;
    let mut name = String::new();
    let mut issuer = String::new();
    let mut algo = Algorithm::Sha1;
    let mut digits = 6u8;
    let mut otp_type = OtpType::Totp;
    let mut counter = 0u64;
    let mut pos = 0;

    while pos < data.len() {
        let (tag, new_pos) = match read_varint(data, pos) {
            Some(v) => v,
            None => break,
        };
        pos = new_pos;
        let field_number = tag >> 3;
        let wire_type = tag & 0x07;

        match (field_number, wire_type) {
            (1, 2) => {
                // secret (bytes)
                let (len, np) = read_varint(data, pos)?;
                pos = np;
                let end = pos + len as usize;
                secret_bytes = Some(data[pos..end.min(data.len())].to_vec());
                pos = end;
            }
            (2, 2) => {
                // name (string)
                let (len, np) = read_varint(data, pos)?;
                pos = np;
                let end = (pos + len as usize).min(data.len());
                name = String::from_utf8_lossy(&data[pos..end]).to_string();
                pos = end;
            }
            (3, 2) => {
                // issuer (string)
                let (len, np) = read_varint(data, pos)?;
                pos = np;
                let end = (pos + len as usize).min(data.len());
                issuer = String::from_utf8_lossy(&data[pos..end]).to_string();
                pos = end;
            }
            (4, 0) => {
                let (v, np) = read_varint(data, pos)?;
                pos = np;
                algo = match v {
                    2 => Algorithm::Sha256,
                    3 => Algorithm::Sha512,
                    _ => Algorithm::Sha1,
                };
            }
            (5, 0) => {
                let (v, np) = read_varint(data, pos)?;
                pos = np;
                digits = if v == 2 { 8 } else { 6 };
            }
            (6, 0) => {
                let (v, np) = read_varint(data, pos)?;
                pos = np;
                otp_type = if v == 1 { OtpType::Hotp } else { OtpType::Totp };
            }
            (7, 0) => {
                let (v, np) = read_varint(data, pos)?;
                pos = np;
                counter = v;
            }
            (_, 0) => {
                if let Some((_, np)) = read_varint(data, pos) {
                    pos = np;
                } else {
                    break;
                }
            }
            (_, 2) => {
                let (len, np) = match read_varint(data, pos) {
                    Some(v) => v,
                    None => break,
                };
                pos = np + len as usize;
            }
            (_, 5) => pos += 4,
            (_, 1) => pos += 8,
            _ => break,
        }
    }

    let secret_b32 = match secret_bytes {
        Some(ref bytes) if !bytes.is_empty() => {
            crate::totp::core::encode_secret(bytes)
        }
        _ => {
            warnings.push(format!("Entry '{}' has no secret, skipping", name));
            return None;
        }
    };

    // Split "issuer:label" in name if issuer is empty
    let (final_issuer, label) = if issuer.is_empty() {
        if let Some(colon_pos) = name.find(':') {
            (
                Some(name[..colon_pos].trim().to_string()),
                name[colon_pos + 1..].trim().to_string(),
            )
        } else {
            (None, name)
        }
    } else {
        (Some(issuer), name)
    };

    let mut entry = TotpEntry::new(label, secret_b32)
        .with_algorithm(algo)
        .with_digits(digits);
    entry.otp_type = otp_type;
    entry.counter = counter;
    if let Some(iss) = final_issuer {
        entry = entry.with_issuer(iss);
    }

    Some(entry)
}

fn read_varint(data: &[u8], start: usize) -> Option<(u64, usize)> {
    let mut result: u64 = 0;
    let mut shift = 0;
    let mut pos = start;
    loop {
        if pos >= data.len() {
            return None;
        }
        let byte = data[pos];
        pos += 1;
        result |= ((byte & 0x7F) as u64) << shift;
        if byte & 0x80 == 0 {
            return Some((result, pos));
        }
        shift += 7;
        if shift >= 64 {
            return None;
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Aegis JSON
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

fn import_aegis_json(data: &str) -> ImportResult {
    let mut warnings = Vec::new();
    let mut entries = Vec::new();

    let val: Value = match serde_json::from_str(data) {
        Ok(v) => v,
        Err(e) => {
            warnings.push(format!("JSON parse error: {}", e));
            return ImportResult {
                format: ImportFormat::AegisJson,
                total_found: 0,
                imported: entries.len(),
                skipped_duplicate: 0,
                errors: warnings,
                entries,
            };
        }
    };

    let db_entries = val
        .get("db")
        .and_then(|d| d.get("entries"))
        .and_then(|e| e.as_array());

    let Some(arr) = db_entries else {
        warnings.push("Missing db.entries array".into());
        return ImportResult {
            format: ImportFormat::AegisJson,
            total_found: 0,
            imported: entries.len(),
            skipped_duplicate: 0,
            errors: warnings,
            entries,
        };
    };

    let total = arr.len();
    let mut _failed = 0;

    for item in arr {
        let otp_type_str = item
            .get("type")
            .and_then(|t| t.as_str())
            .unwrap_or("totp")
            .to_lowercase();
        if otp_type_str != "totp" && otp_type_str != "hotp" {
            // Skip steam, etc. for now
            warnings.push(format!("Skipping unsupported type: {}", otp_type_str));
            _failed += 1;
            continue;
        }

        let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let issuer = item.get("issuer").and_then(|v| v.as_str()).unwrap_or("");
        let info = item.get("info");

        let secret = info
            .and_then(|i| i.get("secret"))
            .and_then(|s| s.as_str())
            .unwrap_or("");

        if secret.is_empty() {
            _failed += 1;
            warnings.push(format!("Entry '{}' has no secret", name));
            continue;
        }

        let algo_str = info
            .and_then(|i| i.get("algo"))
            .and_then(|a| a.as_str())
            .unwrap_or("SHA1");
        let digits = info
            .and_then(|i| i.get("digits"))
            .and_then(|d| d.as_u64())
            .unwrap_or(6) as u8;
        let period = info
            .and_then(|i| i.get("period"))
            .and_then(|p| p.as_u64())
            .unwrap_or(30) as u32;
        let counter = info
            .and_then(|i| i.get("counter"))
            .and_then(|c| c.as_u64())
            .unwrap_or(0);

        let algo = Algorithm::from_str_loose(algo_str).unwrap_or(Algorithm::Sha1);

        let mut entry = TotpEntry::new(name, secret)
            .with_algorithm(algo)
            .with_digits(digits)
            .with_period(period);

        if !issuer.is_empty() {
            entry = entry.with_issuer(issuer);
        }

        if otp_type_str == "hotp" {
            entry.otp_type = OtpType::Hotp;
            entry.counter = counter;
        }

        // Optional Aegis fields
        if let Some(note) = item.get("note").and_then(|n| n.as_str()) {
            if !note.is_empty() {
                entry.notes = Some(note.to_string());
            }
        }
        if let Some(fav) = item.get("favorite").and_then(|f| f.as_bool()) {
            entry.favourite = fav;
        }
        if let Some(icon) = item.get("icon").and_then(|i| i.as_str()) {
            if !icon.is_empty() {
                entry.icon = Some(icon.to_string());
            }
        }

        // Aegis group is stored in group_id (UUID string)
        if let Some(gid) = item.get("group").and_then(|g| g.as_str()) {
            if !gid.is_empty() {
                entry.group_id = Some(gid.to_string());
            }
        }

        entries.push(entry);
    }

    ImportResult {
        format: ImportFormat::AegisJson,
        total_found: total,
        imported: entries.len(),
        skipped_duplicate: 0,
        errors: warnings,
        entries,
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  2FAS JSON
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

fn import_twofas_json(data: &str) -> ImportResult {
    let mut warnings = Vec::new();
    let mut entries = Vec::new();

    let val: Value = match serde_json::from_str(data) {
        Ok(v) => v,
        Err(e) => {
            warnings.push(format!("JSON parse error: {}", e));
            return ImportResult {
                format: ImportFormat::TwoFasJson,
                total_found: 0,
                imported: entries.len(),
                skipped_duplicate: 0,
                errors: warnings,
                entries,
            };
        }
    };

    let services = val.get("services").and_then(|s| s.as_array());
    let Some(arr) = services else {
        warnings.push("Missing 'services' array".into());
        return ImportResult {
            format: ImportFormat::TwoFasJson,
            total_found: 0,
            imported: entries.len(),
            skipped_duplicate: 0,
            errors: warnings,
            entries,
        };
    };

    let total = arr.len();
    let mut _failed = 0;

    for item in arr {
        let name = item.get("name").and_then(|n| n.as_str()).unwrap_or("");

        let otp = item.get("otp");
        let secret = otp
            .and_then(|o| o.get("secret"))
            .or_else(|| item.get("secret"))
            .and_then(|s| s.as_str())
            .unwrap_or("");

        if secret.is_empty() {
            _failed += 1;
            warnings.push(format!("Entry '{}' has no secret", name));
            continue;
        }

        let issuer = otp
            .and_then(|o| o.get("issuer"))
            .or_else(|| item.get("issuer"))
            .and_then(|s| s.as_str())
            .unwrap_or("");

        let algo_str = otp
            .and_then(|o| o.get("algorithm"))
            .and_then(|a| a.as_str())
            .unwrap_or("SHA1");
        let digits = otp
            .and_then(|o| o.get("digits"))
            .and_then(|d| d.as_u64())
            .unwrap_or(6) as u8;
        let period = otp
            .and_then(|o| o.get("period"))
            .and_then(|p| p.as_u64())
            .unwrap_or(30) as u32;
        let counter = otp
            .and_then(|o| o.get("counter"))
            .and_then(|c| c.as_u64())
            .unwrap_or(0);
        let token_type = otp
            .and_then(|o| o.get("tokenType"))
            .or_else(|| item.get("type"))
            .and_then(|t| t.as_str())
            .unwrap_or("TOTP")
            .to_uppercase();

        let algo = Algorithm::from_str_loose(algo_str).unwrap_or(Algorithm::Sha1);

        let mut entry = TotpEntry::new(name, secret)
            .with_algorithm(algo)
            .with_digits(digits)
            .with_period(period);

        if !issuer.is_empty() {
            entry = entry.with_issuer(issuer);
        }
        if token_type == "HOTP" {
            entry.otp_type = OtpType::Hotp;
            entry.counter = counter;
        }

        entries.push(entry);
    }

    ImportResult {
        format: ImportFormat::TwoFasJson,
        total_found: total,
        imported: entries.len(),
        skipped_duplicate: 0,
        errors: warnings,
        entries,
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  andOTP JSON
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

fn import_andotp_json(data: &str) -> ImportResult {
    let mut warnings = Vec::new();
    let mut entries = Vec::new();

    let arr: Vec<Value> = match serde_json::from_str(data) {
        Ok(v) => v,
        Err(e) => {
            warnings.push(format!("JSON parse error: {}", e));
            return ImportResult {
                format: ImportFormat::AndOtpJson,
                total_found: 0,
                imported: entries.len(),
                skipped_duplicate: 0,
                errors: warnings,
                entries,
            };
        }
    };

    let total = arr.len();
    let mut _failed = 0;

    for item in &arr {
        let secret = item.get("secret").and_then(|s| s.as_str()).unwrap_or("");
        if secret.is_empty() {
            _failed += 1;
            continue;
        }

        let issuer = item.get("issuer").and_then(|i| i.as_str()).unwrap_or("");
        let label = item.get("label").and_then(|l| l.as_str()).unwrap_or("");
        let algo_str = item.get("algorithm").and_then(|a| a.as_str()).unwrap_or("SHA1");
        let digits = item.get("digits").and_then(|d| d.as_u64()).unwrap_or(6) as u8;
        let period = item.get("period").and_then(|p| p.as_u64()).unwrap_or(30) as u32;
        let counter = item.get("counter").and_then(|c| c.as_u64()).unwrap_or(0);
        let otp_type_str = item
            .get("type")
            .and_then(|t| t.as_str())
            .unwrap_or("TOTP")
            .to_uppercase();

        let algo = Algorithm::from_str_loose(algo_str).unwrap_or(Algorithm::Sha1);

        let display_label = if label.is_empty() {
            issuer.to_string()
        } else {
            label.to_string()
        };

        let mut entry = TotpEntry::new(display_label, secret)
            .with_algorithm(algo)
            .with_digits(digits)
            .with_period(period);

        if !issuer.is_empty() {
            entry = entry.with_issuer(issuer);
        }
        if otp_type_str == "HOTP" {
            entry.otp_type = OtpType::Hotp;
            entry.counter = counter;
        }

        // andOTP tags
        if let Some(tags) = item.get("tags").and_then(|t| t.as_array()) {
            let tag_strs: Vec<String> = tags
                .iter()
                .filter_map(|t| t.as_str().map(String::from))
                .collect();
            if !tag_strs.is_empty() {
                entry.tags = tag_strs;
            }
        }

        entries.push(entry);
    }

    ImportResult {
        format: ImportFormat::AndOtpJson,
        total_found: total,
        imported: entries.len(),
        skipped_duplicate: 0,
        errors: warnings,
        entries,
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  FreeOTP+ JSON
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

fn import_freeotp_json(data: &str) -> ImportResult {
    let mut warnings = Vec::new();
    let mut entries = Vec::new();

    let val: Value = match serde_json::from_str(data) {
        Ok(v) => v,
        Err(e) => {
            warnings.push(format!("JSON parse error: {}", e));
            return ImportResult {
                format: ImportFormat::FreeOtpPlusJson,
                total_found: 0,
                imported: entries.len(),
                skipped_duplicate: 0,
                errors: warnings,
                entries,
            };
        }
    };

    // FreeOTP+ exports as { "tokens": [...] } or just [...]
    let arr = val
        .get("tokens")
        .and_then(|t| t.as_array())
        .or_else(|| val.as_array());

    let Some(arr) = arr else {
        warnings.push("No token array found".into());
        return ImportResult {
            format: ImportFormat::FreeOtpPlusJson,
            total_found: 0,
            imported: entries.len(),
            skipped_duplicate: 0,
            errors: warnings,
            entries,
        };
    };

    let total = arr.len();
    let mut _failed = 0;

    for item in arr {
        let secret = item.get("secret").and_then(|s| s.as_str()).unwrap_or("");
        if secret.is_empty() {
            _failed += 1;
            continue;
        }

        let issuer = item
            .get("issuerExt")
            .or_else(|| item.get("issuer"))
            .and_then(|i| i.as_str())
            .unwrap_or("");
        let label = item.get("label").and_then(|l| l.as_str()).unwrap_or("");
        let algo_str = item.get("algo").and_then(|a| a.as_str()).unwrap_or("SHA1");
        let digits = item.get("digits").and_then(|d| d.as_u64()).unwrap_or(6) as u8;
        let period = item.get("period").and_then(|p| p.as_u64()).unwrap_or(30) as u32;
        let counter = item.get("counter").and_then(|c| c.as_u64()).unwrap_or(0);
        let token_type = item
            .get("tokenType")
            .or_else(|| item.get("type"))
            .and_then(|t| t.as_str())
            .unwrap_or("TOTP")
            .to_uppercase();

        let algo = Algorithm::from_str_loose(algo_str).unwrap_or(Algorithm::Sha1);

        let display_label = if label.is_empty() {
            issuer.to_string()
        } else {
            label.to_string()
        };

        let mut entry = TotpEntry::new(display_label, secret)
            .with_algorithm(algo)
            .with_digits(digits)
            .with_period(period);

        if !issuer.is_empty() {
            entry = entry.with_issuer(issuer);
        }
        if token_type == "HOTP" {
            entry.otp_type = OtpType::Hotp;
            entry.counter = counter;
        }

        entries.push(entry);
    }

    ImportResult {
        format: ImportFormat::FreeOtpPlusJson,
        total_found: total,
        imported: entries.len(),
        skipped_duplicate: 0,
        errors: warnings,
        entries,
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Bitwarden JSON
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

fn import_bitwarden_json(data: &str) -> ImportResult {
    let mut warnings = Vec::new();
    let mut entries = Vec::new();

    let val: Value = match serde_json::from_str(data) {
        Ok(v) => v,
        Err(e) => {
            warnings.push(format!("JSON parse error: {}", e));
            return ImportResult {
                format: ImportFormat::BitwardenJson,
                total_found: 0,
                imported: entries.len(),
                skipped_duplicate: 0,
                errors: warnings,
                entries,
            };
        }
    };

    let items = val.get("items").and_then(|i| i.as_array());
    let Some(arr) = items else {
        warnings.push("Missing 'items' array".into());
        return ImportResult {
            format: ImportFormat::BitwardenJson,
            total_found: 0,
            imported: entries.len(),
            skipped_duplicate: 0,
            errors: warnings,
            entries,
        };
    };

    let mut total_with_totp = 0;
    let mut _failed = 0;

    for item in arr {
        // Only items with a TOTP field
        let totp_field = item
            .get("login")
            .and_then(|l| l.get("totp"))
            .and_then(|t| t.as_str())
            .unwrap_or("");
        if totp_field.is_empty() {
            continue;
        }
        total_with_totp += 1;

        let name = item.get("name").and_then(|n| n.as_str()).unwrap_or("Unknown");

        // The TOTP field may be:
        // 1. An otpauth:// URI
        // 2. A raw secret
        if totp_field.starts_with("otpauth://") {
            match crate::totp::uri::parse_otpauth_uri(totp_field) {
                Ok(mut entry) => {
                    if entry.label.is_empty() || entry.label == name {
                        entry.label = name.to_string();
                    }
                    entries.push(entry);
                }
                Err(e) => {
                    _failed += 1;
                    warnings.push(format!("Bitwarden entry '{}': {}", name, e));
                }
            }
        } else {
            // Assume raw base32 secret
            let entry = TotpEntry::new(name, totp_field);
            entries.push(entry);
        }
    }

    ImportResult {
        format: ImportFormat::BitwardenJson,
        total_found: total_with_totp,
        imported: entries.len(),
        skipped_duplicate: 0,
        errors: warnings,
        entries,
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  RAIVO JSON
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

fn import_raivo_json(data: &str) -> ImportResult {
    let mut warnings = Vec::new();
    let mut entries = Vec::new();

    let arr: Vec<Value> = match serde_json::from_str(data) {
        Ok(v) => v,
        Err(e) => {
            warnings.push(format!("JSON parse error: {}", e));
            return ImportResult {
                format: ImportFormat::RaivoJson,
                total_found: 0,
                imported: entries.len(),
                skipped_duplicate: 0,
                errors: warnings,
                entries,
            };
        }
    };

    let total = arr.len();
    let mut _failed = 0;

    for item in &arr {
        let secret = item.get("secret").and_then(|s| s.as_str()).unwrap_or("");
        if secret.is_empty() {
            _failed += 1;
            continue;
        }

        let issuer = item.get("issuer").and_then(|i| i.as_str()).unwrap_or("");
        let account = item.get("account").and_then(|a| a.as_str()).unwrap_or("");
        let algo_str = item.get("algorithm").and_then(|a| a.as_str()).unwrap_or("SHA1");
        let digits = item.get("digits").and_then(|d| d.as_str()).and_then(|s| s.parse().ok()).unwrap_or(6u8);
        let timer = item.get("timer").and_then(|t| t.as_str()).and_then(|s| s.parse().ok()).unwrap_or(30u32);
        let counter = item.get("counter").and_then(|c| c.as_str()).and_then(|s| s.parse().ok()).unwrap_or(0u64);
        let kind = item.get("kind").and_then(|k| k.as_str()).unwrap_or("TOTP").to_uppercase();

        let algo = Algorithm::from_str_loose(algo_str).unwrap_or(Algorithm::Sha1);

        let label = if account.is_empty() {
            issuer.to_string()
        } else {
            account.to_string()
        };

        let mut entry = TotpEntry::new(label, secret)
            .with_algorithm(algo)
            .with_digits(digits)
            .with_period(timer);

        if !issuer.is_empty() {
            entry = entry.with_issuer(issuer);
        }
        if kind == "HOTP" {
            entry.otp_type = OtpType::Hotp;
            entry.counter = counter;
        }

        // RAIVO pinned → favourite
        if let Some(pinned) = item.get("pinned").and_then(|p| p.as_str()) {
            if pinned == "1" || pinned.to_lowercase() == "true" {
                entry.favourite = true;
            }
        }

        entries.push(entry);
    }

    ImportResult {
        format: ImportFormat::RaivoJson,
        total_found: total,
        imported: entries.len(),
        skipped_duplicate: 0,
        errors: warnings,
        entries,
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Authy JSON
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

fn import_authy_json(data: &str) -> ImportResult {
    let mut warnings = Vec::new();
    let mut entries = Vec::new();

    let arr: Vec<Value> = match serde_json::from_str(data) {
        Ok(v) => v,
        Err(e) => {
            warnings.push(format!("JSON parse error: {}", e));
            return ImportResult {
                format: ImportFormat::AuthyJson,
                total_found: 0,
                imported: entries.len(),
                skipped_duplicate: 0,
                errors: warnings,
                entries,
            };
        }
    };

    let total = arr.len();
    let mut _failed = 0;

    for item in &arr {
        // Authy uses "decryptedSeed" (hex-encoded) or "secret" (base32)
        let secret = if let Some(seed) = item.get("decryptedSeed").and_then(|s| s.as_str()) {
            if !seed.is_empty() {
                // decryptedSeed is hex → convert to base32
                match hex::decode(seed) {
                    Ok(bytes) => crate::totp::core::encode_secret(&bytes),
                    Err(_) => {
                        // Maybe it's already base32
                        seed.to_string()
                    }
                }
            } else {
                String::new()
            }
        } else {
            item.get("secret")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string()
        };

        if secret.is_empty() {
            _failed += 1;
            continue;
        }

        let name = item
            .get("name")
            .or_else(|| item.get("originalName"))
            .and_then(|n| n.as_str())
            .unwrap_or("Unknown");

        let digits = item
            .get("digits")
            .and_then(|d| d.as_u64())
            .unwrap_or(6) as u8;

        // Authy defaults to 7 digits / 10s period for some accounts
        let period = item
            .get("period")
            .and_then(|p| p.as_u64())
            .unwrap_or(30) as u32;

        let entry = TotpEntry::new(name, &secret)
            .with_digits(digits)
            .with_period(period);

        entries.push(entry);
    }

    ImportResult {
        format: ImportFormat::AuthyJson,
        total_found: total,
        imported: entries.len(),
        skipped_duplicate: 0,
        errors: warnings,
        entries,
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Generic CSV
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

fn import_generic_csv(data: &str) -> ImportResult {
    let mut warnings = Vec::new();
    let mut entries = Vec::new();

    let mut lines = data.lines();
    let header = match lines.next() {
        Some(h) => h,
        None => {
            warnings.push("Empty CSV".into());
            return ImportResult {
                format: ImportFormat::GenericCsv,
                total_found: 0,
                imported: entries.len(),
                skipped_duplicate: 0,
                errors: warnings,
                entries,
            };
        }
    };

    let columns: Vec<String> = parse_csv_row(header)
        .iter()
        .map(|c| c.to_lowercase().trim().to_string())
        .collect();

    let col_map = build_column_map(&columns);

    let mut total = 0;
    let mut _failed = 0;

    for (line_num, line) in lines.enumerate() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        total += 1;
        let fields = parse_csv_row(line);

        let get_field = |key: &str| -> String {
            col_map
                .get(key)
                .and_then(|&idx| fields.get(idx))
                .cloned()
                .unwrap_or_default()
        };

        let secret = get_field("secret");
        if secret.is_empty() {
            // Maybe there's an otpauth URI column
            let uri_field = get_field("uri")
                .to_string();
            let uri_field = if uri_field.is_empty() { get_field("otpauth") } else { uri_field };
            let uri_field = if uri_field.is_empty() { get_field("url") } else { uri_field };

            if !uri_field.is_empty() && uri_field.starts_with("otpauth://") {
                match crate::totp::uri::parse_otpauth_uri(&uri_field) {
                    Ok(entry) => entries.push(entry),
                    Err(e) => {
                        _failed += 1;
                        warnings.push(format!("Row {}: {}", line_num + 2, e));
                    }
                }
                continue;
            }

            _failed += 1;
            warnings.push(format!("Row {}: no secret found", line_num + 2));
            continue;
        }

        let name = {
            let n = get_field("name");
            if n.is_empty() { get_field("label") } else { n }
        };
        let name = if name.is_empty() {
            get_field("account")
        } else {
            name
        };
        let name = if name.is_empty() {
            format!("Entry {}", line_num + 1)
        } else {
            name
        };

        let issuer = get_field("issuer");
        let algo_str = get_field("algorithm");
        let digits_str = get_field("digits");
        let period_str = get_field("period");
        let otp_type_str = get_field("type");

        let algo = if algo_str.is_empty() {
            Algorithm::Sha1
        } else {
            Algorithm::from_str_loose(&algo_str).unwrap_or(Algorithm::Sha1)
        };
        let digits = digits_str.parse().unwrap_or(6u8);
        let period = period_str.parse().unwrap_or(30u32);

        let mut entry = TotpEntry::new(name, &secret)
            .with_algorithm(algo)
            .with_digits(digits)
            .with_period(period);

        if !issuer.is_empty() {
            entry = entry.with_issuer(issuer);
        }
        if otp_type_str.to_uppercase() == "HOTP" {
            entry.otp_type = OtpType::Hotp;
            let counter_str = get_field("counter");
            entry.counter = counter_str.parse().unwrap_or(0);
        }

        entries.push(entry);
    }

    ImportResult {
        format: ImportFormat::GenericCsv,
        total_found: total,
        imported: entries.len(),
        skipped_duplicate: 0,
        errors: warnings,
        entries,
    }
}

/// Parse a single CSV row, handling quoted fields.
fn parse_csv_row(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();

    while let Some(c) = chars.next() {
        if in_quotes {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                    current.push('"');
                } else {
                    in_quotes = false;
                }
            } else {
                current.push(c);
            }
        } else if c == '"' {
            in_quotes = true;
        } else if c == ',' {
            fields.push(current.trim().to_string());
            current = String::new();
        } else {
            current.push(c);
        }
    }
    fields.push(current.trim().to_string());
    fields
}

/// Build a map from known column aliases to index.
fn build_column_map(columns: &[String]) -> HashMap<String, usize> {
    let mut map = HashMap::new();

    let aliases: &[(&str, &[&str])] = &[
        ("secret", &["secret", "seed", "key", "totp_secret", "otp_secret"]),
        ("name", &["name", "account_name", "service", "title"]),
        ("label", &["label"]),
        ("account", &["account", "email", "user", "username"]),
        ("issuer", &["issuer", "provider", "site"]),
        ("algorithm", &["algorithm", "algo", "hash"]),
        ("digits", &["digits", "length"]),
        ("period", &["period", "interval", "timer", "step"]),
        ("type", &["type", "otp_type", "kind"]),
        ("counter", &["counter"]),
        ("uri", &["uri", "otpauth_uri"]),
        ("otpauth", &["otpauth"]),
        ("url", &["url"]),
    ];

    for (canonical, names) in aliases {
        for (idx, col) in columns.iter().enumerate() {
            if names.contains(&col.as_str()) {
                map.insert(canonical.to_string(), idx);
                break;
            }
        }
    }

    map
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

fn url_decode_simple(s: &str) -> String {
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

fn base64_decode(data: &str) -> Result<Vec<u8>, String> {
    use base64::Engine;
    // Try standard, then URL-safe
    base64::engine::general_purpose::STANDARD
        .decode(data.trim())
        .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(data.trim()))
        .or_else(|_| {
            // Some exporters use URL-safe without padding
            base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(data.trim())
        })
        .map_err(|e| format!("base64 decode: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── otpauth URI import ───────────────────────────────────────

    #[test]
    fn import_single_otpauth_uri() {
        let data = "otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example";
        let result = auto_import(data);
        assert_eq!(result.entries.len(), 1);
        assert_eq!(result.format, ImportFormat::OtpAuthUri);
        assert_eq!(result.entries[0].label, "alice");
    }

    #[test]
    fn import_multiple_otpauth_uris() {
        let data = "\
otpauth://totp/A:a?secret=AAAA
otpauth://totp/B:b?secret=BBBB
otpauth://hotp/C:c?secret=CCCC&counter=1
";
        let result = auto_import(data);
        assert_eq!(result.entries.len(), 3);
    }

    // ── Aegis JSON ───────────────────────────────────────────────

    #[test]
    fn import_aegis_json_basic() {
        let json = r#"{
  "version": 2,
  "db": {
    "entries": [
      {
        "type": "totp",
        "name": "alice",
        "issuer": "GitHub",
        "note": "my note",
        "favorite": true,
        "info": {
          "secret": "JBSWY3DPEHPK3PXP",
          "algo": "SHA1",
          "digits": 6,
          "period": 30
        }
      },
      {
        "type": "hotp",
        "name": "bob",
        "issuer": "Acme",
        "info": {
          "secret": "ABCDEFGH",
          "algo": "SHA256",
          "digits": 8,
          "period": 30,
          "counter": 5
        }
      }
    ]
  }
}"#;
        let result = auto_import(json);
        assert_eq!(result.format, ImportFormat::AegisJson);
        assert_eq!(result.entries.len(), 2);
        assert_eq!(result.entries[0].issuer.as_deref(), Some("GitHub"));
        assert_eq!(result.entries[0].notes.as_deref(), Some("my note"));
        assert!(result.entries[0].favourite);
        assert_eq!(result.entries[1].otp_type, OtpType::Hotp);
        assert_eq!(result.entries[1].counter, 5);
        assert_eq!(result.entries[1].algorithm, Algorithm::Sha256);
    }

    // ── 2FAS JSON ────────────────────────────────────────────────

    #[test]
    fn import_twofas_json_basic() {
        let json = r#"{
  "services": [
    {
      "name": "GitHub",
      "otp": {
        "secret": "JBSWY3DPEHPK3PXP",
        "issuer": "GitHub",
        "algorithm": "SHA1",
        "digits": 6,
        "period": 30,
        "tokenType": "TOTP"
      }
    },
    {
      "name": "AWS",
      "otp": {
        "secret": "ABCDEF",
        "algorithm": "SHA256",
        "digits": 8,
        "period": 60,
        "tokenType": "TOTP"
      }
    }
  ],
  "updatedAt": 1700000000
}"#;
        let result = auto_import(json);
        assert_eq!(result.format, ImportFormat::TwoFasJson);
        assert_eq!(result.entries.len(), 2);
        assert_eq!(result.entries[0].label, "GitHub");
        assert_eq!(result.entries[1].algorithm, Algorithm::Sha256);
    }

    // ── andOTP JSON ──────────────────────────────────────────────

    #[test]
    fn import_andotp_json_basic() {
        let json = r#"[
  {
    "secret": "JBSWY3DPEHPK3PXP",
    "issuer": "GitHub",
    "label": "alice",
    "digits": 6,
    "period": 30,
    "type": "TOTP",
    "algorithm": "SHA1",
    "tags": ["work", "dev"]
  }
]"#;
        let result = auto_import(json);
        assert_eq!(result.format, ImportFormat::AndOtpJson);
        assert_eq!(result.entries.len(), 1);
        assert_eq!(result.entries[0].tags, vec!["work", "dev"]);
    }

    // ── FreeOTP+ JSON ────────────────────────────────────────────

    #[test]
    fn import_freeotp_json_basic() {
        let json = r#"[
  {
    "secret": "JBSWY3DPEHPK3PXP",
    "issuerExt": "Test",
    "label": "user@test.com",
    "algo": "SHA1",
    "digits": 6,
    "period": 30,
    "tokenType": "TOTP"
  }
]"#;
        let result = auto_import(json);
        assert_eq!(result.format, ImportFormat::FreeOtpPlusJson);
        assert_eq!(result.entries.len(), 1);
        assert_eq!(result.entries[0].issuer.as_deref(), Some("Test"));
    }

    // ── Bitwarden JSON ───────────────────────────────────────────

    #[test]
    fn import_bitwarden_json_basic() {
        let json = r#"{
  "items": [
    {
      "name": "GitHub",
      "login": {
        "username": "alice",
        "totp": "otpauth://totp/GitHub:alice?secret=JBSWY3DPEHPK3PXP&issuer=GitHub"
      }
    },
    {
      "name": "Raw Secret Site",
      "login": {
        "username": "bob",
        "totp": "ABCDEFGH"
      }
    },
    {
      "name": "No TOTP",
      "login": {
        "username": "charlie"
      }
    }
  ]
}"#;
        let result = auto_import(json);
        assert_eq!(result.format, ImportFormat::BitwardenJson);
        assert_eq!(result.entries.len(), 2);
        assert_eq!(result.entries[0].issuer.as_deref(), Some("GitHub"));
        assert_eq!(result.entries[1].secret, "ABCDEFGH");
    }

    // ── RAIVO JSON ───────────────────────────────────────────────

    #[test]
    fn import_raivo_json_basic() {
        let json = r#"[
  {
    "secret": "JBSWY3DPEHPK3PXP",
    "issuer": "GitHub",
    "account": "alice",
    "algorithm": "SHA1",
    "digits": "6",
    "timer": "30",
    "kind": "TOTP",
    "pinned": "1",
    "counter": "0"
  }
]"#;
        let result = auto_import(json);
        assert_eq!(result.format, ImportFormat::RaivoJson);
        assert_eq!(result.entries.len(), 1);
        assert!(result.entries[0].favourite);
        assert_eq!(result.entries[0].issuer.as_deref(), Some("GitHub"));
    }

    // ── Authy JSON ───────────────────────────────────────────────

    #[test]
    fn import_authy_json_basic() {
        let json = r#"[
  {
    "name": "GitHub",
    "originalName": "GitHub",
    "decryptedSeed": "48656c6c6f21deadbeef",
    "digits": 6,
    "period": 30
  }
]"#;
        let result = auto_import(json);
        assert_eq!(result.format, ImportFormat::AuthyJson);
        assert_eq!(result.entries.len(), 1);
        assert_eq!(result.entries[0].label, "GitHub");
        // Secret should be base32 encoded from hex seed
        assert!(!result.entries[0].secret.is_empty());
    }

    // ── Generic CSV ──────────────────────────────────────────────

    #[test]
    fn import_csv_basic() {
        let csv = "\
name,secret,issuer,algorithm,digits,period,type
GitHub,JBSWY3DPEHPK3PXP,GitHub,SHA1,6,30,TOTP
AWS,ABCDEFGH,Amazon,SHA256,8,60,TOTP
";
        let result = auto_import(csv);
        assert_eq!(result.format, ImportFormat::GenericCsv);
        assert_eq!(result.entries.len(), 2);
        assert_eq!(result.entries[0].issuer.as_deref(), Some("GitHub"));
        assert_eq!(result.entries[1].algorithm, Algorithm::Sha256);
    }

    #[test]
    fn import_csv_with_uri_column() {
        let csv = "\
name,uri
Test,otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP
";
        let result = import_generic_csv(csv);
        assert_eq!(result.entries.len(), 1);
    }

    #[test]
    fn import_csv_quoted_fields() {
        let csv = "\
name,secret,issuer
\"My, Service\",JBSWY3DPEHPK3PXP,\"Acme, Inc.\"
";
        let result = import_generic_csv(csv);
        assert_eq!(result.entries.len(), 1);
        assert_eq!(result.entries[0].label, "My, Service");
        assert_eq!(result.entries[0].issuer.as_deref(), Some("Acme, Inc."));
    }

    // ── Format detection ─────────────────────────────────────────

    #[test]
    fn detect_otpauth_uri() {
        assert_eq!(
            detect_format("otpauth://totp/Test?secret=ABC"),
            Some(ImportFormat::OtpAuthUri)
        );
    }

    #[test]
    fn detect_google_migration() {
        assert_eq!(
            detect_format("otpauth-migration://offline?data=AAAA"),
            Some(ImportFormat::GoogleAuthMigration)
        );
    }

    #[test]
    fn detect_aegis() {
        let json = r#"{"version":2,"db":{"entries":[]}}"#;
        assert_eq!(detect_format(json), Some(ImportFormat::AegisJson));
    }

    #[test]
    fn detect_twofas() {
        let json = r#"{"services":[],"updatedAt":0}"#;
        assert_eq!(detect_format(json), Some(ImportFormat::TwoFasJson));
    }

    #[test]
    fn detect_bitwarden() {
        let json = r#"{"items":[]}"#;
        assert_eq!(detect_format(json), Some(ImportFormat::BitwardenJson));
    }

    #[test]
    fn detect_csv() {
        let csv = "name,secret,issuer\nTest,ABC,Test";
        assert_eq!(detect_format(csv), Some(ImportFormat::GenericCsv));
    }

    #[test]
    fn detect_unknown() {
        assert_eq!(detect_format("just random text"), None);
    }

    // ── CSV parser ───────────────────────────────────────────────

    #[test]
    fn csv_parse_simple_row() {
        let fields = parse_csv_row("a,b,c");
        assert_eq!(fields, vec!["a", "b", "c"]);
    }

    #[test]
    fn csv_parse_quoted_row() {
        let fields = parse_csv_row(r#""hello, world",b,"c""d""#);
        assert_eq!(fields, vec!["hello, world", "b", r#"c"d"#]);
    }

    // ── Google migration protobuf ────────────────────────────────

    #[test]
    fn protobuf_varint_read() {
        // 150 as varint = [0x96, 0x01]
        let data = [0x96, 0x01];
        let (val, pos) = read_varint(&data, 0).unwrap();
        assert_eq!(val, 150);
        assert_eq!(pos, 2);
    }

    #[test]
    fn protobuf_varint_single_byte() {
        let data = [42];
        let (val, pos) = read_varint(&data, 0).unwrap();
        assert_eq!(val, 42);
        assert_eq!(pos, 1);
    }

    #[test]
    fn migration_empty_data() {
        let result = import_google_auth_migration("otpauth-migration://offline?data=");
        assert_eq!(result.entries.len(), 0);
    }

    // ── Import with explicit format ──────────────────────────────

    #[test]
    fn import_as_explicit_format() {
        let data = "otpauth://totp/Test?secret=JBSWY3DPEHPK3PXP";
        let result = import_as(data, ImportFormat::OtpAuthUri);
        assert_eq!(result.entries.len(), 1);
    }

    // ── Column map ───────────────────────────────────────────────

    #[test]
    fn column_map_aliases() {
        let cols = vec![
            "seed".to_string(),
            "provider".to_string(),
            "account_name".to_string(),
        ];
        let map = build_column_map(&cols);
        assert_eq!(map.get("secret"), Some(&0));
        assert_eq!(map.get("issuer"), Some(&1));
        assert_eq!(map.get("name"), Some(&2));
    }
}
