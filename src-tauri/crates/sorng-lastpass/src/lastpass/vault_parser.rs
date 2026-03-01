use crate::lastpass::crypto;
use crate::lastpass::types::{Account, CustomField, CustomFieldType, LastPassError, VaultBlob};

/// Parse a vault blob into decrypted accounts.
///
/// The LastPass vault blob is a binary format consisting of chunks.
/// Each chunk has a 4-byte ID, 4-byte big-endian size, and size bytes of data.
/// Account data is in ACCT chunks, folder data is in various other chunks.
pub fn parse_vault(blob: &VaultBlob, key: &[u8]) -> Result<Vec<Account>, LastPassError> {
    let data = &blob.data;
    let mut accounts = Vec::new();
    let mut pos = 0;

    while pos + 8 <= data.len() {
        let chunk_id = &data[pos..pos + 4];
        let chunk_size = u32::from_be_bytes([
            data[pos + 4],
            data[pos + 5],
            data[pos + 6],
            data[pos + 7],
        ]) as usize;
        pos += 8;

        if pos + chunk_size > data.len() {
            break;
        }

        let chunk_data = &data[pos..pos + chunk_size];
        pos += chunk_size;

        if chunk_id == b"ACCT" {
            match parse_account_chunk(chunk_data, key) {
                Ok(account) => accounts.push(account),
                Err(_) => continue, // skip unparseable accounts
            }
        }
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

    let pwprotect = fields
        .get(24)
        .map(|f| f == b"1")
        .unwrap_or(false);

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
        let size = u32::from_be_bytes([data[pos], data[pos + 1], data[pos + 2], data[pos + 3]])
            as usize;
        pos += 4;

        if pos + size > data.len() {
            break;
        }

        fields.push(data[pos..pos + size].to_vec());
        pos += size;
    }

    Ok(fields)
}

/// Decrypt a chunk field (binary data) using the encryption key.
fn decrypt_chunk_field(data: &[u8], key: &[u8]) -> Result<String, LastPassError> {
    if data.is_empty() {
        return Ok(String::new());
    }

    // If the first byte is '!' and length > 32, it's AES-CBC
    if data.len() > 32 && data[0] == b'!' {
        let iv = &data[1..17];
        let ciphertext = &data[17..];
        let plaintext = crypto::decrypt_aes_cbc(ciphertext, key, iv)?;
        String::from_utf8(plaintext)
            .map_err(|e| LastPassError::decryption_error(format!("Invalid UTF-8: {}", e)))
    } else if data.len() > 0 && data.len() % 16 == 0 {
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
    let mut folders = Vec::new();
    let mut pos = 0;

    while pos + 8 <= data.len() {
        let chunk_id = &data[pos..pos + 4];
        let chunk_size = u32::from_be_bytes([
            data[pos + 4],
            data[pos + 5],
            data[pos + 6],
            data[pos + 7],
        ]) as usize;
        pos += 8;

        if pos + chunk_size > data.len() {
            break;
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
                    folders.push(FolderEntry { name, is_shared });
                }
            }
        } else if chunk_id == b"SHAR" {
            if let Ok(fields) = parse_chunk_fields(chunk_data) {
                let id = fields
                    .first()
                    .map(|f| String::from_utf8_lossy(f).to_string())
                    .unwrap_or_default();
                let name = fields
                    .get(2)
                    .map(|f| decrypt_chunk_field(f, key).unwrap_or_default())
                    .unwrap_or_default();
                if !name.is_empty() {
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
