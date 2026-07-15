//! `clone_connection` — pure stamping helper: fresh id + ISO timestamps + name suffix,
//! optionally stripping secret-bearing fields. Frontend owns persistence.
#![allow(dead_code)] // wired by t5-e7

use serde_json::{json, Value};

const SECRET_KEYS: &[&str] = &[
    "password",
    "basicauthpassword",
    "rustdeskpassword",
    "proxypassword",
    "privatekey",
    "passphrase",
    "totpsecret",
    "apikey",
    "accesstoken",
    "clientsecret",
    "serviceaccountkey",
    "presharedkey",
    "authkey",
    "authtoken",
    "seedphrase",
    "answer",
];

const SENSITIVE_REFERENCE_KEYS: &[&str] = &[
    "savedcredentialid",
    "vaultref",
    "clientcertificateref",
    "credentialref",
    "privatekeycredentialref",
    "privatekeypath",
    "agentsocket",
];

const RUNTIME_KEYS: &[&str] = &[
    "backendsessionid",
    "shellid",
    "runtimesessionid",
    "detachedsessionid",
    "channelid",
    "terminalbuffer",
    "transcript",
    "transcripts",
    "replay",
    "replaybuffer",
    "outputsnapshot",
    "lastoutput",
    "commandhistory",
    "runtimestate",
    "backendstate",
];

fn normalized_key(key: &str) -> String {
    key.chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn is_sensitive_header(name: &str) -> bool {
    let normalized = normalized_key(name);
    normalized.contains("authorization")
        || normalized.contains("cookie")
        || normalized.contains("token")
        || normalized.contains("secret")
        || normalized.contains("password")
        || normalized.contains("apikey")
}

fn sanitize_clone_value(value: &mut Value, include_credentials: bool) {
    match value {
        Value::Array(items) => {
            for item in items {
                sanitize_clone_value(item, include_credentials);
            }
        }
        Value::Object(object) => {
            let keys_to_remove: Vec<String> = object
                .keys()
                .filter(|key| {
                    let normalized = normalized_key(key);
                    RUNTIME_KEYS.contains(&normalized.as_str())
                        || (!include_credentials
                            && (SECRET_KEYS.contains(&normalized.as_str())
                                || SENSITIVE_REFERENCE_KEYS.contains(&normalized.as_str())))
                })
                .cloned()
                .collect();
            for key in keys_to_remove {
                object.remove(&key);
            }

            if !include_credentials {
                if let Some(Value::Object(headers)) = object.get_mut("httpHeaders") {
                    headers.retain(|name, _| !is_sensitive_header(name));
                }
                if object.contains_key("totpConfigs") {
                    object.insert("totpConfigs".into(), json!([]));
                }
            }

            for nested in object.values_mut() {
                sanitize_clone_value(nested, include_credentials);
            }
        }
        _ => {}
    }
}

fn reset_rlogin_plaintext_acknowledgement(object: &mut serde_json::Map<String, Value>) {
    let Some(Value::Object(settings)) = object.get_mut("rloginSettings") else {
        return;
    };
    settings.insert(
        "plaintextAcknowledgement".into(),
        json!({
            "version": 1,
            "scope": "rlogin-plaintext-v1",
            "acknowledged": false
        }),
    );
}

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

    reset_rlogin_plaintext_acknowledgement(obj);
    sanitize_clone_value(&mut connection, include_credentials);

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
            "httpHeaders": {"Accept": "application/json", "Authorization": "Bearer secret"},
            "powerShellRemoting": {
                "credential": {"source": "vault", "vaultRef": {"integrationId": "vault", "secretId": "secret"}},
                "ssh": {"privateKeyCredentialRef": "key-ref", "keepaliveSec": 30},
                "session": {"idleTimeoutSec": 900}
            },
            "rloginSettings": {
                "version": 1,
                "remoteUsername": "operator",
                "plaintextAcknowledgement": {
                    "version": 1,
                    "scope": "rlogin-plaintext-v1",
                    "acknowledged": true,
                    "acknowledgedAt": "2026-07-15T10:02:00.000Z"
                }
            },
            "backendSessionId": "backend-1",
            "terminalBuffer": "sensitive output",
            "transcript": ["Get-Secret"],
            "replay": {"frames": ["secret frame"]},
            "rawSocketSettings": {"advanced": {"replayFrames": 512, "replayBytes": 2097152}},
            "createdAt": "2024-01-01T00:00:00.000Z",
            "updatedAt": "2024-01-01T00:00:00.000Z",
        })
    }

    #[test]
    fn strips_secrets_by_default() {
        let out = clone_connection_value(sample(), None, false).unwrap();
        let o = out.as_object().unwrap();
        for k in [
            "password",
            "privateKey",
            "passphrase",
            "totpSecret",
            "basicAuthPassword",
            "rustdeskPassword",
        ] {
            assert!(!o.contains_key(k), "{k} should be stripped");
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
        let headers = o.get("httpHeaders").and_then(Value::as_object).unwrap();
        assert!(headers.contains_key("Accept"));
        assert!(!headers.contains_key("Authorization"));
        let powershell = o
            .get("powerShellRemoting")
            .and_then(Value::as_object)
            .unwrap();
        let credential = powershell
            .get("credential")
            .and_then(Value::as_object)
            .unwrap();
        assert!(!credential.contains_key("vaultRef"));
        let ssh = powershell.get("ssh").and_then(Value::as_object).unwrap();
        assert!(!ssh.contains_key("privateKeyCredentialRef"));
        assert_eq!(ssh.get("keepaliveSec"), Some(&json!(30)));
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
        let headers = o.get("httpHeaders").and_then(Value::as_object).unwrap();
        assert_eq!(
            headers.get("Authorization").and_then(Value::as_str),
            Some("Bearer secret")
        );
        let vault = out
            .pointer("/powerShellRemoting/credential/vaultRef/secretId")
            .and_then(Value::as_str);
        assert_eq!(vault, Some("secret"));
    }

    #[test]
    fn always_resets_local_consent_and_runtime_artifacts() {
        let out = clone_connection_value(sample(), None, true).unwrap();
        for key in ["backendSessionId", "terminalBuffer", "transcript", "replay"] {
            assert!(out.get(key).is_none(), "{key} should never be cloned");
        }
        assert_eq!(
            out.pointer("/rloginSettings/plaintextAcknowledgement"),
            Some(&json!({
                "version": 1,
                "scope": "rlogin-plaintext-v1",
                "acknowledged": false
            }))
        );
        assert_eq!(
            out.pointer("/rawSocketSettings/advanced/replayFrames"),
            Some(&json!(512))
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
