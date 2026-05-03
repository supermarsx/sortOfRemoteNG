//! `clone_connection` — pure stamping helper: fresh id + ISO timestamps + name suffix,
//! optionally stripping secret-bearing fields. Frontend owns persistence.
#![allow(dead_code)] // wired by t5-e7

use serde_json::{json, Value};

const TOP_LEVEL_SECRETS: &[&str] = &[
    "password",
    "privateKey",
    "passphrase",
    "totpSecret",
    "basicAuthPassword",
    "rustdeskPassword",
];

const NESTED_CONTAINERS: &[&str] = &["cloudProvider", "gatewaySettings", "gateway", "proxyConfig"];

const NESTED_SECRET_KEYS: &[&str] = &[
    "password",
    "apiKey",
    "accessToken",
    "clientSecret",
    "privateKey",
    "passphrase",
    "proxyPassword",
];

pub fn clone_connection_value(
    mut connection: Value,
    new_name: Option<String>,
    include_credentials: bool,
) -> Result<Value, String> {
    let obj = connection
        .as_object_mut()
        .ok_or_else(|| "connection payload must be a JSON object".to_string())?;

    let src_id = obj.get("id").and_then(|v| v.as_str()).map(String::from);
    let original_name = obj
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    let new_id = uuid::Uuid::new_v4().to_string();
    let now = iso_now_millis();

    let resolved_name = match new_name {
        Some(n) if !n.trim().is_empty() => n,
        _ => format!("{} (Copy)", original_name),
    };

    obj.insert("id".into(), Value::String(new_id.clone()));
    obj.insert("name".into(), Value::String(resolved_name));
    obj.insert("createdAt".into(), Value::String(now.clone()));
    obj.insert("updatedAt".into(), Value::String(now));

    if !include_credentials {
        for k in TOP_LEVEL_SECRETS {
            obj.remove(*k);
        }
        for container in NESTED_CONTAINERS {
            if let Some(child) = obj.get_mut(*container) {
                if let Some(child_obj) = child.as_object_mut() {
                    for k in NESTED_SECRET_KEYS {
                        child_obj.remove(*k);
                    }
                }
            }
        }
        if obj.contains_key("totpConfigs") {
            obj.insert("totpConfigs".into(), json!([]));
        }
    }

    tracing::info!(
        target: "audit",
        action = "connection.clone",
        src_id = src_id.as_deref().unwrap_or("<unknown>"),
        new_id = %new_id,
        include_credentials = include_credentials,
        "connection cloned"
    );

    Ok(connection)
}

fn iso_now_millis() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = dur.as_secs() as i64;
    let millis = dur.subsec_millis();
    let dt = chrono::DateTime::<chrono::Utc>::from_timestamp(secs, millis * 1_000_000)
        .unwrap_or_default();
    dt.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[tauri::command]
pub async fn clone_connection(
    connection: Value,
    new_name: Option<String>,
    include_credentials: bool,
) -> Result<Value, String> {
    clone_connection_value(connection, new_name, include_credentials)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Value {
        json!({
            "id": "orig-1",
            "name": "My Server",
            "protocol": "ssh",
            "host": "example.com",
            "port": 22,
            "parentId": "folder-1",
            "tags": ["prod", "critical"],
            "password": "s3cret",
            "privateKey": "-----BEGIN RSA-----",
            "passphrase": "phrase",
            "totpSecret": "JBSWY3DPEHPK3PXP",
            "basicAuthPassword": "b",
            "rustdeskPassword": "r",
            "totpConfigs": [{"label": "main", "secret": "..."}],
            "cloudProvider": {"kind": "aws", "apiKey": "AKIA...", "accessToken": "tok", "region": "us-east-1"},
            "proxyConfig": {"type": "http", "host": "proxy.local", "proxyPassword": "pp"},
            "createdAt": "2024-01-01T00:00:00.000Z",
            "updatedAt": "2024-01-01T00:00:00.000Z",
        })
    }

    #[test]
    fn strips_secrets_by_default() {
        let out = clone_connection_value(sample(), None, false).unwrap();
        let o = out.as_object().unwrap();
        for k in TOP_LEVEL_SECRETS {
            assert!(!o.contains_key(*k), "{k} should be stripped");
        }
        assert_eq!(o.get("totpConfigs").unwrap(), &json!([]));
        let cloud = o.get("cloudProvider").and_then(|v| v.as_object()).unwrap();
        assert!(!cloud.contains_key("apiKey"));
        assert!(!cloud.contains_key("accessToken"));
        assert_eq!(cloud.get("kind").and_then(|v| v.as_str()), Some("aws"));
        let proxy = o.get("proxyConfig").and_then(|v| v.as_object()).unwrap();
        assert!(!proxy.contains_key("proxyPassword"));
        assert_eq!(
            proxy.get("host").and_then(|v| v.as_str()),
            Some("proxy.local")
        );
    }

    #[test]
    fn preserves_secrets_when_include_credentials() {
        let out = clone_connection_value(sample(), None, true).unwrap();
        let o = out.as_object().unwrap();
        assert_eq!(o.get("password").and_then(|v| v.as_str()), Some("s3cret"));
        assert_eq!(
            o.get("cloudProvider")
                .and_then(|v| v.get("apiKey"))
                .and_then(|v| v.as_str()),
            Some("AKIA...")
        );
    }

    #[test]
    fn applies_new_name() {
        let out = clone_connection_value(sample(), Some("Replica A".into()), false).unwrap();
        assert_eq!(out.get("name").and_then(|v| v.as_str()), Some("Replica A"));
    }

    #[test]
    fn defaults_to_copy_suffix() {
        let out = clone_connection_value(sample(), None, false).unwrap();
        assert_eq!(
            out.get("name").and_then(|v| v.as_str()),
            Some("My Server (Copy)")
        );
    }

    #[test]
    fn defaults_to_copy_when_name_blank() {
        let out = clone_connection_value(sample(), Some("  ".into()), false).unwrap();
        assert_eq!(
            out.get("name").and_then(|v| v.as_str()),
            Some("My Server (Copy)")
        );
    }

    #[test]
    fn refreshes_id_and_timestamps() {
        let out = clone_connection_value(sample(), None, false).unwrap();
        let id = out.get("id").and_then(|v| v.as_str()).unwrap();
        assert_ne!(id, "orig-1");
        assert!(uuid::Uuid::parse_str(id).is_ok());
        let created = out.get("createdAt").and_then(|v| v.as_str()).unwrap();
        assert_ne!(created, "2024-01-01T00:00:00.000Z");
        assert_eq!(
            created,
            out.get("updatedAt").and_then(|v| v.as_str()).unwrap()
        );
    }

    #[test]
    fn preserves_parent_id_and_tags() {
        let out = clone_connection_value(sample(), None, false).unwrap();
        assert_eq!(
            out.get("parentId").and_then(|v| v.as_str()),
            Some("folder-1")
        );
        let tags: Vec<&str> = out
            .get("tags")
            .and_then(|v| v.as_array())
            .unwrap()
            .iter()
            .filter_map(|x| x.as_str())
            .collect();
        assert_eq!(tags, vec!["prod", "critical"]);
    }

    #[test]
    fn rejects_non_object_payload() {
        assert!(clone_connection_value(json!("string"), None, false).is_err());
    }
}
