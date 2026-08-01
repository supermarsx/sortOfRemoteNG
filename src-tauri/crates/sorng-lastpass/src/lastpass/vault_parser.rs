use crate::lastpass::crypto;
use crate::lastpass::types::{Account, LastPassError, VaultBlob};

const MAX_VAULT_BYTES: usize = 64 * 1024 * 1024;
const MAX_CHUNK_BYTES: usize = 8 * 1024 * 1024;
const MAX_FIELD_BYTES: usize = 4 * 1024 * 1024;
const MAX_FIELDS_PER_CHUNK: usize = 128;
const MAX_ACCOUNTS: usize = 50_000;
const MAX_FOLDERS: usize = 50_000;

/// Parse a vault blob into decrypted accounts.
///
/// The LastPass vault blob is a binary format consisting of chunks.
/// Each chunk has a 4-byte ID, 4-byte big-endian size, and size bytes of data.
/// Account data is in ACCT chunks, folder data is in various other chunks.
pub fn parse_vault(blob: &VaultBlob, key: &[u8]) -> Result<Vec<Account>, LastPassError> {
    let data = &blob.data;
    if data.len() > MAX_VAULT_BYTES {
        return Err(LastPassError::vault_parse_error(
            "Vault exceeds the configured safety limit",
        ));
    }
    let mut accounts = Vec::new();
    let mut pos = 0;

    while pos + 8 <= data.len() {
        let chunk_id = &data[pos..pos + 4];
        let chunk_size =
            u32::from_be_bytes([data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7]])
                as usize;
        pos += 8;

        if chunk_size > MAX_CHUNK_BYTES
            || pos
                .checked_add(chunk_size)
                .is_none_or(|end| end > data.len())
        {
            return Err(LastPassError::vault_parse_error(
                "Vault contains an invalid chunk",
            ));
        }

        let chunk_data = &data[pos..pos + chunk_size];
        pos += chunk_size;

        if chunk_id == b"ACCT" {
            if accounts.len() >= MAX_ACCOUNTS {
                return Err(LastPassError::vault_parse_error(
                    "Vault account count exceeds the safety limit",
                ));
            }
            accounts.push(parse_account_chunk(chunk_data, key)?);
        }
    }

    if pos != data.len() && data[pos..].iter().any(|byte| *byte != 0) {
        return Err(LastPassError::vault_parse_error(
            "Vault contains trailing malformed data",
        ));
    }

    Ok(accounts)
}

/// Parse a single ACCT chunk into an Account.
fn parse_account_chunk(data: &[u8], key: &[u8]) -> Result<Account, LastPassError> {
    let fields = parse_chunk_fields(data)?;

    // ACCT chunk fields (indices):
    // 0: id, 1: name, 2: group, 3: url, 4: notes, 5: fav,
    // 6: sharedfromaid, 7: username, 8: password, 9-...: more fields

    let get_field = |idx: usize| -> String {
        fields
            .get(idx)
            .map(|f| decrypt_chunk_field(f, key).unwrap_or_default())
            .unwrap_or_default()
    };

    let get_raw_field = |idx: usize| -> String {
        fields
            .get(idx)
            .map(|f| String::from_utf8_lossy(f).to_string())
            .unwrap_or_default()
    };

    let id = get_raw_field(0);
    let name = get_field(1);
    let group = get_field(2);
    let url_hex = get_raw_field(3);
    let url = hex::decode(&url_hex)
        .map(|b| String::from_utf8_lossy(&b).to_string())
        .unwrap_or(url_hex);
    let notes = get_field(4);
    let fav = get_raw_field(5);
    let username = get_field(7);
    let password = get_field(8);

    let pwprotect = fields.get(24).map(|f| f == b"1").unwrap_or(false);

    let last_modified = fields.get(18).and_then(|f| {
        let s = String::from_utf8_lossy(f);
        if s.is_empty() || s == "0" {
            None
        } else {
            Some(s.to_string())
        }
    });

    let last_touched = fields.get(20).and_then(|f| {
        let s = String::from_utf8_lossy(f);
        if s.is_empty() || s == "0" {
            None
        } else {
            Some(s.to_string())
        }
    });

    let totp_secret = fields.get(30).and_then(|f| {
        let decrypted = decrypt_chunk_field(f, key).ok()?;
        if decrypted.is_empty() {
            None
        } else {
            Some(decrypted)
        }
    });

    Ok(Account {
        id,
        name,
        url,
        username,
        password,
        notes,
        group: group.clone(),
        folder_id: if group.is_empty() { None } else { Some(group) },
        favorite: fav == "1",
        auto_login: false,
        never_autofill: false,
        realm: None,
        totp_secret,
        last_modified,
        last_touched,
        pwprotect,
        custom_fields: Vec::new(),
    })
}

/// Split a chunk into sub-fields. Fields are separated by a 4-byte big-endian size prefix.
fn parse_chunk_fields(data: &[u8]) -> Result<Vec<Vec<u8>>, LastPassError> {
    let mut fields = Vec::new();
    let mut pos = 0;

    while pos + 4 <= data.len() {
        let size =
            u32::from_be_bytes([data[pos], data[pos + 1], data[pos + 2], data[pos + 3]]) as usize;
        pos += 4;

        if fields.len() >= MAX_FIELDS_PER_CHUNK
            || size > MAX_FIELD_BYTES
            || pos.checked_add(size).is_none_or(|end| end > data.len())
        {
            return Err(LastPassError::vault_parse_error(
                "Vault item contains an invalid field",
            ));
        }

        fields.push(data[pos..pos + size].to_vec());
        pos += size;
    }

    if pos != data.len() {
        return Err(LastPassError::vault_parse_error(
            "Vault item contains malformed trailing data",
        ));
    }

    Ok(fields)
}

/// Decrypt a chunk field (binary data) using the encryption key.
fn decrypt_chunk_field(data: &[u8], key: &[u8]) -> Result<String, LastPassError> {
    if data.is_empty() {
        return Ok(String::new());
    }
    if data.len() > MAX_FIELD_BYTES {
        return Err(LastPassError::vault_parse_error(
            "Vault field exceeds the safety limit",
        ));
    }

    // If the first byte is '!' and length > 32, it's AES-CBC
    if data.len() > 32 && data[0] == b'!' {
        let iv = &data[1..17];
        let ciphertext = &data[17..];
        let plaintext = crypto::decrypt_aes_cbc(ciphertext, key, iv)?;
        String::from_utf8(plaintext)
            .map_err(|e| LastPassError::decryption_error(format!("Invalid UTF-8: {}", e)))
    } else if !data.is_empty() && data.len().is_multiple_of(16) {
        // AES-ECB
        let plaintext = crypto::decrypt_aes_ecb(data, key)?;
        String::from_utf8(plaintext)
            .map_err(|e| LastPassError::decryption_error(format!("Invalid UTF-8: {}", e)))
    } else {
        // Plain text
        Ok(String::from_utf8_lossy(data).to_string())
    }
}

/// Extract folders from the vault blob.
pub fn parse_folders(blob: &VaultBlob, key: &[u8]) -> Result<Vec<FolderEntry>, LastPassError> {
    let data = &blob.data;
    if data.len() > MAX_VAULT_BYTES {
        return Err(LastPassError::vault_parse_error(
            "Vault exceeds the configured safety limit",
        ));
    }
    let mut folders = Vec::new();
    let mut pos = 0;

    while pos + 8 <= data.len() {
        let chunk_id = &data[pos..pos + 4];
        let chunk_size =
            u32::from_be_bytes([data[pos + 4], data[pos + 5], data[pos + 6], data[pos + 7]])
                as usize;
        pos += 8;

        if chunk_size > MAX_CHUNK_BYTES
            || pos
                .checked_add(chunk_size)
                .is_none_or(|end| end > data.len())
        {
            return Err(LastPassError::vault_parse_error(
                "Vault contains an invalid folder chunk",
            ));
        }

        let chunk_data = &data[pos..pos + chunk_size];
        pos += chunk_size;

        if chunk_id == b"LPFF" {
            if let Ok(fields) = parse_chunk_fields(chunk_data) {
                let name = fields
                    .first()
                    .map(|f| decrypt_chunk_field(f, key).unwrap_or_default())
                    .unwrap_or_default();
                let is_shared = false;
                if !name.is_empty() {
                    if folders.len() >= MAX_FOLDERS {
                        return Err(LastPassError::vault_parse_error(
                            "Vault folder count exceeds the safety limit",
                        ));
                    }
                    folders.push(FolderEntry { name, is_shared });
                }
            }
        } else if chunk_id == b"SHAR" {
            if let Ok(fields) = parse_chunk_fields(chunk_data) {
                let _id = fields
                    .first()
                    .map(|f| String::from_utf8_lossy(f).to_string())
                    .unwrap_or_default();
                let name = fields
                    .get(2)
                    .map(|f| decrypt_chunk_field(f, key).unwrap_or_default())
                    .unwrap_or_default();
                if !name.is_empty() {
                    if folders.len() >= MAX_FOLDERS {
                        return Err(LastPassError::vault_parse_error(
                            "Vault folder count exceeds the safety limit",
                        ));
                    }
                    folders.push(FolderEntry {
                        name,
                        is_shared: true,
                    });
                }
            }
        }
    }

    Ok(folders)
}

#[derive(Debug, Clone)]
pub struct FolderEntry {
    pub name: String,
    pub is_shared: bool,
}
