//! Native saved profile/chain expansion. Catalog bytes come only from the
//! managed profile storage, never the renderer or a global connection search.
use super::*;
use crate::database_protection::native_browser_owner::{SourceCheck, SourceDependencies};
use sha2::{Digest, Sha256};
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
    let sources = RouteSources {
        storage: storage.inner().clone(),
        chain: chain_id
            .zip(services.as_ref())
            .map(|(id, services)| (services.chains.clone(), id.to_owned())),
    };
    let (catalog, prefix) = sources.read().await.map_err(|_| ERROR)?;
    let (expanded, binding) = sources.bind(connection, &catalog, prefix)?;
    if !lease.is_current() {
        return Err(ERROR);
    }
    if let Some(services) = &services {
        services.check_owner(state, lease)?;
    }
    lease
        .register_source_dependencies(Arc::new(binding))
        .map_err(|_| ERROR)?;
    Ok(expanded)
}

/// Everything an expansion reads besides the saved row. Captured at setup, so
/// a recheck compares the same storage and chain service and never looks them
/// up again through a window.
struct RouteSources {
    storage: sorng_storage::storage::SecureStorageState,
    chain: Option<(crate::chaining::ChainingServiceState, String)>,
}

enum Unresolved {
    /// The catalog could not be read at all: no evidence about its records.
    Unreadable,
    /// The records are readable and do not yield a supported route.
    Unsupported,
}

impl From<NativeAuthorityError> for Unresolved {
    fn from(_: NativeAuthorityError) -> Self {
        Self::Unsupported
    }
}

impl RouteSources {
    async fn chain_profiles(&self) -> Result<Vec<String>, Unresolved> {
        let Some((chains, id)) = &self.chain else {
            return Ok(Vec::new());
        };
        let chain = chains
            .lock()
            .await
            .get_chain(id)
            .await
            .map_err(|_| Unresolved::Unsupported)?;
        Ok(proxy_chain_ids(&chain, id)?)
    }

    /// One read of the saved catalog and of the native chain's proxy prefix.
    async fn read(&self) -> Result<(Value, Vec<Value>), Unresolved> {
        let chain_profiles = self.chain_profiles().await?;
        let raw = sorng_storage::storage::lock_app_data(&self.storage)
            .await
            .read_app_data("proxy_collection_data")
            .await
            .map_err(|_| Unresolved::Unreadable)?
            .ok_or(Unresolved::Unsupported)?;
        let raw = Zeroizing::new(raw);
        if raw.len() > 8 * 1024 * 1024 {
            return Err(Unresolved::Unsupported);
        }
        let catalog: Value = serde_json::from_str(&raw).map_err(|_| Unresolved::Unsupported)?;
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
        if self.chain.is_some() && self.chain_profiles().await? != chain_profiles {
            return Err(Unresolved::Unsupported);
        }
        Ok((catalog, prefix))
    }

    fn expand(
        &self,
        connection: &Value,
        catalog: &Value,
        prefix: Vec<Value>,
    ) -> Result<Value, NativeAuthorityError> {
        let mut connection = connection.clone();
        if self.chain.is_some() {
            // Erase the saved selector only once every layer has been resolved.
            connection
                .as_object_mut()
                .ok_or(ERROR)?
                .remove("connectionChainId");
        }
        expand_catalog_with_prefix(&connection, catalog, prefix)
    }

    /// Expand `connection` against one read of its records, and bind what
    /// the attempt will dial through to the records it came from.
    fn bind(
        self,
        connection: &Value,
        catalog: &Value,
        prefix: Vec<Value>,
    ) -> Result<(Value, RouteBinding), NativeAuthorityError> {
        let expanded = self.expand(connection, catalog, prefix.clone())?;
        let binding = RouteBinding {
            selectors: route_selectors(connection)?,
            fingerprint: route_fingerprint(&saved_route(&expanded)?),
            sources: self,
        };
        // The binding must reproduce this exact route from the selectors
        // alone, or a recheck would compare something else.
        if !binding.current(catalog, prefix) {
            return Err(ERROR);
        }
        Ok((expanded, binding))
    }
}

/// The only parts of the saved row an expansion reads. The row itself is bound
/// by the lease's digest, so they cannot change under a live attempt.
const SELECTORS: [&str; 6] = [
    "proxyProfileId",
    "proxyChainId",
    "tunnelProfileId",
    "tunnelChainId",
    "connectionChainId",
    "security",
];

fn route_selectors(connection: &Value) -> Result<Zeroizing<String>, NativeAuthorityError> {
    let row = connection.as_object().ok_or(ERROR)?;
    let selectors: std::collections::BTreeMap<&str, &Value> = SELECTORS
        .iter()
        .filter_map(|key| Some((*key, row.get(*key)?)))
        .collect();
    serde_json::to_string(&selectors)
        .map(Zeroizing::new)
        .map_err(|_| ERROR)
}

/// One-way binding of exactly what an attempt dials through: every hop's
/// kind, endpoint and proxy credentials, in order.
fn route_fingerprint(hops: &[ProxyHop]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update((hops.len() as u64).to_le_bytes());
    for hop in hops {
        hasher.update([match hop.kind {
            ProxyKind::Http => 1u8,
            ProxyKind::Https => 2,
            ProxyKind::Socks4 => 3,
            ProxyKind::Socks5 => 4,
        }]);
        let endpoint = hop.endpoint.to_string();
        for part in [
            endpoint.as_str(),
            hop.username.as_str(),
            hop.password.as_str(),
        ] {
            hasher.update((part.len() as u64).to_le_bytes());
            hasher.update(part.as_bytes());
        }
    }
    hasher.finalize().into()
}

/// A catalog route's saved records live outside the owning database, so the
/// lease's own digests cannot see them change. This keeps the route an
/// attempt was given and expands the current records again on every recheck:
/// an edit that leaves the attempt on a different route than the saved one
/// (or on none) ends it, and an edit elsewhere in the catalog does not.
struct RouteBinding {
    sources: RouteSources,
    selectors: Zeroizing<String>,
    fingerprint: [u8; 32],
}

impl RouteBinding {
    /// Whether these records still yield the route the attempt was given.
    fn current(&self, catalog: &Value, prefix: Vec<Value>) -> bool {
        let Ok(selectors) = serde_json::from_str::<Value>(&self.selectors) else {
            return false;
        };
        self.sources
            .expand(&selectors, catalog, prefix)
            .and_then(|expanded| saved_route(&expanded))
            .is_ok_and(|hops| route_fingerprint(&hops) == self.fingerprint)
    }
}

impl SourceDependencies for RouteBinding {
    fn check(
        &self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = SourceCheck> + Send + '_>> {
        Box::pin(async move {
            match self.sources.read().await {
                Ok((catalog, prefix)) => {
                    if self.current(&catalog, prefix) {
                        SourceCheck::Current
                    } else {
                        SourceCheck::Changed
                    }
                }
                Err(Unresolved::Unsupported) => SourceCheck::Changed,
                Err(Unresolved::Unreadable) => SourceCheck::Unavailable,
            }
        })
    }
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

    fn sources(root: &std::path::Path) -> RouteSources {
        RouteSources {
            storage: sorng_storage::storage::SecureStorage::new(
                root.join("storage.json").to_string_lossy().into(),
            ),
            chain: None,
        }
    }

    fn saved_catalog() -> Value {
        json!({"profiles":[
            {"id":"outer","name":"Outer","config":{"enabled":true,"type":"http","host":"127.0.0.1","port":1,"username":""}},
            {"id":"inner","config":{"enabled":true,"type":"socks5","host":"inside.invalid","port":1080}}
        ],"chains":[{"id":"chain","dynamics":{"strategy":"strict"},"layers":[
            {"position":1,"type":"proxy","proxyProfileId":"outer"}
        ]}],"tunnelProfiles":[
            {"id":"tunnel","config":{"enabled":true,"type":"proxy","proxy":{"proxyType":"http","host":"127.0.0.1","port":1}}}
        ],"tunnelChains":[{"id":"tunnels","dynamics":{"strategy":"strict"},"layers":[
            {"enabled":true,"type":"proxy","proxy":{"proxyType":"http","host":"127.0.0.1","port":1}}
        ]}]})
    }

    fn selector(key: &str, value: Value) -> Value {
        let mut row = json!({"id":"saved", "password":"row-fixture-secret"});
        row[key] = value;
        row
    }

    // The comparison itself needs no storage: these two tests never read it.
    #[test]
    fn binding_follows_every_saved_record_a_route_is_expanded_from() {
        let saved = saved_catalog();
        let inline = json!({"tunnelChain":[
            {"id":"layer","type":"proxy","enabled":true,"tunnelProfileId":"tunnel"}
        ]});
        for (key, value, pointer, edit) in [
            ("proxyProfileId", json!("outer"), "/profiles/0/config/host", json!("elsewhere.invalid")),
            ("proxyProfileId", json!("outer"), "/profiles/0/config/port", json!(2)),
            ("proxyProfileId", json!("outer"), "/profiles/0/config/username", json!("user")),
            ("proxyProfileId", json!("outer"), "/profiles/0/config/type", json!("socks5")),
            // The record still exists but no longer yields a supported route.
            ("proxyProfileId", json!("outer"), "/profiles/0/config/enabled", json!(false)),
            ("proxyProfileId", json!("outer"), "/profiles/0/config/type", json!("ssh")),
            // The record is gone, or the catalog is no longer a catalog.
            ("proxyProfileId", json!("outer"), "/profiles/0/id", json!("renamed")),
            ("proxyProfileId", json!("outer"), "/profiles", json!([])),
            ("proxyProfileId", json!("outer"), "", json!("not a catalog")),
            ("proxyChainId", json!("chain"), "/chains/0/layers/0/proxyProfileId", json!("inner")),
            ("proxyChainId", json!("chain"), "/chains/0/dynamics/strategy", json!("failover")),
            ("proxyChainId", json!("chain"), "/profiles/0/config/host", json!("elsewhere.invalid")),
            ("tunnelProfileId", json!("tunnel"), "/tunnelProfiles/0/config/proxy/port", json!(2)),
            ("tunnelChainId", json!("tunnels"), "/tunnelChains/0/layers/0/proxy/host", json!("elsewhere.invalid")),
            ("security", inline, "/tunnelProfiles/0/config/proxy/host", json!("elsewhere.invalid")),
        ] {
            let (expanded, binding) = sources(std::path::Path::new("unread"))
                .bind(&selector(key, value), &saved, Vec::new())
                .unwrap();
            assert_eq!(saved_route(&expanded).unwrap().len(), 1, "{key}");
            assert!(binding.current(&saved, Vec::new()), "{key} {pointer}");
            let mut edited = saved.clone();
            *edited.pointer_mut(pointer).unwrap() = edit;
            assert!(!binding.current(&edited, Vec::new()), "{key} {pointer}");
            // A native chain's proxy prefix is part of the route as well.
            let prefix = enabled_proxy(&saved["profiles"][1]["config"]).unwrap();
            assert!(!binding.current(&saved, vec![prefix]), "{key}");
        }
    }

    #[test]
    fn binding_ignores_catalog_edits_that_leave_the_route_as_it_is() {
        let saved = saved_catalog();
        let (_, binding) = sources(std::path::Path::new("unread"))
            .bind(&selector("proxyProfileId", json!("outer")), &saved, Vec::new())
            .unwrap();
        let mut edited = saved.clone();
        // Another profile, a label, a new record, other collections and order.
        edited["profiles"][1]["config"]["host"] = "elsewhere.invalid".into();
        edited["profiles"][0]["name"] = "Renamed".into();
        edited["profiles"][0]["description"] = "Lab uplink".into();
        edited["profiles"].as_array_mut().unwrap().push(
            json!({"id":"new","config":{"enabled":true,"type":"http","host":"new.invalid","port":3128}}),
        );
        edited["profiles"].as_array_mut().unwrap().reverse();
        edited["chains"] = json!([]);
        edited["tunnelProfiles"][0]["config"]["proxy"]["port"] = 2.into();
        assert!(binding.current(&edited, Vec::new()));
        // No binding is made from records that do not yield a supported route.
        assert!(sources(std::path::Path::new("unread"))
            .bind(
                &selector("proxyProfileId", json!("missing")),
                &saved,
                Vec::new()
            )
            .is_err());
    }

    #[tokio::test]
    async fn binding_rereads_the_saved_catalog_and_an_unreadable_one_is_not_an_edit() {
        let saved = saved_catalog();
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("storage.json");
        // Written directly: a durable write through the storage service holds
        // the process-wide settings coordinator, which other tests probe.
        let store = |catalog: Option<&Value>| {
            let mut data = json!({"connections":[], "settings":{}, "timestamp":0, "app_data":{}});
            if let Some(catalog) = catalog {
                data["app_data"]["proxy_collection_data"] = catalog.to_string().into();
            }
            std::fs::write(&path, data.to_string()).unwrap();
        };
        store(Some(&saved));
        let stored = sources(root.path());
        let (catalog, prefix) = stored.read().await.ok().unwrap();
        assert_eq!(catalog, saved);
        let (_, binding) = stored
            .bind(&selector("proxyProfileId", json!("outer")), &catalog, prefix)
            .unwrap();
        assert_eq!(binding.check().await, SourceCheck::Current);
        let mut edited = saved.clone();
        edited["profiles"][0]["config"]["port"] = 2.into();
        store(Some(&edited));
        assert_eq!(binding.check().await, SourceCheck::Changed);
        store(None);
        assert_eq!(binding.check().await, SourceCheck::Changed);
        std::fs::remove_file(&path).unwrap();
        assert_eq!(binding.check().await, SourceCheck::Changed);
        std::fs::write(&path, b"not a storage document").unwrap();
        assert_eq!(binding.check().await, SourceCheck::Unavailable);
        // The binding keeps no verdict of its own: latching is the lease's part.
        store(Some(&saved));
        assert_eq!(binding.check().await, SourceCheck::Current);
    }

    #[test]
    fn binding_keeps_only_route_selectors_and_fingerprints_every_hop_field() {
        let selectors = route_selectors(&json!({"id":"saved", "name":"Example",
            "password":"row-fixture-secret", "proxyProfileId":"outer",
            "security":{"proxy":{"enabled":false}}, "futureField":true}))
        .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&selectors).unwrap(),
            json!({"proxyProfileId":"outer", "security":{"proxy":{"enabled":false}}})
        );
        let hop = |kind: &str, host: &str, port: u16, username: &str, password: &str| {
            json!({"enabled":true, "type":"proxy", "proxy":{"proxyType":kind, "host":host,
                "port":port, "username":username, "password":password}})
        };
        let route = |layers: Vec<Value>| {
            route_fingerprint(&saved_route(&json!({"security":{"tunnelChain":layers}})).unwrap())
        };
        let first = || hop("http", "one.invalid", 1, "user", "secret");
        let second = || hop("socks5", "two.invalid", 2, "", "");
        let routes = [
            route(vec![first(), second()]),
            route(vec![second(), first()]),
            route(vec![first()]),
            route(vec![first(), second(), second()]),
            route(vec![hop("https", "one.invalid", 1, "user", "secret"), second()]),
            route(vec![hop("http", "other.invalid", 1, "user", "secret"), second()]),
            route(vec![hop("http", "one.invalid", 3, "user", "secret"), second()]),
            route(vec![hop("http", "one.invalid", 1, "other", "secret"), second()]),
            route(vec![hop("http", "one.invalid", 1, "user", "other"), second()]),
            // Field boundaries are part of the binding.
            route(vec![hop("http", "one.invalid", 1, "users", "ecret"), second()]),
        ];
        let distinct: std::collections::BTreeSet<_> = routes.iter().collect();
        assert_eq!(distinct.len(), routes.len());
        assert_eq!(routes[0], route(vec![first(), second()]));
    }
}
