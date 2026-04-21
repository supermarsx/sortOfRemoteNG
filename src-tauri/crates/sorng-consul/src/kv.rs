// ── sorng-consul – Key/Value store operations ───────────────────────────────
//! Manages Consul's KV store: get, put, delete, list, CAS, lock/unlock.

use crate::client::ConsulClient;
use crate::error::{ConsulError, ConsulResult};
use crate::types::*;
use log::debug;

/// Manages operations on the Consul KV store.
pub struct ConsulKvManager;

impl ConsulKvManager {
    // ── Read ────────────────────────────────────────────────────────

    /// GET /v1/kv/:key — returns the decoded value for a single key.
    pub async fn get_key(client: &ConsulClient, key: &str) -> ConsulResult<ConsulKeyValue> {
        let path = format!("/v1/kv/{}", encode_key(key));
        let entries: Vec<RawKvEntry> = client.get(&path).await.map_err(|e| match e.kind {
            crate::error::ConsulErrorKind::NotFound => {
                ConsulError::not_found(format!("Key not found: {key}"))
            }
            _ => e,
        })?;
        let raw = entries
            .into_iter()
            .next()
            .ok_or_else(|| ConsulError::not_found(format!("Key not found: {key}")))?;
        Ok(decode_kv_entry(raw))
    }

    /// GET /v1/kv/:key?keys — returns just the list of key names under a prefix.
    pub async fn list_keys(client: &ConsulClient, prefix: &str) -> ConsulResult<Vec<String>> {
        let path = format!("/v1/kv/{}", encode_key(prefix));
        let keys: Vec<String> = client
            .get_with_params(&path, &[("keys", "true")])
            .await
            .unwrap_or_default();
        Ok(keys)
    }

    /// GET /v1/kv/:prefix?recurse — returns the full tree of KV entries.
    pub async fn get_tree(
        client: &ConsulClient,
        prefix: &str,
    ) -> ConsulResult<Vec<ConsulKeyValue>> {
        let path = format!("/v1/kv/{}", encode_key(prefix));
        let entries: Vec<RawKvEntry> = client
            .get_with_params(&path, &[("recurse", "true")])
            .await
            .unwrap_or_default();
        Ok(entries.into_iter().map(decode_kv_entry).collect())
    }

    /// GET /v1/kv/:key — returns metadata only (no value decode needed).
    pub async fn get_key_metadata(
        client: &ConsulClient,
        key: &str,
    ) -> ConsulResult<ConsulKeyMetadata> {
        let path = format!("/v1/kv/{}", encode_key(key));
        let entries: Vec<RawKvEntry> = client.get(&path).await.map_err(|e| match e.kind {
            crate::error::ConsulErrorKind::NotFound => {
                ConsulError::not_found(format!("Key not found: {key}"))
            }
            _ => e,
        })?;
        let raw = entries
            .into_iter()
            .next()
            .ok_or_else(|| ConsulError::not_found(format!("Key not found: {key}")))?;
        Ok(ConsulKeyMetadata {
            key: raw.key,
            flags: raw.flags,
            lock_index: raw.lock_index,
            session: raw.session,
            create_index: raw.create_index,
            modify_index: raw.modify_index,
        })
    }

    // ── Write ───────────────────────────────────────────────────────

    /// PUT /v1/kv/:key — sets the value for a key. Returns true on success.
    pub async fn put_key(client: &ConsulClient, key: &str, value: &str) -> ConsulResult<bool> {
        let path = format!("/v1/kv/{}", encode_key(key));
        debug!("CONSUL KV PUT {key}");
        client.put_raw(&path, value).await
    }

    /// PUT /v1/kv/:key?cas=:index — check-and-set: only writes if `modify_index` matches.
    pub async fn cas_key(
        client: &ConsulClient,
        key: &str,
        value: &str,
        modify_index: u64,
    ) -> ConsulResult<bool> {
        let path = format!("/v1/kv/{}", encode_key(key));
        let cas_str = modify_index.to_string();
        debug!("CONSUL KV CAS {key} @{modify_index}");
        client
            .put_raw_with_params(&path, value, &[("cas", &cas_str)])
            .await
    }

    /// PUT /v1/kv/:key?acquire=:session — acquire a lock on the key.
    pub async fn lock_key(
        client: &ConsulClient,
        key: &str,
        session: &str,
        value: &str,
    ) -> ConsulResult<bool> {
        let path = format!("/v1/kv/{}", encode_key(key));
        debug!("CONSUL KV LOCK {key} session={session}");
        client
            .put_raw_with_params(&path, value, &[("acquire", session)])
            .await
    }

    /// PUT /v1/kv/:key?release=:session — release the lock on the key.
    pub async fn unlock_key(
        client: &ConsulClient,
        key: &str,
        session: &str,
        value: &str,
    ) -> ConsulResult<bool> {
        let path = format!("/v1/kv/{}", encode_key(key));
        debug!("CONSUL KV UNLOCK {key} session={session}");
        client
            .put_raw_with_params(&path, value, &[("release", session)])
            .await
    }

    // ── Delete ──────────────────────────────────────────────────────

    /// DELETE /v1/kv/:key — deletes a single key.
    pub async fn delete_key(client: &ConsulClient, key: &str) -> ConsulResult<bool> {
        let path = format!("/v1/kv/{}", encode_key(key));
        debug!("CONSUL KV DELETE {key}");
        client.delete_bool(&path).await
    }
}

// ── helpers ──────────────────────────────────────────────────────────────────

/// Decode a raw KV entry from Consul. Values are base64-encoded by the API.
fn decode_kv_entry(raw: RawKvEntry) -> ConsulKeyValue {
    let decoded_value = raw.value.as_deref().and_then(|v| {
        // Consul returns base64-encoded values
        base64_decode(v).ok()
    });
    ConsulKeyValue {
        key: raw.key,
        value: decoded_value,
        flags: Some(raw.flags),
        session: raw.session,
        lock_index: Some(raw.lock_index),
        create_index: Some(raw.create_index),
        modify_index: Some(raw.modify_index),
    }
}

/// Decode a base64 string to UTF-8 text.
fn base64_decode(input: &str) -> Result<String, String> {
    // Manual base64 decode (no extra dependency)
    let chars: Vec<u8> = input.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    let mut bytes = Vec::with_capacity(chars.len() * 3 / 4);
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;
    for c in chars {
        let val = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => continue,
            _ => return Err(format!("Invalid base64 char: {c}")),
        };
        buf = (buf << 6) | val as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            bytes.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    String::from_utf8(bytes).map_err(|e| format!("UTF-8 decode: {e}"))
}

/// URL-encode a key path, preserving `/` separators.
fn encode_key(key: &str) -> String {
    key.split('/')
        .map(|seg| {
            seg.replace('%', "%25")
                .replace(' ', "%20")
                .replace('#', "%23")
                .replace('&', "%26")
                .replace('?', "%3F")
        })
        .collect::<Vec<_>>()
        .join("/")
}
