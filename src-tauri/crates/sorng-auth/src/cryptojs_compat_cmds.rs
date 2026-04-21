use super::cryptojs_compat::decrypt_cryptojs_to_string;

/// Decrypt a legacy `crypto-js`-format (AES-256-CBC + MD5 EVP_BytesToKey,
/// base64, `Salted__` header) ciphertext with the given password.
///
/// Used only as a backward-compatibility read path for encrypted
/// collections or encrypted JSON exports persisted before the WebCrypto
/// (AES-GCM + PBKDF2) migration. Returns the decrypted UTF-8 plaintext.
#[tauri::command]
pub async fn crypto_legacy_decrypt_cryptojs(
    ciphertext: String,
    password: String,
) -> Result<String, String> {
    decrypt_cryptojs_to_string(&ciphertext, &password)
}
