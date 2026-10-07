//! Native-only credential selection. Never searches another database or falls
//! back to local secrets when a saved vault reference cannot be resolved.
use super::*;

pub(super) struct Credentials {
    pub username: Zeroizing<String>,
    pub password: Zeroizing<String>,
}

fn text(row: &Value, key: &str) -> Result<Zeroizing<String>, NativeAuthorityError> {
    match row.get(key) {
        None => Ok(Zeroizing::new(String::new())),
        Some(Value::String(value))
            if value.len() <= MAX_CREDENTIAL_BYTES && !value.contains('\0') =>
        {
            Ok(Zeroizing::new(value.clone()))
        }
        _ => Err(NativeAuthorityError::CredentialUnavailable),
    }
}

pub(super) fn vault_id(connection: &Value) -> Result<Option<String>, NativeAuthorityError> {
    let Some(source) = connection.get("credentialSource") else {
        return Ok(None);
    };
    let row = source
        .as_object()
        .ok_or(NativeAuthorityError::CredentialUnavailable)?;
    if row
        .keys()
        .any(|key| !matches!(key.as_str(), "kind" | "credentialId" | "totpId"))
    {
        return Err(NativeAuthorityError::CredentialUnavailable);
    }
    match row.get("kind").and_then(Value::as_str) {
        Some("local") if row.len() == 1 => Ok(None),
        Some("vault") => {
            for key in ["credentialId", "totpId"] {
                if key == "credentialId" || row.contains_key(key) {
                    let id = row
                        .get(key)
                        .and_then(Value::as_str)
                        .ok_or(NativeAuthorityError::CredentialUnavailable)?;
                    uuid::Uuid::parse_str(id)
                        .map_err(|_| NativeAuthorityError::CredentialUnavailable)?;
                }
            }
            Ok(Some(
                row["credentialId"].as_str().unwrap().to_ascii_lowercase(),
            ))
        }
        _ => Err(NativeAuthorityError::CredentialUnavailable),
    }
}

pub(super) async fn resolve<R: Runtime>(
    connection: &Value,
    lease: &NativeOwnerLease,
    window: &WebviewWindow<R>,
    state: &EncryptionState,
) -> Result<Credentials, NativeAuthorityError> {
    let entry = if let Some(id) = vault_id(connection)? {
        Some(
            lease
                .read_dependency(window, state, true, &id)
                .await
                .map_err(|_| NativeAuthorityError::CredentialUnavailable)?,
        )
    } else {
        None
    };
    let fields = entry
        .as_ref()
        .and_then(|entry| entry.get("facets"))
        .unwrap_or(connection);
    Ok(Credentials {
        username: text(fields, "username")?,
        password: text(fields, "password")?,
    })
}
