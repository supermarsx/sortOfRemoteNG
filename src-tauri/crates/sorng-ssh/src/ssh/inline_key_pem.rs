//! Bounded legacy PEM envelope compatibility, using RustCrypto ciphers.
//! EVP's MD5 derivation is only used for explicitly encrypted legacy PEM.
//! It is never chosen for new key storage or SSH signature negotiation.
use super::inline_key::{Result, ERROR, MAX_KEY};
use base64::{engine::general_purpose::STANDARD, Engine};
use cbc::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use md5::{Digest, Md5};
use zeroize::Zeroizing;

pub(super) fn decode(pem: &str, password: Option<&str>) -> Result<(String, Zeroizing<Vec<u8>>)> {
    if pem.len() > MAX_KEY || pem.as_bytes().contains(&0) {
        return Err(ERROR);
    }
    let mut lines = pem.lines();
    let first = lines.next().ok_or(ERROR)?;
    let label = first
        .strip_prefix("-----BEGIN ")
        .and_then(|s| s.strip_suffix("-----"))
        .ok_or(ERROR)?;
    if !matches!(
        label,
        "RSA PRIVATE KEY" | "DSA PRIVATE KEY" | "EC PRIVATE KEY"
    ) {
        return Err(ERROR);
    }
    let footer = format!("-----END {label}-----");
    let mut body = Zeroizing::new(String::new());
    let mut cipher = None;
    let mut encrypted = false;
    let mut ended = false;
    for line in lines {
        if ended {
            if !line.trim().is_empty() {
                return Err(ERROR);
            }
            continue;
        }
        if line == footer {
            ended = true;
            continue;
        }
        if line == "Proc-Type: 4,ENCRYPTED" && body.is_empty() && !encrypted && cipher.is_none() {
            encrypted = true;
            continue;
        }
        if let Some(value) = line.strip_prefix("DEK-Info: ") {
            if !encrypted || cipher.is_some() || !body.is_empty() {
                return Err(ERROR);
            }
            cipher = Some(value.split_once(',').ok_or(ERROR)?);
            continue;
        }
        if line.is_empty() && body.is_empty() {
            continue;
        }
        if !line
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"+/=".contains(&b))
        {
            return Err(ERROR);
        }
        body.push_str(line);
    }
    if !ended || encrypted != cipher.is_some() {
        return Err(ERROR);
    }
    let mut bytes = Zeroizing::new(STANDARD.decode(body.as_bytes()).map_err(|_| ERROR)?);
    if let Some((name, iv_hex)) = cipher {
        let (key_len, iv_len) = match name {
            "AES-128-CBC" => (16, 16),
            "AES-192-CBC" => (24, 16),
            "AES-256-CBC" => (32, 16),
            "DES-EDE3-CBC" => (24, 8),
            "DES-CBC" => (8, 8),
            _ => return Err(ERROR),
        };
        if iv_hex.len() != iv_len * 2 {
            return Err(ERROR);
        }
        let iv = hex::decode(iv_hex).map_err(|_| ERROR)?;
        let password = password.ok_or(ERROR)?;
        if password.len() > MAX_KEY {
            return Err(ERROR);
        }
        // OpenSSL's legacy PEM EVP_BytesToKey: D_i=MD5(D_(i-1)||password||IV[..8]).
        // Fixed work, at most two digests; outputs and decrypted material zeroize.
        let mut key = Zeroizing::new(Vec::with_capacity(32));
        let mut previous = Zeroizing::new(Vec::<u8>::new());
        while key.len() < key_len {
            let mut digest = Md5::new();
            digest.update(previous.as_slice());
            digest.update(password.as_bytes());
            digest.update(&iv[..8]);
            previous = Zeroizing::new(digest.finalize().to_vec());
            key.extend_from_slice(&previous);
        }
        key.truncate(key_len);
        macro_rules! decrypt {
            ($cipher:ty) => {
                cbc::Decryptor::<$cipher>::new_from_slices(&key, &iv)
                    .map_err(|_| ERROR)?
                    .decrypt_padded_mut::<Pkcs7>(&mut bytes)
                    .map_err(|_| ERROR)?
                    .len()
            };
        }
        let length = match name {
            "AES-128-CBC" => decrypt!(aes::Aes128),
            "AES-192-CBC" => decrypt!(aes::Aes192),
            "AES-256-CBC" => decrypt!(aes::Aes256),
            "DES-EDE3-CBC" => decrypt!(des::TdesEde3),
            "DES-CBC" => decrypt!(des::Des),
            _ => return Err(ERROR),
        };
        bytes.truncate(length);
    }
    Ok((label.to_owned(), bytes))
}
