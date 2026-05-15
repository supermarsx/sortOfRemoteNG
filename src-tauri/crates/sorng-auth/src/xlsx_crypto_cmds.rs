use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

use super::xlsx_crypto::{decrypt_xlsx, encrypt_xlsx};

/// Encrypt an OOXML payload (xlsx/docx/pptx zip bytes) with the Agile
/// Encryption scheme. Input/output are base64 strings so the IPC bridge
/// can carry the binary payload through JSON.
#[tauri::command]
pub async fn crypto_xlsx_encrypt(
    payload_base64: String,
    password: String,
) -> Result<String, String> {
    let plaintext = BASE64
        .decode(payload_base64.as_bytes())
        .map_err(|e| format!("xlsx encrypt: invalid base64 input: {e}"))?;
    let encrypted = encrypt_xlsx(&plaintext, &password)?;
    Ok(BASE64.encode(encrypted))
}

/// Decrypt an Agile-encrypted OOXML CFB container, returning the plaintext
/// zip bytes as base64.
#[tauri::command]
pub async fn crypto_xlsx_decrypt(
    ciphertext_base64: String,
    password: String,
) -> Result<String, String> {
    let ciphertext = BASE64
        .decode(ciphertext_base64.as_bytes())
        .map_err(|e| format!("xlsx decrypt: invalid base64 input: {e}"))?;
    let decrypted = decrypt_xlsx(&ciphertext, &password)?;
    Ok(BASE64.encode(decrypted))
}
