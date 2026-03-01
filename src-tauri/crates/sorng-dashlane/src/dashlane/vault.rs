use crate::dashlane::types::{DashlaneCredential, DashlaneError, VaultStats};

/// Parse vault transactions (JSON) into credentials.
pub fn parse_vault_transactions(
    transactions: &[serde_json::Value],
    _encryption_key: &[u8],
) -> Result<VaultData, DashlaneError> {
    let mut data = VaultData::default();

    for tx in transactions {
        let tx_type = tx
            .get("type")
            .and_then(|t| t.as_str())
            .unwrap_or("unknown");

        match tx_type {
            "AUTHENTIFIANT" => {
                if let Ok(cred) = parse_credential(tx) {
                    data.credentials.push(cred);
                }
            }
            "SECURENOTE" => {
                if let Ok(note) = parse_secure_note(tx) {
                    data.secure_notes.push(note);
                }
            }
            "PAYMENTMEANS_CREDITCARD" => {
                data.credit_cards_count += 1;
            }
            "BANKSTATEMENT" => {
                data.bank_accounts_count += 1;
            }
            "IDENTITY" => {
                data.identities_count += 1;
            }
            _ => {}
        }
    }

    Ok(data)
}

fn parse_credential(tx: &serde_json::Value) -> Result<DashlaneCredential, DashlaneError> {
    let content = tx.get("content").unwrap_or(tx);

    Ok(DashlaneCredential {
        id: get_str(content, "Id").unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        title: get_str(content, "Title").unwrap_or_default(),
        url: get_str(content, "Url").unwrap_or_default(),
        login: get_str(content, "Login").unwrap_or_default(),
        secondary_login: get_str(content, "SecondaryLogin"),
        password: get_str(content, "Password").unwrap_or_default(),
        notes: get_str(content, "Note"),
        category: get_str(content, "Category"),
        auto_login: content
            .get("AutoLogin")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        auto_protect: content
            .get("AutoProtected")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        otp_secret: get_str(content, "OtpSecret"),
        otp_url: get_str(content, "OtpUrl"),
        linked_services: content
            .get("LinkedServices")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default(),
        created_at: get_str(content, "CreationDatetime"),
        modified_at: get_str(content, "UserModificationDatetime"),
        last_used_at: get_str(content, "LastUse"),
        password_strength: content
            .get("Strength")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32),
        compromised: false,
        reused: false,
    })
}

fn parse_secure_note(tx: &serde_json::Value) -> Result<crate::dashlane::types::SecureNote, DashlaneError> {
    let content = tx.get("content").unwrap_or(tx);

    Ok(crate::dashlane::types::SecureNote {
        id: get_str(content, "Id").unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
        title: get_str(content, "Title").unwrap_or_default(),
        content: get_str(content, "Content").unwrap_or_default(),
        category: get_str(content, "Category"),
        secured: content
            .get("Secured")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        created_at: get_str(content, "CreationDatetime"),
        modified_at: get_str(content, "UserModificationDatetime"),
        color: None,
    })
}

fn get_str(value: &serde_json::Value, key: &str) -> Option<String> {
    value.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

#[derive(Debug, Clone, Default)]
pub struct VaultData {
    pub credentials: Vec<DashlaneCredential>,
    pub secure_notes: Vec<crate::dashlane::types::SecureNote>,
    pub credit_cards_count: u64,
    pub bank_accounts_count: u64,
    pub identities_count: u64,
}
