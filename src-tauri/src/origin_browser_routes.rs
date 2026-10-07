//! Native saved profile/chain expansion. Catalog bytes come only from the
//! managed profile storage, never the renderer or a global connection search.
use super::*;
use tauri::Manager;

const ERROR: NativeAuthorityError = NativeAuthorityError::RouteUnsupported;

/// Native startup binding, never accepted through IPC. `chains` must be the
/// service belonging to `profile_root`, not one retained from another profile.
/// No connected backend sessions or cached local ports are reused.
#[derive(Clone)]
pub struct NativeBrowserRouteServices {
    profile_root: std::path::PathBuf,
    encryption_owner: u64,
    chains: crate::chaining::ChainingServiceState,
}

impl NativeBrowserRouteServices {
    pub fn new(
        profile_root: &std::path::Path,
        state: &EncryptionState,
        chains: crate::chaining::ChainingServiceState,
    ) -> Result<Self, NativeAuthorityError> {
        Ok(Self {
            profile_root: profile_root.canonicalize().map_err(|_| ERROR)?,
            encryption_owner: state.database_session_owner(),
            chains,
        })
    }

    fn check_owner(
        &self,
        state: &EncryptionState,
        lease: &NativeOwnerLease,
    ) -> Result<(), NativeAuthorityError> {
        if !lease.is_current()
            || self.encryption_owner != state.database_session_owner()
            || self.profile_root != lease.profile_root().canonicalize().map_err(|_| ERROR)?
        {
            return Err(ERROR);
        }
        Ok(())
    }
}

// Snapshot configuration only. Native chain execution can return VPN protocol
// ports (1194, 51820, etc.), which are NOT browser byte-stream endpoints.
fn proxy_chain_ids(
    chain: &crate::chaining::ConnectionChain,
    requested_id: &str,
) -> Result<Vec<String>, NativeAuthorityError> {
    use crate::chaining::ConnectionType;
    if chain.id != requested_id || chain.layers.is_empty() || chain.layers.len() > 8 {
        return Err(ERROR);
    }
    let mut layers: Vec<_> = chain.layers.iter().collect();
    layers.sort_by_key(|layer| layer.position);
    let mut previous = None;
    let mut layer_ids = std::collections::BTreeSet::new();
    let mut ids = Vec::with_capacity(layers.len());
    for layer in layers {
        if layer.connection_type != ConnectionType::Proxy
            || previous == Some(layer.position)
            || layer.id.is_empty()
            || !layer_ids.insert(&layer.id)
            || layer.connection_id.is_empty()
            || layer.connection_id.len() > 128
        {
            return Err(ERROR);
        }
        previous = Some(layer.position);
        ids.push(layer.connection_id.clone());
    }
    Ok(ids)
}

pub(super) async fn expand<R: Runtime>(
    window: &WebviewWindow<R>,
    state: &EncryptionState,
    connection: &Value,
    lease: &NativeOwnerLease,
) -> Result<Value, NativeAuthorityError> {
    let chain_id = connection
        .get("connectionChainId")
        .filter(|v| !v.is_null() && *v != "")
        .map(|v| v.as_str().filter(|id| id.len() <= 128).ok_or(ERROR))
        .transpose()?;
    let services = if chain_id.is_some() {
        let services = window
            .try_state::<NativeBrowserRouteServices>()
            .ok_or(ERROR)?;
        services.check_owner(state, lease)?;
        Some(services.inner().clone())
    } else {
        None
    };
    let chain_profiles = if let (Some(id), Some(services)) = (chain_id, &services) {
        let chain = services
            .chains
            .lock()
            .await
            .get_chain(id)
            .await
            .map_err(|_| ERROR)?;
        proxy_chain_ids(&chain, id)?
    } else {
        Vec::new()
    };
    let references = [
        "proxyProfileId",
        "proxyChainId",
        "tunnelProfileId",
        "tunnelChainId",
    ];
    let needs_catalog = chain_id.is_some()
        || references.iter().any(|key| {
            connection
                .get(*key)
                .is_some_and(|v| !v.is_null() && v != "")
        })
        || connection
            .pointer("/security/tunnelChain")
            .and_then(Value::as_array)
            .is_some_and(|layers| {
                layers
                    .iter()
                    .any(|layer| layer.get("tunnelProfileId").is_some())
            });
    if !needs_catalog {
        return Ok(connection.clone());
    }
    let storage = window
        .try_state::<sorng_storage::storage::SecureStorageState>()
        .ok_or(ERROR)?;
    let path = std::path::PathBuf::from(storage.lock().await.store_path());
    let owner_root = lease.profile_root().canonicalize().map_err(|_| ERROR)?;
    if path.parent().and_then(|p| p.canonicalize().ok()).as_deref() != Some(owner_root.as_path()) {
        return Err(ERROR);
    }
    let raw = sorng_storage::storage::lock_app_data(&storage)
        .await
        .read_app_data("proxy_collection_data")
        .await
        .map_err(|_| ERROR)?
        .ok_or(ERROR)?;
    let raw = Zeroizing::new(raw);
    if raw.len() > 8 * 1024 * 1024 || !lease.is_current() {
        return Err(ERROR);
    }
    let catalog: Value = serde_json::from_str(&raw).map_err(|_| ERROR)?;
    let prefix = chain_profiles
        .iter()
        .map(|id| {
            enabled_proxy(
                selected(&catalog, "profiles", id)?
                    .get("config")
                    .ok_or(ERROR)?,
            )
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut connection = connection.clone();
    if let (Some(id), Some(services)) = (chain_id, &services) {
        services.check_owner(state, lease)?;
        let current = services
            .chains
            .lock()
            .await
            .get_chain(id)
            .await
            .map_err(|_| ERROR)?;
        if proxy_chain_ids(&current, id)? != chain_profiles {
            return Err(ERROR);
        }
        // Erase the saved selector only once every layer has been resolved.
        connection
            .as_object_mut()
            .ok_or(ERROR)?
            .remove("connectionChainId");
    }
    expand_catalog_with_prefix(&connection, &catalog, prefix)
}

fn selected<'a>(
    catalog: &'a Value,
    collection: &str,
    id: &str,
) -> Result<&'a Value, NativeAuthorityError> {
    if id.is_empty() || id.len() > 128 {
        return Err(ERROR);
    }
    let rows = catalog
        .get(collection)
        .and_then(Value::as_array)
        .ok_or(ERROR)?;
    if rows.len() > 10000 {
        return Err(ERROR);
    }
    let mut matches = rows
        .iter()
        .filter(|row| row.get("id").and_then(Value::as_str) == Some(id));
    let found = matches.next().ok_or(ERROR)?;
    if matches.next().is_some() {
        return Err(ERROR);
    }
    Ok(found)
}

fn enabled_proxy(value: &Value) -> Result<Value, NativeAuthorityError> {
    if value
        .get("enabled")
        .is_some_and(|value| value != &Value::Bool(true))
    {
        return Err(ERROR);
    }
    let mut proxy = value.clone();
    proxy
        .as_object_mut()
        .ok_or(ERROR)?
        .insert("enabled".into(), true.into());
    // Validate supported transports before returning a normalized route.
    proxy_hop(&proxy, "type")?;
    Ok(serde_json::json!({"enabled":true,"type":"proxy","proxy":{
        "proxyType":proxy["type"],"host":proxy["host"],"port":proxy["port"],
        "username":proxy.get("username").and_then(Value::as_str).unwrap_or(""),
        "password":proxy.get("password").and_then(Value::as_str).unwrap_or("")
    }}))
}

fn strict_chain(chain: &Value) -> Result<(), NativeAuthorityError> {
    if chain
        .pointer("/dynamics/strategy")
        .is_some_and(|v| v != "strict")
    {
        return Err(ERROR);
    }
    if chain
        .pointer("/dynamics/fallbackChainIds")
        .and_then(Value::as_array)
        .is_some_and(|v| !v.is_empty())
    {
        return Err(ERROR);
    }
    Ok(())
}

#[cfg(test)]
fn expand_catalog(connection: &Value, catalog: &Value) -> Result<Value, NativeAuthorityError> {
    expand_catalog_with_prefix(connection, catalog, Vec::new())
}

fn expand_catalog_with_prefix(
    connection: &Value,
    catalog: &Value,
    mut layers: Vec<Value>,
) -> Result<Value, NativeAuthorityError> {
    if connection.get("security").is_some_and(|v| !v.is_object()) {
        return Err(ERROR);
    }
    let mut expanded = connection.clone();
    let present = |key: &str| connection.get(key).is_some_and(|v| !v.is_null() && v != "");
    // Same native translation of NETWORK_PATH_POLICY source precedence:
    // direct profiles shadow their chains, tunnel selections shadow inline,
    // and legacy proxy remains an independent final layer.
    for (key, collection) in [
        ("proxyProfileId", "profiles"),
        ("proxyChainId", "chains"),
        ("tunnelProfileId", "tunnelProfiles"),
        ("tunnelChainId", "tunnelChains"),
    ] {
        let shadowed = key == "proxyChainId" && present("proxyProfileId")
            || key == "tunnelChainId" && present("tunnelProfileId");
        if let Some(value) = connection
            .get(key)
            .filter(|v| !shadowed && !v.is_null() && *v != "")
        {
            let selected = selected(catalog, collection, value.as_str().ok_or(ERROR)?)?;
            match key {
                "proxyProfileId" => {
                    layers.push(enabled_proxy(selected.get("config").ok_or(ERROR)?)?)
                }
                "tunnelProfileId" => layers.push(selected.get("config").ok_or(ERROR)?.clone()),
                _ => {
                    strict_chain(selected)?;
                    let rows = selected
                        .get("layers")
                        .and_then(Value::as_array)
                        .ok_or(ERROR)?;
                    if rows.is_empty() || rows.len() > 8 {
                        return Err(ERROR);
                    }
                    if key == "proxyChainId" {
                        let mut rows: Vec<_> = rows.iter().collect();
                        rows.sort_by_key(|row| {
                            row.get("position")
                                .and_then(Value::as_u64)
                                .unwrap_or(u64::MAX)
                        });
                        let mut previous = None;
                        for row in rows {
                            let position =
                                row.get("position").and_then(Value::as_u64).ok_or(ERROR)?;
                            if previous == Some(position)
                                || row.get("nodeConfig").is_some_and(|v| !v.is_null())
                            {
                                return Err(ERROR);
                            }
                            previous = Some(position);
                            if row.get("type").and_then(Value::as_str) != Some("proxy") {
                                return Err(ERROR);
                            }
                            let config = if let Some(id) = row.get("proxyProfileId") {
                                if row.get("inlineConfig").is_some() {
                                    return Err(ERROR);
                                }
                                selected_profile(catalog, id)?
                            } else {
                                row.get("inlineConfig").ok_or(ERROR)?
                            };
                            layers.push(enabled_proxy(config)?);
                        }
                    } else {
                        layers.extend_from_slice(rows);
                    }
                }
            }
        }
        expanded.as_object_mut().ok_or(ERROR)?.remove(key);
    }
    let inline = connection
        .pointer("/security/tunnelChain")
        .and_then(Value::as_array);
    if !present("tunnelProfileId") && !present("tunnelChainId") {
        if let Some(inline) = inline {
            layers.extend_from_slice(inline);
        }
    }
    if let Some(proxy) = connection.pointer("/security/proxy") {
        match proxy.get("enabled").and_then(Value::as_bool) {
            Some(true) => layers.push(enabled_proxy(proxy)?),
            Some(false) => (),
            _ => return Err(ERROR),
        }
        expanded["security"]
            .as_object_mut()
            .ok_or(ERROR)?
            .remove("proxy");
    }
    if layers.is_empty() || layers.len() > 8 {
        return Err(ERROR);
    }
    for layer in &mut layers {
        if layer.get("enabled") == Some(&Value::Bool(false)) {
            continue;
        }
        if let Some(id) = layer.get("tunnelProfileId") {
            if layer.as_object().ok_or(ERROR)?.keys().any(|key| {
                !matches!(
                    key.as_str(),
                    "id" | "name" | "type" | "enabled" | "tunnelProfileId"
                )
            }) {
                return Err(ERROR);
            }
            let profile = selected(catalog, "tunnelProfiles", id.as_str().ok_or(ERROR)?)?;
            let mut config = profile.get("config").ok_or(ERROR)?.clone();
            if config.get("tunnelProfileId").is_some() {
                return Err(ERROR);
            }
            if layer.get("type") != config.get("type") {
                return Err(ERROR);
            }
            config
                .as_object_mut()
                .ok_or(ERROR)?
                .insert("enabled".into(), true.into());
            *layer = config;
        }
    }
    if expanded.get("security").is_none() {
        expanded["security"] = serde_json::json!({});
    }
    expanded["security"]["tunnelChain"] = layers.into();
    let hops = saved_route(&expanded)?;
    if hops.is_empty()
        || hops
            .iter()
            .skip(1)
            .any(|hop| matches!(hop.kind, ProxyKind::Https))
    {
        return Err(ERROR);
    }
    Ok(expanded)
}

fn selected_profile<'a>(catalog: &'a Value, id: &Value) -> Result<&'a Value, NativeAuthorityError> {
    selected(catalog, "profiles", id.as_str().ok_or(ERROR)?)?
        .get("config")
        .ok_or(ERROR)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn native_chain_rejects_ambiguous_or_unexecutable_snapshots() {
        use crate::chaining::{
            ChainLayer, ChainLayerStatus, ChainStatus, ConnectionChain, ConnectionType,
        };
        let layer = ChainLayer {
            id: "layer".into(),
            connection_type: ConnectionType::Proxy,
            connection_id: "saved-proxy".into(),
            position: 0,
            status: ChainLayerStatus::Connected,
            local_port: Some(51820),
            error: None,
        };
        let chain = ConnectionChain {
            id: "chain".into(),
            name: "fixture".into(),
            description: None,
            layers: vec![layer.clone()],
            status: ChainStatus::Connected,
            created_at: chrono::Utc::now(),
            connected_at: None,
            final_local_port: Some(51820),
            error: None,
        };
        // Runtime flags and ports cannot override the configured profile.
        assert_eq!(
            proxy_chain_ids(&chain, "chain").unwrap(),
            vec!["saved-proxy"]
        );
        assert!(proxy_chain_ids(&chain, "wrong").is_err());
        for invalid in [
            "empty",
            "too-many",
            "duplicate-position",
            "duplicate-id",
            "vpn",
            "empty-reference",
        ] {
            let mut chain = chain.clone();
            match invalid {
                "empty" => chain.layers.clear(),
                "too-many" => chain.layers = vec![layer.clone(); 9],
                "duplicate-position" => {
                    let mut extra = layer.clone();
                    extra.id = "another".into();
                    chain.layers.push(extra);
                }
                "duplicate-id" => {
                    let mut extra = layer.clone();
                    extra.position = 1;
                    chain.layers.push(extra);
                }
                "vpn" => chain.layers[0].connection_type = ConnectionType::WireGuard,
                "empty-reference" => chain.layers[0].connection_id.clear(),
                _ => unreachable!(),
            }
            assert!(proxy_chain_ids(&chain, "chain").is_err(), "{invalid}");
        }
    }

    #[test]
    fn native_prefix_composes_before_profiles_and_cannot_hide_unsupported_tail() {
        let catalog = json!({"profiles":[{"id":"inner","config":{"enabled":true,"type":"socks5","host":"inner.invalid","port":1080}}]});
        let prefix =
            enabled_proxy(&json!({"type":"https","host":"outer.invalid","port":443})).unwrap();
        let config = json!({"proxyProfileId":"inner","security":{"proxy":{"enabled":true,"type":"http","host":"last.invalid","port":8080}}});
        let expanded = expand_catalog_with_prefix(&config, &catalog, vec![prefix.clone()]).unwrap();
        let hops = saved_route(&expanded).unwrap();
        assert_eq!(
            hops.iter().map(|h| h.endpoint.host()).collect::<Vec<_>>(),
            vec!["outer.invalid", "inner.invalid", "last.invalid"]
        );
        for extra in [
            json!({"sshTunnel":{"enabled":true,"connectionId":"ssh"}}),
            json!({"openvpn":{"enabled":true}}),
            json!({"tunnelChain":[{"enabled":true,"type":"ssh-jump"}]}),
        ] {
            assert!(expand_catalog_with_prefix(
                &json!({"security":extra}),
                &catalog,
                vec![prefix.clone()]
            )
            .is_err());
        }
        assert!(
            expand_catalog_with_prefix(&json!({}), &catalog, vec![prefix.clone(), prefix]).is_err()
        );
    }

    #[test]
    fn saved_catalog_profiles_and_strict_chains_keep_order_and_auth() {
        let catalog = json!({"profiles":[
            {"id":"tls","config":{"type":"https","host":"proxy.invalid","port":443,"username":"user","password":"secret","enabled":true}},
            {"id":"socks","config":{"type":"socks5","host":"inside.invalid","port":1080,"enabled":true}}
        ],"chains":[{"id":"chain","dynamics":{"strategy":"strict"},"layers":[
            {"position":2,"type":"proxy","proxyProfileId":"socks"},
            {"position":1,"type":"proxy","proxyProfileId":"tls"}
        ]}]});
        let result = expand_catalog(&json!({"proxyChainId":"chain"}), &catalog).unwrap();
        let hops = saved_route(&result).unwrap();
        assert!(matches!(hops[0].kind, ProxyKind::Https));
        assert_eq!(hops[0].username.as_str(), "user");
        assert_eq!(hops[1].endpoint.host(), "inside.invalid");
        assert!(expand_catalog(&json!({"proxyProfileId":"missing"}), &catalog).is_err());
        let shadowed = expand_catalog(
            &json!({"proxyProfileId":"tls","proxyChainId":"missing"}),
            &catalog,
        )
        .unwrap();
        assert_eq!(saved_route(&shadowed).unwrap().len(), 1);
        let mut dynamic = catalog.clone();
        dynamic["chains"][0]["dynamics"]["strategy"] = "failover".into();
        assert!(expand_catalog(&json!({"proxyChainId":"chain"}), &dynamic).is_err());
    }
}
