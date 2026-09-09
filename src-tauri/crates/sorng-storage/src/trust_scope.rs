//! Explicit, same-database scope moves and authoritative effective lookups.
use super::*;
use std::collections::HashSet;

#[cfg(test)]
#[path = "trust_scope_tests.rs"]
mod tests;

struct Endpoint {
    host: String,
    port: u16,
}

// The persisted scoped key uses JavaScript encodeURIComponent, not form encoding:
// '+' stays '+'. Reject invalid escapes/UTF-8 instead of silently rebinding a host.
fn decode(value: &str) -> Result<String, String> {
    let mut out = Vec::with_capacity(value.len());
    let bytes = value.as_bytes();
    let mut offset = 0;
    while offset < bytes.len() {
        if bytes[offset] == b'%' {
            let pair = bytes
                .get(offset + 1..offset + 3)
                .ok_or("Invalid scope escape")?;
            let text = std::str::from_utf8(pair).map_err(|_| "Invalid scope escape")?;
            out.push(u8::from_str_radix(text, 16).map_err(|_| "Invalid scope escape")?);
            offset += 3;
        } else {
            out.push(bytes[offset]);
            offset += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "Invalid scope encoding".into())
}

fn encode(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(byte as char);
        } else {
            use std::fmt::Write;
            write!(out, "%{byte:02X}").expect("writing to String");
        }
    }
    out
}

fn endpoint(value: &str) -> Result<Endpoint, String> {
    validate_short_string(value, "scope host", MAX_HOST_BYTES)?;
    let (host, port) = if let Some(rest) = value.strip_prefix(CONNECTION_SCOPE_PREFIX) {
        let parts: Vec<_> = rest.split('/').collect();
        if parts.len() != 3 {
            return Err("Unsupported connection scope key; no changes written".into());
        }
        validate_short_string(&decode(parts[0])?, "connection ID", 253)?;
        (decode(parts[1])?, parts[2])
    } else {
        let (host, port) = value
            .rsplit_once(':')
            .ok_or("Trust endpoint port is missing")?;
        (host.to_owned(), port)
    };
    let host = if let Some(bracketed) = host.strip_prefix('[') {
        bracketed
            .strip_suffix(']')
            .ok_or("Invalid trust endpoint brackets")?
            .to_owned()
    } else {
        host
    };
    if host.is_empty()
        || host.len() > 253
        || host.chars().any(|c| c.is_control() || c.is_whitespace())
        || host.contains(['/', '\\', '@', '[', ']'])
    {
        return Err("Invalid trust endpoint host".into());
    }
    let port: u16 = port.parse().map_err(|_| "Invalid trust endpoint port")?;
    if port == 0 {
        return Err("Invalid trust endpoint port".into());
    }
    let host = match host.parse::<std::net::IpAddr>() {
        Ok(ip) => ip.to_string(),
        Err(_) if host.contains(':') => return Err("Invalid IPv6 trust host".into()),
        Err(_) => host.trim_end_matches('.').to_ascii_lowercase(),
    };
    if host.is_empty() {
        return Err("Invalid trust endpoint host".into());
    }
    Ok(Endpoint { host, port })
}

fn host_for(endpoint: &Endpoint, connection: Option<&str>) -> String {
    if let Some(connection) = connection {
        format!(
            "{CONNECTION_SCOPE_PREFIX}{}/{}/{}",
            encode(connection),
            encode(&endpoint.host),
            endpoint.port
        )
    } else if endpoint.host.contains(':') {
        format!("[{}]:{}", endpoint.host, endpoint.port)
    } else {
        format!("{}:{}", endpoint.host, endpoint.port)
    }
}

fn connection_id(host: &str) -> Result<Option<String>, String> {
    host.strip_prefix(CONNECTION_SCOPE_PREFIX)
        .map(|rest| decode(rest.split('/').next().ok_or("Invalid connection scope")?))
        .transpose()
}

fn matching_key(data: &TrustStoreData, host: &str, kind: &str) -> Result<Option<String>, String> {
    let endpoint = endpoint(host)?;
    let connection = connection_id(host)?;
    let mut found = None;
    let mut seen = HashSet::new();
    for key in data.records.keys().chain(fresh_approval_keys(data).iter()) {
        if !seen.insert(key) {
            continue;
        }
        let Some((candidate_kind, candidate)) = key.split_once(':') else {
            continue;
        };
        if candidate_kind != kind || connection_id(candidate)? != connection {
            continue;
        }
        let Ok(other) = self::endpoint(candidate) else {
            continue;
        };
        if other.host == endpoint.host && other.port == endpoint.port {
            if found.is_some() {
                return Err("Equivalent trust endpoints have conflicting records; review them before connecting".into());
            }
            found = Some(key.clone());
        }
    }
    Ok(found)
}

/// Re-approval targets an existing alias only within the explicitly requested
/// scope, never a database-wide fallback for a connection-scoped action.
pub(super) fn mutation_host(
    data: &TrustStoreData,
    host: &str,
    kind: &str,
) -> Result<String, String> {
    if !host.starts_with(CONNECTION_SCOPE_PREFIX) && endpoint(host).is_err() {
        return Ok(host.to_owned());
    }
    Ok(matching_key(data, host, kind)?
        .and_then(|key| key.split_once(':').map(|(_, host)| host.to_owned()))
        .unwrap_or_else(|| host.to_owned()))
}

pub(super) fn effective_key(
    data: &TrustStoreData,
    host: &str,
    kind: &str,
) -> Result<String, String> {
    let exact = TrustStoreService::record_key(kind, host);
    // Preserve legacy exact keys without inventing a default port or broadening
    // their scope. Only supported endpoint syntax can inherit another record.
    if !host.starts_with(CONNECTION_SCOPE_PREFIX) && endpoint(host).is_err() {
        return Ok(exact);
    }
    // A specific mismatch/revocation or intentional Forget always wins.
    if let Some(found) = matching_key(data, host, kind)? {
        return Ok(found);
    }
    if !host.starts_with(CONNECTION_SCOPE_PREFIX) {
        return Ok(exact);
    }
    Ok(matching_key(data, &host_for(&endpoint(host)?, None), kind)?.unwrap_or(exact))
}

/// Security decisions reviewed before changing a record's applicability.
/// Deliberately excludes verification counters, history, nickname and tags.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrustScopeDecision {
    pub user_approved: bool,
    pub revoked: bool,
    pub trust_expires: Option<String>,
    pub host_policy: Option<TrustPolicy>,
    pub host_policy_config: Option<TrustPolicyConfig>,
}

impl From<&TrustRecord> for TrustScopeDecision {
    fn from(record: &TrustRecord) -> Self {
        Self {
            user_approved: record.user_approved,
            revoked: record.revoked,
            trust_expires: record.trust_expires.clone(),
            host_policy: record.host_policy.clone(),
            host_policy_config: record.host_policy_config.clone(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewedTrustScopeTarget {
    pub host: String,
    pub record_type: String,
    pub fingerprint: String,
    pub expected_decision: TrustScopeDecision,
}

impl TrustRuntime {
    /// App wrapper owns the global database/key coordinator; this method keeps
    /// one local trust I/O lease across validation, moving, and the single write.
    #[allow(clippy::too_many_arguments)]
    pub fn reassign_scope_with_coordinator_guard(
        &self,
        profile: &Path,
        database_id: &str,
        expected_revision: &str,
        expected_data: &serde_json::Value,
        connection_ids: &[String],
        targets: Vec<ReviewedTrustScopeTarget>,
        target_connection_id: Option<&str>,
        _coordinator: &tokio::sync::MutexGuard<'_, ()>,
        validate_access: impl FnOnce() -> Result<(), String>,
    ) -> Result<ReviewedTrustOutcome, String> {
        crate::database_transaction::validate_database_id(database_id)?;
        if self.databases_dir != profile.join("databases") {
            return Err("Trust profile changed".into());
        }
        if targets.is_empty()
            || targets.len() > MAX_TRUST_RECORDS
            || connection_ids.len() > MAX_TRUST_RECORDS
        {
            return Err("Invalid bounded trust scope selection".into());
        }
        if let Some(id) = target_connection_id {
            validate_short_string(id, "connection ID", 253)?;
            if !connection_ids.iter().any(|candidate| candidate == id) {
                return Err("Select an existing saved connection in this database".into());
            }
        }
        let _io = self.io.lock().map_err(|_| "Trust I/O lock poisoned")?;
        self.with_current_key(|_| Ok(()))?;
        if self.active_database_id().as_deref() != Some(database_id) {
            return Err("Trust database changed; refresh and review the scope again".into());
        }
        let path = self.trust_file_path(database_id)?;
        let mut data = self.read_file(&path)?;
        let mut source_keys = HashSet::new();
        let mut destination_keys = HashSet::new();
        let mut moves = Vec::with_capacity(targets.len());
        for target in targets {
            validate_short_string(&target.fingerprint, "fingerprint", MAX_FINGERPRINT_BYTES)?;
            let source = TrustStoreService::record_key(&target.record_type, &target.host);
            if !source_keys.insert(source.clone()) {
                return Err("Duplicate reviewed trust identity".into());
            }
            let current = data
                .records
                .get(&source)
                .ok_or("Trust identity changed; review the scope again")?;
            if TrustStoreService::identity_fingerprint(&current.identity) != target.fingerprint {
                return Err("Trust identity changed; no scope changes written".into());
            }
            if TrustScopeDecision::from(current) != target.expected_decision {
                return Err("Trust approval, revocation, expiry or policy changed; review again. No scope changes written".into());
            }
            let source_endpoint = endpoint(&target.host)?;
            let destination_host =
                if connection_id(&target.host)?.as_deref() == target_connection_id {
                    target.host.clone()
                } else {
                    host_for(&source_endpoint, target_connection_id)
                };
            let destination = TrustStoreService::record_key(&target.record_type, &destination_host);
            if !destination_keys.insert(destination.clone()) {
                return Err(
                    "Selected identities collide in the destination scope; no changes written"
                        .into(),
                );
            }
            if source != destination
                && matching_key(&data, &destination_host, &target.record_type)?.is_some()
            {
                return Err("The destination scope already has an identity or a Forget decision; no changes written".into());
            }
            moves.push((source, destination, destination_host));
        }
        // Scope movement must not turn its legacy-replay marker into Forget.
        data.fresh_approval_required_keys = Some(fresh_approval_keys(&data).clone());
        let changed: Vec<_> = moves
            .iter()
            .filter(|(source, destination, _)| source != destination)
            .collect();
        suppress_legacy_keys(
            &mut data,
            changed.iter().map(|(source, _, _)| source.clone()),
        )?;
        for (source, destination, host) in &changed {
            let mut record = data.records.remove(source).expect("all sources validated");
            record.host = host.clone();
            data.records.insert(destination.clone(), record);
        }
        validate_trust_store_data(&data)?;
        self.revalidate_scope_source(database_id, expected_revision, expected_data)?;
        validate_access()?;
        if !changed.is_empty() {
            self.write_file(&path, &data)?;
        }
        Ok(ReviewedTrustOutcome {
            updated: changed.len(),
        })
    }

    fn revalidate_scope_source(
        &self,
        id: &str,
        revision: &str,
        expected_data: &serde_json::Value,
    ) -> Result<(), String> {
        use legacy_migration::MAX_DATABASE_BYTES;
        let index = self
            .strict_value(
                &self.databases_dir.join("index.json"),
                ArtifactKind::DatabasesIndex,
                MAX_DATABASE_BYTES,
            )?
            .ok_or("Database index is missing")?;
        let mut rows = index
            .as_array()
            .ok_or("Database index is malformed")?
            .iter()
            .filter(|row| row.get("id").and_then(serde_json::Value::as_str) == Some(id));
        let row = rows.next().ok_or("Database is no longer saved")?;
        let current = self
            .strict_value(
                &self.databases_dir.join(format!("{id}.json")),
                ArtifactKind::Connections,
                MAX_DATABASE_BYTES,
            )?
            .ok_or("Database payload is missing")?;
        if rows.next().is_some()
            || row
                .get("securityRevision")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                != revision
            || current != *expected_data
        {
            return Err(
                "Database contents or security changed; no trust scope changes written".into(),
            );
        }
        Ok(())
    }
}
