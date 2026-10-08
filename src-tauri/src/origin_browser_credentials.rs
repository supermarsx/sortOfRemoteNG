//! Native-only credential selection. Never searches another database or falls
//! back to local secrets when a saved vault reference cannot be resolved.
use super::*;

#[cfg(test)]
#[path = "origin_browser_credentials_tests.rs"]
mod tests;

pub(super) struct Credentials {
    pub username: Zeroizing<String>,
    pub password: Zeroizing<String>,
}

impl Credentials {
    pub(super) fn availability(&self, connection: &Value) -> NativeCredentialAvailability {
        if self.username.is_empty() || (self.password.is_empty() && !email_only(connection)) {
            NativeCredentialAvailability::Unavailable
        } else {
            NativeCredentialAvailability::Saved
        }
    }
}

fn email_only(connection: &Value) -> bool {
    connection
        .pointer("/httpApplication/id")
        .and_then(Value::as_str)
        == Some("claude")
}

fn text(row: &Value, key: &str) -> Result<Zeroizing<String>, NativeAuthorityError> {
    match row.get(key) {
        None | Some(Value::Null) => Ok(Zeroizing::new(String::new())),
        Some(Value::String(value))
            if value.len() <= MAX_CREDENTIAL_BYTES && !value.contains('\0') =>
        {
            Ok(Zeroizing::new(value.clone()))
        }
        _ => Err(NativeAuthorityError::CredentialUnavailable),
    }
}

/// Match resolveHttpBasicCredentials/resolveHttpApplicationEmail in the editor
/// and legacy browser. A partially populated dedicated pair is authoritative:
/// never combine it with a password or username from the generic pair.
pub(super) fn local(connection: &Value) -> Result<Credentials, NativeAuthorityError> {
    let username = text(connection, "basicAuthUsername")?;
    if email_only(connection) {
        return Ok(Credentials {
            username: if username.is_empty() {
                text(connection, "username")?
            } else {
                username
            },
            password: Zeroizing::new(String::new()),
        });
    }
    let password = text(connection, "basicAuthPassword")?;
    let selected = if !username.is_empty() || !password.is_empty() {
        Credentials { username, password }
    } else {
        Credentials {
            username: text(connection, "username")?,
            password: text(connection, "password")?,
        }
    };
    for_application(connection, selected)
}

fn for_application(
    connection: &Value,
    mut selected: Credentials,
) -> Result<Credentials, NativeAuthorityError> {
    if connection
        .pointer("/httpApplication/id")
        .and_then(Value::as_str)
        == Some("proxmox")
        && !selected.username.is_empty()
        && !selected.username.contains('@')
    {
        let realm = match connection.pointer("/httpApplication/realm") {
            None => "pam",
            Some(value) => value
                .as_str()
                .filter(|realm| {
                    !realm.is_empty()
                        && realm.len() <= 128
                        && realm
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
                })
                .ok_or(NativeAuthorityError::CredentialUnavailable)?,
        };
        if selected.username.len() + 1 + realm.len() > MAX_CREDENTIAL_BYTES {
            return Err(NativeAuthorityError::CredentialUnavailable);
        }
        selected.username.push('@');
        selected.username.push_str(realm);
    }
    Ok(selected)
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
    let Some(id) = vault_id(connection)? else {
        return local(connection);
    };
    let entry = lease
        .read_dependency(window, state, true, &id)
        .await
        .map_err(|_| NativeAuthorityError::CredentialUnavailable)?;
    // A vault selection excludes *all* connection-local fields, even when
    // the selected facets are incomplete. Never use a local fallback.
    let fields = entry
        .get("facets")
        .filter(|value| value.is_object())
        .ok_or(NativeAuthorityError::CredentialUnavailable)?;
    for_application(
        connection,
        Credentials {
            username: text(fields, "username")?,
            password: if email_only(connection) {
                Zeroizing::new(String::new())
            } else {
                text(fields, "password")?
            },
        },
    )
}
