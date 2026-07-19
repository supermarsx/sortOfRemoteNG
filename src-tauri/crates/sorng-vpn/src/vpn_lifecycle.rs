//! Session-owned VPN lease orchestration.
//!
//! A VPN is a machine-wide resource, while SSH/RDP sessions are independent
//! consumers.  This module keeps those lifetimes separate: sessions acquire a
//! lease before dialing their target and the VPN is disconnected only after
//! the final lease is released.  VPNs that were already active before the
//! first lease are never disconnected by this lifecycle manager.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::Mutex;

pub type VpnLeaseServiceState = Arc<Mutex<VpnLeaseRegistry>>;

pub fn new_vpn_lease_service_state() -> VpnLeaseServiceState {
    Arc::new(Mutex::new(VpnLeaseRegistry::default()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum RuntimeVpnType {
    OpenVpn,
    WireGuard,
    Tailscale,
    ZeroTier,
}

impl RuntimeVpnType {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "openvpn" => Ok(Self::OpenVpn),
            "wireguard" => Ok(Self::WireGuard),
            "tailscale" => Ok(Self::Tailscale),
            "zerotier" => Ok(Self::ZeroTier),
            other => Err(format!("Unsupported VPN type: {other}")),
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::OpenVpn => "openvpn",
            Self::WireGuard => "wireguard",
            Self::Tailscale => "tailscale",
            Self::ZeroTier => "zerotier",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct VpnLeaseKey {
    pub vpn_type: RuntimeVpnType,
    pub connection_id: String,
}

impl VpnLeaseKey {
    fn label(&self) -> String {
        format!("{} VPN '{}'", self.vpn_type.as_str(), self.connection_id)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VpnLeaseRequest {
    pub vpn_type: String,
    pub connection_id: String,
    #[serde(default = "default_auto_connect")]
    pub auto_connect: bool,
}

const fn default_auto_connect() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AcquiredVpnLease {
    pub vpn_type: String,
    pub connection_id: String,
    pub was_already_connected: bool,
    pub already_owned: bool,
    pub started_by_lifecycle: bool,
    pub lease_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AcquireVpnLeasesResult {
    pub owner_id: String,
    pub leases: Vec<AcquiredVpnLease>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReleasedVpnLease {
    pub vpn_type: String,
    pub connection_id: String,
    pub disconnected: bool,
    pub remaining_leases: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReleaseVpnLeasesResult {
    pub owner_id: String,
    pub released: Vec<ReleasedVpnLease>,
    pub errors: Vec<String>,
}

#[derive(Debug, Default)]
pub struct VpnLeaseRegistry {
    entries: HashMap<VpnLeaseKey, VpnLeaseEntry>,
}

#[derive(Debug, Default)]
struct VpnLeaseEntry {
    owners: HashSet<String>,
    started_by_lifecycle: bool,
}

/// Runtime operations are implemented by the Tauri command adapter.  Keeping
/// them behind a small trait makes the lease/refcount contract independently
/// testable without invoking provider binaries or touching network state.
#[allow(async_fn_in_trait)]
pub trait VpnRuntime {
    async fn is_active(&mut self, key: &VpnLeaseKey) -> bool;
    async fn connect(&mut self, key: &VpnLeaseKey) -> Result<(), String>;
    async fn disconnect(&mut self, key: &VpnLeaseKey) -> Result<(), String>;
}

fn validate_owner(owner_id: &str) -> Result<String, String> {
    let owner_id = owner_id.trim();
    if owner_id.is_empty() {
        return Err("VPN lease owner_id must not be empty".to_string());
    }
    Ok(owner_id.to_string())
}

fn validate_requests(requests: Vec<VpnLeaseRequest>) -> Result<Vec<(VpnLeaseKey, bool)>, String> {
    let mut validated = Vec::<(VpnLeaseKey, bool)>::new();
    let mut indexes = HashMap::<VpnLeaseKey, usize>::new();

    for request in requests {
        let vpn_type = RuntimeVpnType::parse(&request.vpn_type)?;
        let connection_id = request.connection_id.trim();
        if connection_id.is_empty() {
            return Err(format!(
                "{} VPN connection_id must not be empty",
                vpn_type.as_str()
            ));
        }

        let key = VpnLeaseKey {
            vpn_type,
            connection_id: connection_id.to_string(),
        };
        if let Some(index) = indexes.get(&key).copied() {
            // Duplicate path layers are one machine-wide resource.  Preserve
            // order while accepting auto-connect if any duplicate requests it.
            validated[index].1 |= request.auto_connect;
        } else {
            indexes.insert(key.clone(), validated.len());
            validated.push((key, request.auto_connect));
        }
    }

    Ok(validated)
}

pub async fn acquire_session_vpn_leases<R: VpnRuntime>(
    registry: &mut VpnLeaseRegistry,
    owner_id: &str,
    requests: Vec<VpnLeaseRequest>,
    runtime: &mut R,
) -> Result<AcquireVpnLeasesResult, String> {
    let owner_id = validate_owner(owner_id)?;
    // Validate the complete path before connecting its first layer.  An
    // unsupported/malformed later layer must not leave a partial VPN path.
    let requests = validate_requests(requests)?;
    let mut acquired_this_call = Vec::<VpnLeaseKey>::new();
    let mut leases = Vec::<AcquiredVpnLease>::new();

    for (key, auto_connect) in requests {
        let already_owned = registry
            .entries
            .get(&key)
            .is_some_and(|entry| entry.owners.contains(&owner_id));
        let was_already_connected = runtime.is_active(&key).await;

        if !was_already_connected {
            if !auto_connect {
                let rollback_errors =
                    rollback_new_acquisitions(registry, &owner_id, &acquired_this_call, runtime)
                        .await;
                return Err(acquire_error(
                    &key,
                    "is not connected and auto-connect is disabled",
                    rollback_errors,
                ));
            }

            if let Err(error) = runtime.connect(&key).await {
                let rollback_errors =
                    rollback_new_acquisitions(registry, &owner_id, &acquired_this_call, runtime)
                        .await;
                return Err(acquire_error(&key, &error, rollback_errors));
            }

            // A provider reporting success before it is usable must not allow
            // the target protocol to fall through to a premature direct dial.
            if !runtime.is_active(&key).await {
                let rollback_errors =
                    rollback_new_acquisitions(registry, &owner_id, &acquired_this_call, runtime)
                        .await;
                return Err(acquire_error(
                    &key,
                    "provider returned success but the VPN is not active",
                    rollback_errors,
                ));
            }
        }

        let entry = registry.entries.entry(key.clone()).or_default();
        if !was_already_connected {
            entry.started_by_lifecycle = true;
        }
        if entry.owners.insert(owner_id.clone()) {
            acquired_this_call.push(key.clone());
        }

        leases.push(AcquiredVpnLease {
            vpn_type: key.vpn_type.as_str().to_string(),
            connection_id: key.connection_id,
            was_already_connected,
            already_owned,
            started_by_lifecycle: entry.started_by_lifecycle,
            lease_count: entry.owners.len(),
        });
    }

    Ok(AcquireVpnLeasesResult { owner_id, leases })
}

pub async fn release_session_vpn_leases<R: VpnRuntime>(
    registry: &mut VpnLeaseRegistry,
    owner_id: &str,
    runtime: &mut R,
) -> Result<ReleaseVpnLeasesResult, String> {
    let owner_id = validate_owner(owner_id)?;
    let mut keys = registry
        .entries
        .iter()
        .filter_map(|(key, entry)| {
            // Empty lifecycle-owned entries are failed disconnects from an
            // earlier cleanup.  Retry them on any later release, including an
            // idempotent repeat from the same session.
            if entry.owners.contains(&owner_id)
                || (entry.owners.is_empty() && entry.started_by_lifecycle)
            {
                Some(key.clone())
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    keys.sort();

    let mut released = Vec::new();
    let mut errors = Vec::new();
    for key in keys {
        match release_key(registry, &owner_id, &key, runtime).await {
            Ok(Some(result)) => released.push(result),
            Ok(None) => {}
            Err(error) => errors.push(error),
        }
    }

    Ok(ReleaseVpnLeasesResult {
        owner_id,
        released,
        errors,
    })
}

fn acquire_error(key: &VpnLeaseKey, error: &str, rollback_errors: Vec<String>) -> String {
    let mut message = format!("Failed to acquire {}: {error}", key.label());
    if !rollback_errors.is_empty() {
        message.push_str("; rollback cleanup failed: ");
        message.push_str(&rollback_errors.join("; "));
    }
    message
}

async fn rollback_new_acquisitions<R: VpnRuntime>(
    registry: &mut VpnLeaseRegistry,
    owner_id: &str,
    keys: &[VpnLeaseKey],
    runtime: &mut R,
) -> Vec<String> {
    let mut errors = Vec::new();
    for key in keys.iter().rev() {
        if let Err(error) = release_key(registry, owner_id, key, runtime).await {
            errors.push(error);
        }
    }
    errors
}

async fn release_key<R: VpnRuntime>(
    registry: &mut VpnLeaseRegistry,
    owner_id: &str,
    key: &VpnLeaseKey,
    runtime: &mut R,
) -> Result<Option<ReleasedVpnLease>, String> {
    let Some(entry) = registry.entries.get_mut(key) else {
        return Ok(None);
    };

    let removed_owner = entry.owners.remove(owner_id);
    if !removed_owner && !entry.owners.is_empty() {
        return Ok(None);
    }

    let remaining_leases = entry.owners.len();
    let started_by_lifecycle = entry.started_by_lifecycle;
    if remaining_leases > 0 {
        return Ok(Some(ReleasedVpnLease {
            vpn_type: key.vpn_type.as_str().to_string(),
            connection_id: key.connection_id.clone(),
            disconnected: false,
            remaining_leases,
        }));
    }

    if !started_by_lifecycle {
        registry.entries.remove(key);
        return Ok(Some(ReleasedVpnLease {
            vpn_type: key.vpn_type.as_str().to_string(),
            connection_id: key.connection_id.clone(),
            disconnected: false,
            remaining_leases: 0,
        }));
    }

    if !runtime.is_active(key).await {
        registry.entries.remove(key);
        return Ok(Some(ReleasedVpnLease {
            vpn_type: key.vpn_type.as_str().to_string(),
            connection_id: key.connection_id.clone(),
            disconnected: false,
            remaining_leases: 0,
        }));
    }

    match runtime.disconnect(key).await {
        Ok(()) => {
            registry.entries.remove(key);
            Ok(Some(ReleasedVpnLease {
                vpn_type: key.vpn_type.as_str().to_string(),
                connection_id: key.connection_id.clone(),
                disconnected: true,
                remaining_leases: 0,
            }))
        }
        Err(error) => {
            // A provider may report an error after successfully removing its
            // interface/process.  Re-check before retaining a pending cleanup.
            if !runtime.is_active(key).await {
                registry.entries.remove(key);
                Ok(Some(ReleasedVpnLease {
                    vpn_type: key.vpn_type.as_str().to_string(),
                    connection_id: key.connection_id.clone(),
                    disconnected: true,
                    remaining_leases: 0,
                }))
            } else {
                Err(format!("Failed to release {}: {error}", key.label()))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, Default)]
    struct MockRuntime {
        active: HashSet<VpnLeaseKey>,
        connect_calls: Vec<VpnLeaseKey>,
        disconnect_calls: Vec<VpnLeaseKey>,
        fail_connect: HashSet<VpnLeaseKey>,
        fail_disconnect_once: HashSet<VpnLeaseKey>,
    }

    impl VpnRuntime for MockRuntime {
        async fn is_active(&mut self, key: &VpnLeaseKey) -> bool {
            self.active.contains(key)
        }

        async fn connect(&mut self, key: &VpnLeaseKey) -> Result<(), String> {
            self.connect_calls.push(key.clone());
            if self.fail_connect.contains(key) {
                return Err("simulated connect failure".to_string());
            }
            self.active.insert(key.clone());
            Ok(())
        }

        async fn disconnect(&mut self, key: &VpnLeaseKey) -> Result<(), String> {
            self.disconnect_calls.push(key.clone());
            if self.fail_disconnect_once.remove(key) {
                return Err("simulated disconnect failure".to_string());
            }
            self.active.remove(key);
            Ok(())
        }
    }

    fn request(vpn_type: &str, connection_id: &str) -> VpnLeaseRequest {
        VpnLeaseRequest {
            vpn_type: vpn_type.to_string(),
            connection_id: connection_id.to_string(),
            auto_connect: true,
        }
    }

    fn key(vpn_type: RuntimeVpnType, connection_id: &str) -> VpnLeaseKey {
        VpnLeaseKey {
            vpn_type,
            connection_id: connection_id.to_string(),
        }
    }

    #[tokio::test]
    async fn shared_sessions_connect_once_and_disconnect_after_final_release() {
        let mut registry = VpnLeaseRegistry::default();
        let mut runtime = MockRuntime::default();
        let wg = key(RuntimeVpnType::WireGuard, "wg-office");

        let first = acquire_session_vpn_leases(
            &mut registry,
            "ssh-1",
            vec![request("wireguard", "wg-office")],
            &mut runtime,
        )
        .await
        .unwrap();
        let second = acquire_session_vpn_leases(
            &mut registry,
            "rdp-1",
            vec![request("wireguard", "wg-office")],
            &mut runtime,
        )
        .await
        .unwrap();

        assert_eq!(runtime.connect_calls, vec![wg.clone()]);
        assert_eq!(first.leases[0].lease_count, 1);
        assert_eq!(second.leases[0].lease_count, 2);
        assert!(second.leases[0].was_already_connected);

        let first_release = release_session_vpn_leases(&mut registry, "ssh-1", &mut runtime)
            .await
            .unwrap();
        assert_eq!(first_release.released[0].remaining_leases, 1);
        assert!(runtime.disconnect_calls.is_empty());

        let final_release = release_session_vpn_leases(&mut registry, "rdp-1", &mut runtime)
            .await
            .unwrap();
        assert!(final_release.released[0].disconnected);
        assert_eq!(runtime.disconnect_calls, vec![wg]);
    }

    #[tokio::test]
    async fn repeated_acquire_and_release_are_idempotent() {
        let mut registry = VpnLeaseRegistry::default();
        let mut runtime = MockRuntime::default();
        let requests = vec![request("openvpn", "corp"), request("openvpn", "corp")];

        acquire_session_vpn_leases(&mut registry, "ssh-1", requests.clone(), &mut runtime)
            .await
            .unwrap();
        let repeated = acquire_session_vpn_leases(&mut registry, "ssh-1", requests, &mut runtime)
            .await
            .unwrap();

        assert_eq!(runtime.connect_calls.len(), 1);
        assert_eq!(repeated.leases.len(), 1);
        assert!(repeated.leases[0].already_owned);
        assert_eq!(repeated.leases[0].lease_count, 1);

        release_session_vpn_leases(&mut registry, "ssh-1", &mut runtime)
            .await
            .unwrap();
        let repeated_release = release_session_vpn_leases(&mut registry, "ssh-1", &mut runtime)
            .await
            .unwrap();
        assert!(repeated_release.released.is_empty());
        assert_eq!(runtime.disconnect_calls.len(), 1);
    }

    #[tokio::test]
    async fn externally_active_vpn_is_never_disconnected() {
        let mut registry = VpnLeaseRegistry::default();
        let mut runtime = MockRuntime::default();
        let tailscale = key(RuntimeVpnType::Tailscale, "tailnet");
        runtime.active.insert(tailscale);

        let acquired = acquire_session_vpn_leases(
            &mut registry,
            "rdp-1",
            vec![request("tailscale", "tailnet")],
            &mut runtime,
        )
        .await
        .unwrap();
        assert!(!acquired.leases[0].started_by_lifecycle);

        release_session_vpn_leases(&mut registry, "rdp-1", &mut runtime)
            .await
            .unwrap();
        assert!(runtime.disconnect_calls.is_empty());
    }

    #[tokio::test]
    async fn later_connect_failure_rolls_back_only_new_leases() {
        let mut registry = VpnLeaseRegistry::default();
        let mut runtime = MockRuntime::default();
        let openvpn = key(RuntimeVpnType::OpenVpn, "corp");
        let zerotier = key(RuntimeVpnType::ZeroTier, "private-net");
        runtime.fail_connect.insert(zerotier.clone());

        let error = acquire_session_vpn_leases(
            &mut registry,
            "ssh-1",
            vec![
                request("openvpn", "corp"),
                request("zerotier", "private-net"),
            ],
            &mut runtime,
        )
        .await
        .unwrap_err();

        assert!(error.contains("simulated connect failure"));
        assert_eq!(runtime.connect_calls, vec![openvpn.clone(), zerotier]);
        assert_eq!(runtime.disconnect_calls, vec![openvpn.clone()]);
        assert!(!runtime.active.contains(&openvpn));
        assert!(registry.entries.is_empty());
    }

    #[tokio::test]
    async fn validates_the_whole_path_before_connecting() {
        let mut registry = VpnLeaseRegistry::default();
        let mut runtime = MockRuntime::default();

        let error = acquire_session_vpn_leases(
            &mut registry,
            "ssh-1",
            vec![request("openvpn", "corp"), request("pptp", "legacy")],
            &mut runtime,
        )
        .await
        .unwrap_err();

        assert!(error.contains("Unsupported VPN type"));
        assert!(runtime.connect_calls.is_empty());
        assert!(registry.entries.is_empty());
    }

    #[tokio::test]
    async fn failed_disconnect_is_retained_and_retried_idempotently() {
        let mut registry = VpnLeaseRegistry::default();
        let mut runtime = MockRuntime::default();
        let wg = key(RuntimeVpnType::WireGuard, "wg-office");

        acquire_session_vpn_leases(
            &mut registry,
            "ssh-1",
            vec![request("wireguard", "wg-office")],
            &mut runtime,
        )
        .await
        .unwrap();
        runtime.fail_disconnect_once.insert(wg.clone());

        let first = release_session_vpn_leases(&mut registry, "ssh-1", &mut runtime)
            .await
            .unwrap();
        assert_eq!(first.errors.len(), 1);
        assert!(registry.entries.contains_key(&wg));

        let retry = release_session_vpn_leases(&mut registry, "ssh-1", &mut runtime)
            .await
            .unwrap();
        assert!(retry.errors.is_empty());
        assert!(retry.released[0].disconnected);
        assert!(!registry.entries.contains_key(&wg));
        assert_eq!(runtime.disconnect_calls, vec![wg.clone(), wg]);
    }
}
