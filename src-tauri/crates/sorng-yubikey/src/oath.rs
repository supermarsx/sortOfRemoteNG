//! # OATH (TOTP/HOTP) Operations
//!
//! Add, remove, rename, and calculate one-time passwords stored on
//! the YubiKey OATH applet via `ykman oath`.

use crate::detect::run_ykman;
use crate::types::*;
use log::info;

// ── Account Listing ─────────────────────────────────────────────────

/// List all OATH accounts on the device.
pub async fn list_accounts(ykman: &str, serial: Option<u32>) -> Result<Vec<OathAccount>, String> {
    let output = run_ykman(
        ykman,
        serial,
        &["oath", "accounts", "list", "-H", "-o", "-p"],
    )
    .await?;
    Ok(parse_account_list(&output))
}

/// Parse `ykman oath accounts list -H -o -p` output.
fn parse_account_list(output: &str) -> Vec<OathAccount> {
    let mut accounts = Vec::new();

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Output format varies by ykman version.  Common:
        //   Issuer:Name  TOTP  SHA256  6  30s  [touch]
        //   or "Issuer:Name" (minimal)
        let parts: Vec<&str> = trimmed.splitn(2, ['\t', ' ']).collect();
        let id_part = parts[0].trim();

        // Split issuer:name
        let (issuer, name) = if let Some((i, n)) = id_part.split_once(':') {
            (i.trim().to_string(), n.trim().to_string())
        } else {
            (String::new(), id_part.to_string())
        };

        let mut account = OathAccount {
            issuer: issuer.clone(),
            name: name.clone(),
            oath_type: OathType::Totp,
            algorithm: OathAlgorithm::Sha1,
            digits: 6,
            period: 30,
            touch_required: false,
            credential_id: id_part.to_string(),
        };

        // Parse remaining metadata from the rest of the line
        if parts.len() > 1 {
            let meta = parts[1].to_lowercase();
            if meta.contains("hotp") {
                account.oath_type = OathType::Hotp;
            }
            if meta.contains("sha256") {
                account.algorithm = OathAlgorithm::Sha256;
            } else if meta.contains("sha512") {
                account.algorithm = OathAlgorithm::Sha512;
            }
            if meta.contains("8") {
                account.digits = 8;
            }
            if meta.contains("touch") {
                account.touch_required = true;
            }
            // Period (e.g. "60s")
            for word in meta.split_whitespace() {
                if let Some(stripped) = word.strip_suffix('s') {
                    if let Ok(p) = stripped.parse::<u32>() {
                        if p > 0 {
                            account.period = p;
                        }
                    }
                }
            }
        }

        accounts.push(account);
    }

    accounts
}

// ── Add / Delete / Rename ───────────────────────────────────────────

/// Add an OATH account.
#[allow(clippy::too_many_arguments)]
pub async fn add_account(
    ykman: &str,
    serial: Option<u32>,
    issuer: &str,
    name: &str,
    secret: &str,
    oath_type: &OathType,
    algorithm: &OathAlgorithm,
    digits: u8,
    period: u32,
    touch: bool,
) -> Result<bool, String> {
    let digits_str = digits.to_string();
    let period_str = period.to_string();
    let mut args = vec![
        "oath",
        "accounts",
        "add",
        "-o",
        oath_type.ykman_arg(),
        "-a",
        algorithm.ykman_arg(),
        "-d",
        &digits_str,
    ];

    if *oath_type == OathType::Totp {
        args.extend_from_slice(&["-p", &period_str]);
    }

    if !issuer.is_empty() {
        args.extend_from_slice(&["-i", issuer]);
    }

    if touch {
        args.push("-t");
    }

    // Name and secret
    args.push(name);
    args.push(secret);

    run_ykman(ykman, serial, &args).await?;
    info!("Added OATH account {}:{}", issuer, name);
    Ok(true)
}

/// Delete an OATH account.
pub async fn delete_account(
    ykman: &str,
    serial: Option<u32>,
    credential_id: &str,
) -> Result<bool, String> {
    run_ykman(
        ykman,
        serial,
        &["oath", "accounts", "delete", credential_id, "-f"],
    )
    .await?;
    info!("Deleted OATH account {}", credential_id);
    Ok(true)
}

/// Rename an OATH account.
pub async fn rename_account(
    ykman: &str,
    serial: Option<u32>,
    old_id: &str,
    new_issuer: &str,
    new_name: &str,
) -> Result<bool, String> {
    let new_id = if new_issuer.is_empty() {
        new_name.to_string()
    } else {
        format!("{}:{}", new_issuer, new_name)
    };

    run_ykman(
        ykman,
        serial,
        &["oath", "accounts", "rename", old_id, &new_id, "-f"],
    )
    .await?;
    info!("Renamed OATH account {} → {}", old_id, new_id);
    Ok(true)
}

// ── Calculate ───────────────────────────────────────────────────────

/// Calculate a single OATH code.
pub async fn calculate(
    ykman: &str,
    serial: Option<u32>,
    credential_id: &str,
) -> Result<OathCode, String> {
    let output = run_ykman(ykman, serial, &["oath", "accounts", "code", credential_id]).await?;

    // Output format: "Issuer:Name  123456"
    let code = output
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.rsplitn(2, char::is_whitespace).collect();
            if !parts.is_empty() {
                Some(parts[0].trim().to_string())
            } else {
                None
            }
        })
        .next()
        .unwrap_or_default();

    let now = chrono::Utc::now().timestamp() as u64;
    let period = 30u64;
    let valid_from = (now / period) * period;

    Ok(OathCode {
        code,
        valid_from,
        valid_to: valid_from + period,
        touch_required: false,
    })
}

/// Calculate all OATH codes at once.
pub async fn calculate_all(
    ykman: &str,
    serial: Option<u32>,
) -> Result<Vec<(OathAccount, OathCode)>, String> {
    let output = run_ykman(ykman, serial, &["oath", "accounts", "code"]).await?;

    let now = chrono::Utc::now().timestamp() as u64;
    let period = 30u64;
    let valid_from = (now / period) * period;

    let mut results = Vec::new();

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // "Issuer:Name  CODE" or "Name  CODE"
        let parts: Vec<&str> = trimmed.rsplitn(2, char::is_whitespace).collect();
        if parts.len() < 2 {
            continue;
        }
        let code_str = parts[0].trim();
        let id_str = parts[1].trim();

        let (issuer, name) = if let Some((i, n)) = id_str.split_once(':') {
            (i.to_string(), n.to_string())
        } else {
            (String::new(), id_str.to_string())
        };

        let account = OathAccount {
            issuer,
            name,
            oath_type: OathType::Totp,
            algorithm: OathAlgorithm::Sha1,
            digits: if code_str.len() == 8 { 8 } else { 6 },
            period: 30,
            touch_required: false,
            credential_id: id_str.to_string(),
        };

        let code = OathCode {
            code: code_str.to_string(),
            valid_from,
            valid_to: valid_from + period,
            touch_required: false,
        };

        results.push((account, code));
    }

    Ok(results)
}

// ── Password ────────────────────────────────────────────────────────

/// Set a password for the OATH applet.
pub async fn set_password(
    ykman: &str,
    serial: Option<u32>,
    password: &str,
) -> Result<bool, String> {
    run_ykman(ykman, serial, &["oath", "access", "change", "-n", password]).await?;
    info!("OATH password set");
    Ok(true)
}

/// Remove the OATH applet password.
pub async fn remove_password(ykman: &str, serial: Option<u32>) -> Result<bool, String> {
    run_ykman(ykman, serial, &["oath", "access", "change", "-c", "-f"]).await?;
    info!("OATH password removed");
    Ok(true)
}

/// Reset the OATH applet (deletes all accounts and password).
pub async fn reset_oath(ykman: &str, serial: Option<u32>) -> Result<bool, String> {
    run_ykman(ykman, serial, &["oath", "reset", "-f"]).await?;
    info!("OATH applet reset");
    Ok(true)
}

// ── Tests ───────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_account_list_basic() {
        let output = "GitHub:alice  TOTP  SHA256  6  30s\nAWS:bob  TOTP  SHA1  6  30s  touch\n";
        let accounts = parse_account_list(output);
        assert_eq!(accounts.len(), 2);
        assert_eq!(accounts[0].issuer, "GitHub");
        assert_eq!(accounts[0].name, "alice");
        assert_eq!(accounts[0].algorithm, OathAlgorithm::Sha256);
        assert_eq!(accounts[1].issuer, "AWS");
        assert!(accounts[1].touch_required);
    }

    #[test]
    fn test_parse_account_list_no_issuer() {
        let output = "user@example.com  TOTP  SHA1  6  30s\n";
        let accounts = parse_account_list(output);
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].issuer, "");
        assert_eq!(accounts[0].name, "user@example.com");
    }

    #[test]
    fn test_parse_account_list_hotp() {
        let output = "Service:counter  HOTP  SHA1  6\n";
        let accounts = parse_account_list(output);
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].oath_type, OathType::Hotp);
    }

    #[test]
    fn test_parse_account_list_empty() {
        let accounts = parse_account_list("");
        assert!(accounts.is_empty());
    }

    #[test]
    fn test_parse_account_list_8digits() {
        let output = "Steam:user  TOTP  SHA1  8  30s\n";
        let accounts = parse_account_list(output);
        assert_eq!(accounts[0].digits, 8);
    }
}
