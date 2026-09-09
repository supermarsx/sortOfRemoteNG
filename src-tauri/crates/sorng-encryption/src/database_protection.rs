//! Versioned inner database protection. Independent of the outer master-key
//! envelope: cipher choice protects data, while slots wrap a random database key.
//! No platform prompts, vault access, or application paths live in this codec.

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::Aes256Gcm;
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD, Engine};
use chacha20poly1305::ChaCha20Poly1305;
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use zeroize::Zeroize;
pub use zeroize::Zeroizing;

use crate::password_wrap::Argon2Params;
use eax::cipher::{BlockClosure, BlockEncrypt, BlockSizeUser, KeySizeUser};

/// Serpent 0.5 accepts 16–32 byte keys, but advertises a 16-byte default key.
/// EAX uses the associated key size, so adapt only the type-level size; all key
/// scheduling and block operations remain in the unmodified RustCrypto cipher.
#[derive(Clone)]
struct Serpent256(serpent::Serpent);
impl KeySizeUser for Serpent256 {
    type KeySize = eax::aead::consts::U32;
}
impl BlockSizeUser for Serpent256 {
    type BlockSize = eax::aead::consts::U16;
}
impl eax::cipher::BlockCipher for Serpent256 {}
impl KeyInit for Serpent256 {
    fn new(key: &eax::cipher::Key<Self>) -> Self {
        Self(serpent::Serpent::new_from_slice(key).expect("Serpent accepts a fixed 32-byte key"))
    }
}
impl BlockEncrypt for Serpent256 {
    fn encrypt_with_backend(&self, operation: impl BlockClosure<BlockSize = Self::BlockSize>) {
        self.0.encrypt_with_backend(operation);
    }
}

pub const FORMAT: &str = "sorng-db";
pub const VERSION: u8 = 1;
pub const MAX_DATA_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_CONTAINER_BYTES: usize = 96 * 1024 * 1024;
pub const MAX_SLOTS: usize = 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DataCipher {
    #[serde(rename = "aes-256-gcm")]
    Aes256Gcm,
    #[serde(rename = "chacha20-poly1305")]
    Chacha20Poly1305,
    #[serde(rename = "twofish-256-eax")]
    Twofish256Eax,
    #[serde(rename = "serpent-256-eax")]
    Serpent256Eax,
}

impl DataCipher {
    pub const ALL: [Self; 4] = [
        Self::Aes256Gcm,
        Self::Chacha20Poly1305,
        Self::Twofish256Eax,
        Self::Serpent256Eax,
    ];
    fn nonce_len(self) -> usize {
        match self {
            Self::Aes256Gcm | Self::Chacha20Poly1305 => 12,
            Self::Twofish256Eax | Self::Serpent256Eax => 16,
        }
    }
    fn encrypt(
        self,
        key: &DatabaseKey,
        nonce: &[u8],
        payload: Payload<'_, '_>,
    ) -> Result<Vec<u8>, String> {
        if nonce.len() != self.nonce_len() {
            return Err("invalid data cipher nonce length".into());
        }
        match self {
            Self::Aes256Gcm => {
                Aes256Gcm::new((&*key.0).into()).encrypt(aes_gcm::Nonce::from_slice(nonce), payload)
            }
            Self::Chacha20Poly1305 => ChaCha20Poly1305::new((&*key.0).into())
                .encrypt(chacha20poly1305::Nonce::from_slice(nonce), payload),
            Self::Twofish256Eax => eax::Eax::<twofish::Twofish>::new((&*key.0).into()).encrypt(
                eax::Nonce::<eax::aead::consts::U16>::from_slice(nonce),
                payload,
            ),
            Self::Serpent256Eax => eax::Eax::<Serpent256>::new((&*key.0).into()).encrypt(
                eax::Nonce::<eax::aead::consts::U16>::from_slice(nonce),
                payload,
            ),
        }
        .map_err(|_| "encrypt managed database failed".into())
    }
    fn decrypt(
        self,
        key: &DatabaseKey,
        nonce: &[u8],
        payload: Payload<'_, '_>,
    ) -> Result<Vec<u8>, String> {
        if nonce.len() != self.nonce_len() {
            return Err("invalid data cipher nonce length".into());
        }
        match self {
            Self::Aes256Gcm => {
                Aes256Gcm::new((&*key.0).into()).decrypt(aes_gcm::Nonce::from_slice(nonce), payload)
            }
            Self::Chacha20Poly1305 => ChaCha20Poly1305::new((&*key.0).into())
                .decrypt(chacha20poly1305::Nonce::from_slice(nonce), payload),
            Self::Twofish256Eax => eax::Eax::<twofish::Twofish>::new((&*key.0).into()).decrypt(
                eax::Nonce::<eax::aead::consts::U16>::from_slice(nonce),
                payload,
            ),
            Self::Serpent256Eax => eax::Eax::<Serpent256>::new((&*key.0).into()).decrypt(
                eax::Nonce::<eax::aead::consts::U16>::from_slice(nonce),
                payload,
            ),
        }
        .map_err(|_| {
            "database authentication failed: wrong unlock secret or damaged container".into()
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SlotType {
    Password,
    OsVault,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotInfo {
    pub id: String,
    #[serde(rename = "type")]
    pub slot_type: SlotType,
    pub label: String,
    pub device_bound: bool,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
pub enum NewSlotInput {
    Password {
        label: String,
        password: String,
        argon2: Option<Argon2Params>,
    },
    OsVault {
        label: String,
    },
}

impl Drop for NewSlotInput {
    fn drop(&mut self) {
        if let Self::Password { password, .. } = self {
            password.zeroize();
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProtectionTarget {
    pub data_cipher: DataCipher,
    pub keep_slot_ids: Vec<String>,
    pub new_slots: Vec<NewSlotInput>,
}

/// Deliberately neither serializable nor Debug. Callers retain this native-only
/// zeroizing value in a revision/window/generation-bound unlock session.
pub struct DatabaseKey(Zeroizing<[u8; 32]>);
impl DatabaseKey {
    pub fn generate() -> Self {
        let mut key = Zeroizing::new([0u8; 32]);
        OsRng.fill_bytes(&mut *key);
        Self(key)
    }
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() != 32 {
            return Err("invalid database key length".into());
        }
        let mut key = Zeroizing::new([0u8; 32]);
        key.copy_from_slice(bytes);
        Ok(Self(key))
    }
    pub fn duplicate(&self) -> Self {
        Self(Zeroizing::new(*self.0))
    }
    pub fn with_bytes<T>(&self, use_key: impl FnOnce(&[u8; 32]) -> T) -> T {
        use_key(&self.0)
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PasswordKdf {
    params: Argon2Params,
    salt: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KeySlot {
    pub id: String,
    #[serde(rename = "type")]
    pub slot_type: SlotType,
    pub label: String,
    kdf: Option<PasswordKdf>,
    vault_binding: Option<String>,
    nonce: String,
    wrapped_key: String,
}

impl KeySlot {
    pub fn info(&self) -> SlotInfo {
        SlotInfo {
            id: self.id.clone(),
            slot_type: self.slot_type,
            label: self.label.clone(),
            device_bound: self.slot_type == SlotType::OsVault,
        }
    }
    fn validate(&self) -> Result<(), String> {
        validate_identifier(&self.id)?;
        validate_label(&self.label)?;
        decode_exact(&self.nonce, 12)?;
        decode_exact(&self.wrapped_key, 48)?;
        match self.slot_type {
            SlotType::Password => {
                let kdf = self.kdf.as_ref().ok_or("password slot KDF missing")?;
                kdf.params.validate().map_err(str::to_string)?;
                decode_exact(&kdf.salt, 16)?;
                if self.vault_binding.is_some() {
                    return Err("password slot has unexpected vault binding".into());
                }
            }
            SlotType::OsVault => {
                if self.kdf.is_some() {
                    return Err("vault slot has unexpected password KDF".into());
                }
                validate_identifier(
                    self.vault_binding
                        .as_deref()
                        .ok_or("vault binding missing")?,
                )?;
            }
        }
        Ok(())
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DatabaseEnvelope {
    format: String,
    version: u8,
    pub database_id: String,
    pub key_id: String,
    pub security_revision: String,
    pub data_cipher: DataCipher,
    pub slots: Vec<KeySlot>,
    nonce: String,
    ciphertext: String,
}

pub fn random_id() -> String {
    let mut bytes = [0u8; 24];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn validate_identifier(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("invalid database protection identifier".into());
    }
    Ok(())
}
fn validate_label(label: &str) -> Result<(), String> {
    if label.trim().is_empty() || label.len() > 128 || label.chars().any(char::is_control) {
        return Err("protector label must be 1–128 printable bytes".into());
    }
    Ok(())
}
fn decode_exact(value: &str, length: usize) -> Result<Vec<u8>, String> {
    if value.len() > length.div_ceil(3) * 4 {
        return Err("invalid protected field length".into());
    }
    let bytes = STANDARD
        .decode(value)
        .map_err(|_| "invalid protected field encoding")?;
    if bytes.len() != length {
        return Err("invalid protected field length".into());
    }
    Ok(bytes)
}
fn random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0u8; N];
    OsRng.fill_bytes(&mut bytes);
    bytes
}

fn password_key(password: &str, kdf: &PasswordKdf) -> Result<DatabaseKey, String> {
    if password.is_empty() || password.len() > 4096 {
        return Err("password must be 1–4096 bytes".into());
    }
    kdf.params.validate().map_err(str::to_string)?;
    let salt = decode_exact(&kdf.salt, 16)?;
    let params = Params::new(
        kdf.params.memory_kib,
        kdf.params.time_cost,
        kdf.params.parallelism,
        Some(32),
    )
    .map_err(|_| "invalid password KDF parameters")?;
    let mut key = Zeroizing::new([0u8; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), &salt, &mut *key)
        .map_err(|_| "database password derivation failed")?;
    Ok(DatabaseKey(key))
}

fn slot_aad(database_id: &str, key_id: &str, slot: &KeySlot) -> Result<Vec<u8>, String> {
    serde_json::to_vec(&(
        "sorng-db-slot-v1",
        database_id,
        key_id,
        &slot.id,
        slot.slot_type,
        &slot.label,
        &slot.kdf,
        &slot.vault_binding,
    ))
    .map_err(|_| "serialize slot context".into())
}

pub fn vault_account(
    profile_binding: &str,
    database_id: &str,
    key_id: &str,
    slot_id: &str,
) -> Result<String, String> {
    for id in [profile_binding, key_id, slot_id] {
        validate_identifier(id)?;
    }
    if database_id.is_empty() || database_id.len() > 128 {
        return Err("invalid database identity".into());
    }
    let input = serde_json::to_vec(&(
        "sorng-db-vault-v1",
        profile_binding,
        database_id,
        key_id,
        slot_id,
    ))
    .map_err(|_| "serialize vault binding")?;
    Ok(format!("database-slot-{:x}", Sha256::digest(input)))
}

pub fn new_password_slot(
    database_id: &str,
    key_id: &str,
    label: &str,
    password: &str,
    params: Option<Argon2Params>,
    key: &DatabaseKey,
) -> Result<KeySlot, String> {
    validate_label(label)?;
    let kdf = PasswordKdf {
        params: params.unwrap_or(Argon2Params::OWASP),
        salt: STANDARD.encode(random_bytes::<16>()),
    };
    let kek = password_key(password, &kdf)?;
    let mut slot = KeySlot {
        id: random_id(),
        slot_type: SlotType::Password,
        label: label.into(),
        kdf: Some(kdf),
        vault_binding: None,
        nonce: STANDARD.encode(random_bytes::<12>()),
        wrapped_key: String::new(),
    };
    wrap_slot(database_id, key_id, &mut slot, &kek, key)?;
    Ok(slot)
}

#[allow(clippy::too_many_arguments)]
pub fn new_vault_slot(
    database_id: &str,
    key_id: &str,
    slot_id: String,
    profile_binding: &str,
    label: &str,
    kek: &DatabaseKey,
    key: &DatabaseKey,
) -> Result<KeySlot, String> {
    validate_label(label)?;
    validate_identifier(profile_binding)?;
    validate_identifier(&slot_id)?;
    let mut slot = KeySlot {
        id: slot_id,
        slot_type: SlotType::OsVault,
        label: label.into(),
        kdf: None,
        vault_binding: Some(profile_binding.into()),
        nonce: STANDARD.encode(random_bytes::<12>()),
        wrapped_key: String::new(),
    };
    wrap_slot(database_id, key_id, &mut slot, kek, key)?;
    Ok(slot)
}

fn wrap_slot(
    database_id: &str,
    key_id: &str,
    slot: &mut KeySlot,
    kek: &DatabaseKey,
    key: &DatabaseKey,
) -> Result<(), String> {
    let nonce = decode_exact(&slot.nonce, 12)?;
    let aad = slot_aad(database_id, key_id, slot)?;
    let ciphertext = Aes256Gcm::new((&*kek.0).into())
        .encrypt(
            aes_gcm::Nonce::from_slice(&nonce),
            Payload {
                msg: &key.0[..],
                aad: &aad,
            },
        )
        .map_err(|_| "wrap database key failed")?;
    slot.wrapped_key = STANDARD.encode(ciphertext);
    Ok(())
}

/// Recognizes reserved managed envelopes even with unsupported versions so raw
/// legacy writers cannot overwrite them by pretending they are password blobs.
pub fn is_managed(value: &Value) -> bool {
    let Some(text) = value.as_str() else {
        return value.get("format").and_then(Value::as_str) == Some(FORMAT);
    };
    if text.len() > MAX_CONTAINER_BYTES {
        return true;
    }
    text.contains(FORMAT)
        || serde_json::from_str::<Value>(text)
            .ok()
            .and_then(|v| v.get("format").and_then(Value::as_str).map(str::to_owned))
            .as_deref()
            == Some(FORMAT)
}

impl DatabaseEnvelope {
    pub fn parse(value: &Value, database_id: &str) -> Result<Self, String> {
        let text = value
            .as_str()
            .ok_or("managed database must be a string envelope")?;
        if text.len() > MAX_CONTAINER_BYTES {
            return Err("managed database exceeds size limit".into());
        }
        let envelope: Self =
            serde_json::from_str(text).map_err(|_| "malformed or unsupported managed database")?;
        if envelope.format != FORMAT
            || envelope.version != VERSION
            || envelope.database_id != database_id
        {
            return Err("managed database format, version, or identity mismatch".into());
        }
        validate_identifier(&envelope.key_id)?;
        validate_identifier(&envelope.security_revision)?;
        if envelope.slots.is_empty() || envelope.slots.len() > MAX_SLOTS {
            return Err("managed database must have 1–8 unlock slots".into());
        }
        let mut ids = std::collections::BTreeSet::new();
        for slot in &envelope.slots {
            slot.validate()?;
            if !ids.insert(&slot.id) {
                return Err("duplicate database unlock slot".into());
            }
        }
        decode_exact(&envelope.nonce, envelope.data_cipher.nonce_len())?;
        if envelope.ciphertext.len() > (MAX_DATA_BYTES + 16).div_ceil(3) * 4 {
            return Err("managed ciphertext exceeds size limit".into());
        }
        Ok(envelope)
    }
    fn aad(&self) -> Result<Vec<u8>, String> {
        serde_json::to_vec(&(
            &self.format,
            self.version,
            &self.database_id,
            &self.key_id,
            &self.security_revision,
            self.data_cipher,
            &self.slots,
        ))
        .map_err(|_| "serialize managed database header".into())
    }
    pub fn create(
        database_id: &str,
        key_id: &str,
        security_revision: &str,
        data_cipher: DataCipher,
        slots: Vec<KeySlot>,
        data: &Value,
        key: &DatabaseKey,
    ) -> Result<Self, String> {
        let mut envelope = Self {
            format: FORMAT.into(),
            version: VERSION,
            database_id: database_id.into(),
            key_id: key_id.into(),
            security_revision: security_revision.into(),
            data_cipher,
            slots,
            nonce: String::new(),
            ciphertext: String::new(),
        };
        envelope.replace_data(data, key)?;
        Self::parse(&envelope.value()?, database_id)
    }
    pub fn value(&self) -> Result<Value, String> {
        serde_json::to_string(self)
            .map(Value::String)
            .map_err(|_| "serialize managed database".into())
    }
    pub fn replace_data(&mut self, data: &Value, key: &DatabaseKey) -> Result<(), String> {
        validate_data(data)?;
        let plaintext =
            Zeroizing::new(serde_json::to_vec(data).map_err(|_| "serialize database data")?);
        if plaintext.len() > MAX_DATA_BYTES {
            return Err("database plaintext exceeds size limit".into());
        }
        let nonce = random_bytes::<16>();
        let nonce = &nonce[..self.data_cipher.nonce_len()];
        let aad = self.aad()?;
        let payload = Payload {
            msg: &plaintext,
            aad: &aad,
        };
        let encrypted = self.data_cipher.encrypt(key, nonce, payload)?;
        self.nonce = STANDARD.encode(nonce);
        self.ciphertext = STANDARD.encode(encrypted);
        if self.open(key)? != *data {
            return Err("managed database verification failed".into());
        }
        Ok(())
    }
    pub fn open(&self, key: &DatabaseKey) -> Result<Value, String> {
        let nonce = decode_exact(&self.nonce, self.data_cipher.nonce_len())?;
        let ciphertext = STANDARD
            .decode(&self.ciphertext)
            .map_err(|_| "invalid ciphertext encoding")?;
        let aad = self.aad()?;
        let payload = Payload {
            msg: &ciphertext,
            aad: &aad,
        };
        let plaintext = self.data_cipher.decrypt(key, &nonce, payload)?;
        let plaintext = Zeroizing::new(plaintext);
        if plaintext.len() > MAX_DATA_BYTES {
            return Err("database plaintext exceeds size limit".into());
        }
        let value = serde_json::from_slice(&plaintext)
            .map_err(|_| "managed database plaintext malformed")?;
        validate_data(&value)?;
        Ok(value)
    }
    pub fn slot(&self, id: &str) -> Result<&KeySlot, String> {
        self.slots
            .iter()
            .find(|s| s.id == id)
            .ok_or_else(|| "database unlock slot not found".into())
    }
    pub fn unlock_password(&self, slot_id: &str, password: &str) -> Result<DatabaseKey, String> {
        let slot = self.slot(slot_id)?;
        if slot.slot_type != SlotType::Password {
            return Err("selected slot is not password protected".into());
        }
        let kek = password_key(password, slot.kdf.as_ref().ok_or("password KDF missing")?)?;
        self.unwrap_slot(slot, &kek)
    }
    pub fn unlock_vault(
        &self,
        slot_id: &str,
        profile_binding: &str,
        kek: &DatabaseKey,
    ) -> Result<DatabaseKey, String> {
        let slot = self.slot(slot_id)?;
        if slot.slot_type != SlotType::OsVault
            || slot.vault_binding.as_deref() != Some(profile_binding)
        {
            return Err(
                "vault slot belongs to another profile; use a portable password slot".into(),
            );
        }
        self.unwrap_slot(slot, kek)
    }
    fn unwrap_slot(&self, slot: &KeySlot, kek: &DatabaseKey) -> Result<DatabaseKey, String> {
        let nonce = decode_exact(&slot.nonce, 12)?;
        let wrapped = decode_exact(&slot.wrapped_key, 48)?;
        let aad = slot_aad(&self.database_id, &self.key_id, slot)?;
        let bytes = Aes256Gcm::new((&*kek.0).into())
            .decrypt(
                aes_gcm::Nonce::from_slice(&nonce),
                Payload {
                    msg: &wrapped,
                    aad: &aad,
                },
            )
            .map_err(|_| "database unlock failed: wrong secret or damaged slot")?;
        let bytes = Zeroizing::new(bytes);
        let key = DatabaseKey::from_bytes(&bytes)?;
        self.open(&key)?;
        Ok(key)
    }
}

pub fn validate_data(value: &Value) -> Result<(), String> {
    if !value.is_object() || !value.get("connections").is_some_and(Value::is_array) {
        return Err("database data must be an object with a connections array".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn params() -> Argon2Params {
        Argon2Params {
            memory_kib: 8192,
            time_cost: 1,
            parallelism: 1,
        }
    }
    fn fixture(cipher: DataCipher) -> (DatabaseEnvelope, DatabaseKey, Value) {
        let key = DatabaseKey::generate();
        let slot = new_password_slot(
            "db",
            "key",
            "Recovery password",
            "test-only",
            Some(params()),
            &key,
        )
        .unwrap();
        let data = serde_json::json!({"connections":[{"id":"one","password":"fixture-only"}],"settings":{"preserve":true}});
        let envelope =
            DatabaseEnvelope::create("db", "key", "revision", cipher, vec![slot], &data, &key)
                .unwrap();
        (envelope, key, data)
    }
    #[test]
    fn wire_contract_uses_exact_cipher_and_protector_names() {
        for (cipher, name) in [
            (DataCipher::Aes256Gcm, "aes-256-gcm"),
            (DataCipher::Chacha20Poly1305, "chacha20-poly1305"),
            (DataCipher::Twofish256Eax, "twofish-256-eax"),
            (DataCipher::Serpent256Eax, "serpent-256-eax"),
        ] {
            assert_eq!(serde_json::to_value(cipher).unwrap(), name);
            assert_eq!(
                serde_json::from_value::<DataCipher>(name.into()).unwrap(),
                cipher
            );
        }
        assert!(serde_json::from_value::<DataCipher>("aes256-gcm".into()).is_err());
        assert!(serde_json::from_value::<NewSlotInput>(
            serde_json::json!({"type":"biometric","label":"fake"})
        )
        .is_err());
        assert!(serde_json::from_value::<NewSlotInput>(
            serde_json::json!({"type":"os-vault","label":"vault","password":"unexpected"})
        )
        .is_err());
        let (envelope, _, _) = fixture(DataCipher::Aes256Gcm);
        assert_eq!(
            serde_json::to_value(envelope.slots[0].info()).unwrap(),
            serde_json::json!({"id":envelope.slots[0].id,"type":"password","label":"Recovery password","deviceBound":false})
        );
    }
    #[test]
    fn all_ciphers_roundtrip_and_password_changes_never_expose_keys() {
        for cipher in DataCipher::ALL {
            let (mut envelope, key, data) = fixture(cipher);
            let parsed = DatabaseEnvelope::parse(&envelope.value().unwrap(), "db").unwrap();
            assert_eq!(
                STANDARD.decode(&parsed.nonce).unwrap().len(),
                cipher.nonce_len()
            );
            assert_eq!(STANDARD.decode(&parsed.slots[0].nonce).unwrap().len(), 12);
            let recovered = parsed
                .unlock_password(&parsed.slots[0].id, "test-only")
                .unwrap();
            assert_eq!(parsed.open(&recovered).unwrap(), data);
            assert!(parsed
                .unlock_password(&parsed.slots[0].id, "wrong")
                .is_err());
            let before = envelope.ciphertext.clone();
            envelope.replace_data(&data, &key).unwrap();
            assert_ne!(envelope.ciphertext, before);
            let slot = new_password_slot(
                "db",
                "key",
                "New password",
                "new-test-only",
                Some(params()),
                &key,
            )
            .unwrap();
            let changed = DatabaseEnvelope::create(
                "db",
                "key",
                "new-revision",
                cipher,
                vec![slot],
                &data,
                &key,
            )
            .unwrap();
            assert!(changed
                .unlock_password(&changed.slots[0].id, "test-only")
                .is_err());
            assert!(changed
                .unlock_password(&changed.slots[0].id, "new-test-only")
                .is_ok());
        }
    }
    #[test]
    fn authenticated_context_rejects_identity_cipher_revision_and_slot_tampering() {
        for cipher in DataCipher::ALL {
            let (envelope, key, _) = fixture(cipher);
            for field in [
                "databaseId",
                "keyId",
                "securityRevision",
                "dataCipher",
                "label",
                "salt",
                "nonce",
                "ciphertext",
            ] {
                let mut value = serde_json::to_value(&envelope).unwrap();
                match field {
                    "dataCipher" => {
                        value[field] = serde_json::to_value(match cipher {
                            DataCipher::Aes256Gcm => DataCipher::Chacha20Poly1305,
                            DataCipher::Chacha20Poly1305 => DataCipher::Aes256Gcm,
                            DataCipher::Twofish256Eax => DataCipher::Serpent256Eax,
                            DataCipher::Serpent256Eax => DataCipher::Twofish256Eax,
                        })
                        .unwrap()
                    }
                    "label" => value["slots"][0]["label"] = "tampered".into(),
                    "salt" => value["slots"][0]["kdf"]["salt"] = STANDARD.encode([9u8; 16]).into(),
                    "nonce" => {
                        value["nonce"] = STANDARD.encode(vec![9u8; cipher.nonce_len()]).into()
                    }
                    "ciphertext" => value["ciphertext"] = STANDARD.encode([9u8; 48]).into(),
                    _ => value[field] = "different".into(),
                }
                let tampered: DatabaseEnvelope = serde_json::from_value(value).unwrap();
                assert!(tampered.open(&key).is_err(), "{field}");
            }
            let mut missing = envelope.clone();
            missing.slots.clear();
            assert!(DatabaseEnvelope::parse(&missing.value().unwrap(), "db").is_err());
            let mut duplicate = envelope.clone();
            duplicate.slots.push(duplicate.slots[0].clone());
            assert!(DatabaseEnvelope::parse(&duplicate.value().unwrap(), "db").is_err());
            for nonce_len in [0, 11, 12, 15, 16, 17] {
                if nonce_len == cipher.nonce_len() {
                    continue;
                }
                let mut wrong_nonce = envelope.clone();
                wrong_nonce.nonce = STANDARD.encode(vec![0u8; nonce_len]);
                assert!(DatabaseEnvelope::parse(&wrong_nonce.value().unwrap(), "db").is_err());
                assert!(wrong_nonce.open(&key).is_err());
            }
        }
    }
    #[test]
    fn eax_matches_independent_bouncycastle_256_bit_vectors_and_rejects_tampering() {
        assert!(Serpent256::new_from_slice(&[0u8; 16]).is_err());
        assert!(Serpent256::new_from_slice(&[0u8; 24]).is_err());
        assert!(Serpent256::new_from_slice(&[0u8; 32]).is_ok());
        assert!(Serpent256::new_from_slice(&[0u8; 33]).is_err());
        fn bytes(value: &Value) -> Vec<u8> {
            let hex = value.as_str().unwrap();
            (0..hex.len())
                .step_by(2)
                .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
                .collect()
        }
        let fixture: Value = serde_json::from_str(include_str!(
            "../tests/fixtures/database-eax-bouncycastle-2.6.2.json"
        ))
        .unwrap();
        let vectors = fixture["vectors"].as_array().unwrap();
        assert_eq!(vectors.len(), 8);
        for vector in vectors {
            let cipher: DataCipher = serde_json::from_value(vector["algorithm"].clone()).unwrap();
            let key = DatabaseKey::from_bytes(&bytes(&vector["keyHex"])).unwrap();
            let nonce = bytes(&vector["nonceHex"]);
            let aad = bytes(&vector["aadHex"]);
            let plain = bytes(&vector["plaintextHex"]);
            let expected = bytes(&vector["ciphertextAndTagHex"]);
            assert_eq!(expected.len(), plain.len() + 16);
            assert_eq!(
                cipher
                    .encrypt(
                        &key,
                        &nonce,
                        Payload {
                            msg: &plain,
                            aad: &aad
                        }
                    )
                    .unwrap(),
                expected,
                "{} {}",
                vector["algorithm"],
                vector["name"]
            );
            assert_eq!(
                cipher
                    .decrypt(
                        &key,
                        &nonce,
                        Payload {
                            msg: &expected,
                            aad: &aad
                        }
                    )
                    .unwrap(),
                plain
            );
            for index in [0, expected.len() - 1] {
                let mut corrupt = expected.clone();
                corrupt[index] ^= 1;
                assert!(cipher
                    .decrypt(
                        &key,
                        &nonce,
                        Payload {
                            msg: &corrupt,
                            aad: &aad
                        }
                    )
                    .is_err());
            }
            let mut wrong_nonce = nonce.clone();
            wrong_nonce[0] ^= 1;
            assert!(cipher
                .decrypt(
                    &key,
                    &wrong_nonce,
                    Payload {
                        msg: &expected,
                        aad: &aad
                    }
                )
                .is_err());
            let mut wrong_aad = aad.clone();
            wrong_aad.push(0);
            assert!(cipher
                .decrypt(
                    &key,
                    &nonce,
                    Payload {
                        msg: &expected,
                        aad: &wrong_aad
                    }
                )
                .is_err());
            assert!(cipher
                .decrypt(
                    &DatabaseKey::generate(),
                    &nonce,
                    Payload {
                        msg: &expected,
                        aad: &aad
                    }
                )
                .is_err());
        }
    }
    #[test]
    fn malformed_versions_and_unbounded_kdfs_fail_before_derivation() {
        let (envelope, _, _) = fixture(DataCipher::Aes256Gcm);
        let mut value = serde_json::to_value(&envelope).unwrap();
        value["slots"][0]["kdf"]["params"]["memoryKib"] = u32::MAX.into();
        assert!(
            DatabaseEnvelope::parse(&serde_json::to_string(&value).unwrap().into(), "db").is_err()
        );
        let mut future = envelope.clone();
        future.version = 255;
        assert!(is_managed(&future.value().unwrap()));
        assert!(DatabaseEnvelope::parse(&future.value().unwrap(), "db").is_err());
        assert!(is_managed(&Value::String(
            "{\"format\":\"sorng-db\", broken".into()
        )));
        assert!(!is_managed(
            &serde_json::json!({"connections":[{"description":"sorng-db"}]})
        ));
        assert!(!is_managed(&Value::String("legacy.cipher.text".into())));
    }
    #[test]
    fn random_vault_slots_are_bound_to_profile_database_key_and_slot() {
        for cipher in DataCipher::ALL {
            let key = DatabaseKey::generate();
            let kek = DatabaseKey::generate();
            let slot = new_vault_slot(
                "db",
                "key",
                "slot".into(),
                "profile",
                "OS account",
                &kek,
                &key,
            )
            .unwrap();
            let envelope = DatabaseEnvelope::create(
                "db",
                "key",
                "rev",
                cipher,
                vec![slot],
                &serde_json::json!({"connections":[]}),
                &key,
            )
            .unwrap();
            assert!(envelope.unlock_vault("slot", "profile", &kek).is_ok());
            assert!(envelope.unlock_vault("slot", "other", &kek).is_err());
            assert!(envelope
                .unlock_vault("slot", "profile", &DatabaseKey::generate())
                .is_err());
            let baseline = vault_account("profile", "db", "key", "slot").unwrap();
            for (profile, db, key, slot) in [
                ("other", "db", "key", "slot"),
                ("profile", "other", "key", "slot"),
                ("profile", "db", "other", "slot"),
                ("profile", "db", "key", "other"),
            ] {
                assert_ne!(vault_account(profile, db, key, slot).unwrap(), baseline);
            }
        }
    }
}
