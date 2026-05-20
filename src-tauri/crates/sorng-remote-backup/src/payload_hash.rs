//! Canonical payload hashing for delta-verified backups.
//!
//! The delta-skip logic decides whether a scheduled backup tick is
//! redundant by comparing a stable hash of the *plaintext* payload to
//! whatever hash was recorded on the last successful run. Plaintext —
//! not ciphertext — because AES-GCM and friends use random IVs, so the
//! ciphertext drifts every encryption even when the input is identical.
//!
//! `payload_hash` accepts anything `Serialize`able and emits a SHA-256
//! hex string over a *canonical* serialization where object keys are
//! sorted lexicographically. Array element order is preserved as-is —
//! callers are responsible for handing us payloads whose arrays already
//! sort in a meaningful, repeatable way (typically by an `id` field).
//! That responsibility is enforced by the caller, not this module.
//!
//! Output is lowercase hex, prefixed with `sha256:` so future hash
//! algorithm changes can be migrated cleanly without ambiguity.

use sha2::{Digest, Sha256};

/// Hash a `Serialize` value into a canonical SHA-256 digest. Returns
/// a string of the form `sha256:<64-hex>` so we can introduce other
/// algorithms later without confusing already-stored hashes.
pub fn payload_hash<T>(value: &T) -> Result<String, PayloadHashError>
where
    T: serde::Serialize,
{
    let value = serde_json::to_value(value).map_err(PayloadHashError::Serialize)?;
    let mut hasher = Sha256::new();
    write_canonical(&value, &mut hasher);
    let digest = hasher.finalize();
    Ok(format!("sha256:{}", hex::encode(digest)))
}

/// Walk `value` and feed a canonical byte representation into `hasher`.
/// Object keys are emitted in sorted order; arrays preserve their
/// original order; primitives are emitted with type tags so a string
/// `"42"` can't collide with the integer `42`.
fn write_canonical(value: &serde_json::Value, hasher: &mut Sha256) {
    use serde_json::Value;
    match value {
        Value::Null => hasher.update(b"N"),
        Value::Bool(b) => {
            hasher.update(b"B");
            hasher.update(if *b { b"1" } else { b"0" });
        }
        Value::Number(n) => {
            hasher.update(b"#");
            // Numbers go through their JSON text form to keep f64 / i64
            // / u64 distinctions consistent with how they were serialised.
            hasher.update(n.to_string().as_bytes());
        }
        Value::String(s) => {
            hasher.update(b"S");
            hasher.update((s.len() as u64).to_le_bytes());
            hasher.update(s.as_bytes());
        }
        Value::Array(items) => {
            hasher.update(b"A");
            hasher.update((items.len() as u64).to_le_bytes());
            for item in items {
                write_canonical(item, hasher);
            }
        }
        Value::Object(map) => {
            hasher.update(b"O");
            // serde_json::Map without the `preserve_order` feature is a
            // BTreeMap whose iter() is already sorted, but call collect
            // and sort explicitly so the canonical contract doesn't
            // silently break if the workspace ever enables that feature.
            let mut entries: Vec<(&String, &Value)> = map.iter().collect();
            entries.sort_by(|a, b| a.0.cmp(b.0));
            hasher.update((entries.len() as u64).to_le_bytes());
            for (k, v) in entries {
                hasher.update((k.len() as u64).to_le_bytes());
                hasher.update(k.as_bytes());
                write_canonical(v, hasher);
            }
        }
    }
}

/// Errors the canonical hasher can surface. Serialization is the only
/// real failure mode — SHA-256 itself is infallible.
#[derive(Debug)]
pub enum PayloadHashError {
    /// `serde_json::to_value` failed (e.g. a Serialize impl returned an error).
    Serialize(serde_json::Error),
}

impl std::fmt::Display for PayloadHashError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Serialize(e) => {
                write!(f, "canonical hash: failed to serialise payload to JSON: {e}")
            }
        }
    }
}

impl std::error::Error for PayloadHashError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Serialize(e) => Some(e),
        }
    }
}

impl From<serde_json::Error> for PayloadHashError {
    fn from(e: serde_json::Error) -> Self {
        Self::Serialize(e)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Serialize;
    use std::collections::HashMap;

    #[test]
    fn deterministic_for_same_input() {
        let v = serde_json::json!({ "a": 1, "b": [2, 3], "c": "hello" });
        let h1 = payload_hash(&v).unwrap();
        let h2 = payload_hash(&v).unwrap();
        assert_eq!(h1, h2);
        assert!(h1.starts_with("sha256:"));
        assert_eq!(h1.len(), 7 + 64);
    }

    #[test]
    fn key_order_does_not_matter() {
        // Two JSON objects with the same keys in different declared
        // order must produce the same canonical hash.
        let a: serde_json::Value =
            serde_json::from_str(r#"{"a":1,"b":2,"c":3}"#).unwrap();
        let b: serde_json::Value =
            serde_json::from_str(r#"{"c":3,"a":1,"b":2}"#).unwrap();
        assert_eq!(payload_hash(&a).unwrap(), payload_hash(&b).unwrap());
    }

    #[test]
    fn nested_objects_canonicalise() {
        let a = serde_json::json!({ "outer": { "x": 1, "y": 2 } });
        let b: serde_json::Value =
            serde_json::from_str(r#"{"outer":{"y":2,"x":1}}"#).unwrap();
        assert_eq!(payload_hash(&a).unwrap(), payload_hash(&b).unwrap());
    }

    #[test]
    fn array_order_matters() {
        // Arrays are semantically ordered, so [1,2] and [2,1] must
        // produce different hashes — the caller's job to sort.
        let a = serde_json::json!([1, 2]);
        let b = serde_json::json!([2, 1]);
        assert_ne!(payload_hash(&a).unwrap(), payload_hash(&b).unwrap());
    }

    #[test]
    fn string_and_number_do_not_collide() {
        let s = serde_json::json!("42");
        let n = serde_json::json!(42);
        assert_ne!(payload_hash(&s).unwrap(), payload_hash(&n).unwrap());
    }

    #[test]
    fn null_distinct_from_missing_key() {
        let with_null = serde_json::json!({ "x": null });
        let empty = serde_json::json!({});
        assert_ne!(payload_hash(&with_null).unwrap(), payload_hash(&empty).unwrap());
    }

    #[test]
    fn hashmap_payloads_canonicalise() {
        // HashMap iteration order is not deterministic; the canonical
        // hash must still match across runs.
        #[derive(Serialize)]
        struct Holder {
            entries: HashMap<String, u32>,
        }
        let mut a = HashMap::new();
        a.insert("apple".to_string(), 1);
        a.insert("banana".to_string(), 2);
        a.insert("cherry".to_string(), 3);
        let mut b = HashMap::new();
        b.insert("cherry".to_string(), 3);
        b.insert("apple".to_string(), 1);
        b.insert("banana".to_string(), 2);
        let h1 = payload_hash(&Holder { entries: a }).unwrap();
        let h2 = payload_hash(&Holder { entries: b }).unwrap();
        assert_eq!(h1, h2);
    }

    #[test]
    fn distinct_payloads_hash_differently() {
        let a = serde_json::json!({ "version": 1 });
        let b = serde_json::json!({ "version": 2 });
        assert_ne!(payload_hash(&a).unwrap(), payload_hash(&b).unwrap());
    }
}
