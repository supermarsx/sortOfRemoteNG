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
    /// Exact registry snapshots displaced by a partial provider start whose
    /// compensating teardown also failed. A later release retries teardown and
    /// then restores (and releases from) this prior logical lease state.
    rollback_restores: HashMap<VpnLeaseKey, Option<VpnLeaseEntry>>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct VpnLeaseEntry {
    owners: HashSet<String>,
    started_by_lifecycle: bool,
    cleanup_pending: bool,
}

#[derive(Debug, Clone)]
struct VpnLeaseAcquisitionRollback {
    key: VpnLeaseKey,
    previous_entry: Option<VpnLeaseEntry>,
    started_resource: bool,
}

/// Runtime operations are implemented by the Tauri command adapter.  Keeping
/// them behind a small trait makes the lease/refcount contract independently
/// testable without invoking provider binaries or touching network state.
#[allow(async_fn_in_trait)]
pub trait VpnRuntime {
    /// Return `Ok(true)` only when the provider can confirm that the profile
    /// is usable, `Ok(false)` only when it can confirm inactivity, and `Err`
    /// when the provider cannot safely distinguish those states.
    async fn probe_active(&mut self, key: &VpnLeaseKey) -> Result<bool, String>;
    async fn connect(&mut self, key: &VpnLeaseKey) -> Result<(), String>;
    async fn disconnect(&mut self, key: &VpnLeaseKey) -> Result<(), String>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VpnLeaseUsage {
    pub owner_count: usize,
    pub cleanup_pending: bool,
}

impl VpnLeaseRegistry {
    pub fn usage(&self, key: &VpnLeaseKey) -> Option<VpnLeaseUsage> {
        self.entries.get(key).map(|entry| VpnLeaseUsage {
            owner_count: entry.owners.len(),
            cleanup_pending: entry.cleanup_pending,
        })
    }

    /// Guard direct provider teardown while the caller keeps the registry
    /// mutex locked. The error intentionally exposes only an aggregate count,
    /// never session identifiers.
    pub fn ensure_direct_teardown_allowed(
        &self,
        key: &VpnLeaseKey,
        action: &str,
    ) -> Result<(), String> {
        let Some(usage) = self.usage(key) else {
            return Ok(());
        };

        if usage.owner_count > 0 {
            return Err(format!(
                "Cannot directly {action} {} while it is leased by {} active session{}; release the session VPN lease{} first",
                key.label(),
                usage.owner_count,
                if usage.owner_count == 1 { "" } else { "s" },
                if usage.owner_count == 1 { "" } else { "s" },
            ));
        }

        if usage.cleanup_pending {
            return Err(format!(
                "Cannot directly {action} {} while lifecycle cleanup is pending; retry the session VPN release first",
                key.label()
            ));
        }

        Ok(())
    }
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
    let mut acquired_this_call = Vec::<VpnLeaseAcquisitionRollback>::new();
    let mut leases = Vec::<AcquiredVpnLease>::new();

    for (key, auto_connect) in requests {
        if registry
            .entries
            .get(&key)
            .is_some_and(|entry| entry.cleanup_pending)
        {
            let rollback_errors =
                rollback_new_acquisitions(registry, &acquired_this_call, runtime).await;
            return Err(acquire_error(
                &key,
                "has lifecycle cleanup pending; retry the session VPN release before reconnecting",
                rollback_errors,
            ));
        }
        let already_owned = registry
            .entries
            .get(&key)
            .is_some_and(|entry| entry.owners.contains(&owner_id));
        let previous_entry = registry.entries.get(&key).cloned();
        let was_already_connected = match runtime.probe_active(&key).await {
            Ok(active) => active,
            Err(error) => {
                let rollback_errors =
                    rollback_new_acquisitions(registry, &acquired_this_call, runtime).await;
                return Err(acquire_error(
                    &key,
                    &format!("could not determine whether the VPN is active: {error}"),
                    rollback_errors,
                ));
            }
        };

        if !was_already_connected {
            if !auto_connect {
                let rollback_errors =
                    rollback_new_acquisitions(registry, &acquired_this_call, runtime).await;
                return Err(acquire_error(
                    &key,
                    "is not connected and auto-connect is disabled",
                    rollback_errors,
                ));
            }

            if let Err(error) = runtime.connect(&key).await {
                let mut rollback_errors = Vec::new();
                if let Err(cleanup_error) = compensate_failed_connect(
                    registry,
                    &owner_id,
                    &key,
                    previous_entry.clone(),
                    runtime,
                )
                .await
                {
                    rollback_errors.push(cleanup_error);
                }
                let rollback_errors = [
                    rollback_errors,
                    rollback_new_acquisitions(registry, &acquired_this_call, runtime).await,
                ]
                .concat();
                return Err(acquire_error(&key, &error, rollback_errors));
            }

            // Once connect reports success, this process owns the resulting
            // machine-wide resource even if the readiness probe subsequently
            // fails. Record ownership before probing so rollback includes this
            // exact key and a failed disconnect remains retryable state.
            let entry = registry.entries.entry(key.clone()).or_default();
            entry.started_by_lifecycle = true;
            entry.cleanup_pending = true;
            entry.owners.insert(owner_id.clone());

            // A provider reporting success before it is usable must not allow
            // the target protocol to fall through to a premature direct dial.
            let readiness_error = match runtime.probe_active(&key).await {
                Ok(true) => None,
                Ok(false) => {
                    Some("provider returned success but the VPN is not active".to_string())
                }
                Err(error) => Some(format!(
                    "provider returned success but readiness could not be verified: {error}"
                )),
            };
            if let Some(error) = readiness_error {
                let mut rollback_errors = Vec::new();
                if let Err(cleanup_error) =
                    rollback_failed_start(registry, &key, previous_entry.clone(), runtime).await
                {
                    rollback_errors.push(cleanup_error);
                }
                rollback_errors.extend(
                    rollback_new_acquisitions(registry, &acquired_this_call, runtime).await,
                );
                return Err(acquire_error(&key, &error, rollback_errors));
            }

            registry
                .entries
                .get_mut(&key)
                .expect("lease ownership recorded before readiness")
                .cleanup_pending = false;
            // Reconnecting an unexpectedly inactive resource is a mutation of
            // this acquisition transaction even when the same owner already
            // held the logical lease. If a later layer fails, tear this start
            // back down and restore the exact prior logical snapshot.
            acquired_this_call.push(VpnLeaseAcquisitionRollback {
                key: key.clone(),
                previous_entry: previous_entry.clone(),
                started_resource: true,
            });
        }

        let entry = registry.entries.entry(key.clone()).or_default();
        if !was_already_connected {
            entry.started_by_lifecycle = true;
        }
        if entry.owners.insert(owner_id.clone()) {
            acquired_this_call.push(VpnLeaseAcquisitionRollback {
                key: key.clone(),
                previous_entry,
                started_resource: false,
            });
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
    acquisitions: &[VpnLeaseAcquisitionRollback],
    runtime: &mut R,
) -> Vec<String> {
    let mut errors = Vec::new();
    for acquisition in acquisitions.iter().rev() {
        if acquisition.started_resource {
            if let Err(error) = rollback_failed_start(
                registry,
                &acquisition.key,
                acquisition.previous_entry.clone(),
                runtime,
            )
            .await
            {
                errors.push(error);
            }
        } else if let Some(previous_entry) = acquisition.previous_entry.clone() {
            registry
                .entries
                .insert(acquisition.key.clone(), previous_entry);
        } else {
            registry.entries.remove(&acquisition.key);
        }
    }
    errors
}

/// A provider may report a connect error after it has already created
/// machine-wide state. Probe the exact profile after the error; confirmed
/// inactivity needs no mutation, while active or uncertain state must be
/// compensated and retained for retry if teardown cannot be confirmed.
async fn compensate_failed_connect<R: VpnRuntime>(
    registry: &mut VpnLeaseRegistry,
    owner_id: &str,
    key: &VpnLeaseKey,
    previous_entry: Option<VpnLeaseEntry>,
    runtime: &mut R,
) -> Result<(), String> {
    let probe_error = match runtime.probe_active(key).await {
        Ok(false) => return Ok(()),
        Ok(true) => None,
        Err(error) => Some(error),
    };

    let entry = registry.entries.entry(key.clone()).or_default();
    entry.owners.insert(owner_id.to_string());
    entry.started_by_lifecycle = true;
    entry.cleanup_pending = true;

    rollback_failed_start(registry, key, previous_entry, runtime)
        .await
        .map_err(|cleanup_error| match probe_error {
            Some(probe_error) => format!(
                "{cleanup_error}; activity after the failed connect was also uncertain: {probe_error}"
            ),
            None => cleanup_error,
        })
}

/// A successful provider start must be compensated even when this owner was
/// already present in the registry. On successful cleanup the exact previous
/// lease entry is restored; on cleanup failure the newly recorded ownership is
/// retained with a retry marker so no partial machine-wide resource is lost.
async fn rollback_failed_start<R: VpnRuntime>(
    registry: &mut VpnLeaseRegistry,
    key: &VpnLeaseKey,
    previous_entry: Option<VpnLeaseEntry>,
    runtime: &mut R,
) -> Result<(), String> {
    match runtime.disconnect(key).await {
        Ok(()) => {
            registry.rollback_restores.remove(key);
            if let Some(previous_entry) = previous_entry {
                registry.entries.insert(key.clone(), previous_entry);
            } else {
                registry.entries.remove(key);
            }
            Ok(())
        }
        Err(error) => {
            registry
                .rollback_restores
                .entry(key.clone())
                .or_insert(previous_entry);
            let entry = registry.entries.entry(key.clone()).or_default();
            entry.started_by_lifecycle = true;
            entry.cleanup_pending = true;
            let probe_context = match runtime.probe_active(key).await {
                Ok(true) => "VPN still reports active".to_string(),
                Ok(false) => {
                    "VPN reports inactive but partial startup ownership is still unconfirmed"
                        .to_string()
                }
                Err(probe_error) => {
                    format!("post-disconnect activity probe also failed: {probe_error}")
                }
            };
            Err(format!(
                "Failed to roll back {}: {error}; {probe_context}; lease ownership was retained for retry",
                key.label()
            ))
        }
    }
}

async fn release_key<R: VpnRuntime>(
    registry: &mut VpnLeaseRegistry,
    owner_id: &str,
    key: &VpnLeaseKey,
    runtime: &mut R,
) -> Result<Option<ReleasedVpnLease>, String> {
    let Some(entry) = registry.entries.get(key) else {
        return Ok(None);
    };

    let has_owner = entry.owners.contains(owner_id);
    let owner_count = entry.owners.len();
    let started_by_lifecycle = entry.started_by_lifecycle;
    let force_started_cleanup = entry.cleanup_pending;
    if !has_owner && owner_count > 0 {
        return Ok(None);
    }

    if has_owner && owner_count > 1 && !force_started_cleanup {
        let entry = registry
            .entries
            .get_mut(key)
            .expect("lease entry inspected above");
        entry.owners.remove(owner_id);
        let remaining_leases = entry.owners.len();
        return Ok(Some(ReleasedVpnLease {
            vpn_type: key.vpn_type.as_str().to_string(),
            connection_id: key.connection_id.clone(),
            disconnected: false,
            remaining_leases,
        }));
    }

    if !started_by_lifecycle {
        if has_owner {
            registry
                .entries
                .get_mut(key)
                .expect("lease entry inspected above")
                .owners
                .remove(owner_id);
        }
        registry.entries.remove(key);
        return Ok(Some(ReleasedVpnLease {
            vpn_type: key.vpn_type.as_str().to_string(),
            connection_id: key.connection_id.clone(),
            disconnected: false,
            remaining_leases: 0,
        }));
    }

    let mut initial_probe_error = None;
    if !force_started_cleanup {
        match runtime.probe_active(key).await {
            Ok(false) => {
                registry.entries.remove(key);
                return Ok(Some(ReleasedVpnLease {
                    vpn_type: key.vpn_type.as_str().to_string(),
                    connection_id: key.connection_id.clone(),
                    disconnected: false,
                    remaining_leases: 0,
                }));
            }
            Ok(true) => {}
            Err(error) => {
                // This lifecycle started the machine-wide resource, so an
                // uncertain probe cannot safely be treated as either inactive
                // (which would leak it) or active without a teardown attempt.
                // Keep the registry lock held by the caller and try the exact
                // provider disconnect. Only a successful teardown may clear
                // ownership from this point onward.
                initial_probe_error = Some(error);
            }
        }
    }

    match runtime.disconnect(key).await {
        Ok(()) => {
            let rollback_restore = registry.rollback_restores.remove(key);
            let remaining_leases = match rollback_restore {
                Some(Some(mut previous_entry)) => {
                    // This release doubled as the retry for a failed-start
                    // compensation. Restore the exact prior logical state,
                    // then apply the caller's release to that snapshot.
                    previous_entry.owners.remove(owner_id);
                    let remaining = previous_entry.owners.len();
                    if remaining > 0 {
                        registry.entries.insert(key.clone(), previous_entry);
                    } else {
                        registry.entries.remove(key);
                    }
                    remaining
                }
                Some(None) | None => {
                    registry.entries.remove(key);
                    0
                }
            };
            Ok(Some(ReleasedVpnLease {
                vpn_type: key.vpn_type.as_str().to_string(),
                connection_id: key.connection_id.clone(),
                disconnected: true,
                remaining_leases,
            }))
        }
        Err(error) => {
            if let Some(entry) = registry.entries.get_mut(key) {
                entry.cleanup_pending = true;
            }
            if let Some(probe_error) = initial_probe_error {
                return Err(format!(
                    "Failed to release {}: activity probe failed ({probe_error}) and teardown failed ({error}); lease ownership was retained for retry",
                    key.label()
                ));
            }
            if force_started_cleanup {
                let probe_context = match runtime.probe_active(key).await {
                    Ok(true) => "VPN still reports active".to_string(),
                    Ok(false) => {
                        "VPN reports inactive but partial startup ownership is still unconfirmed"
                            .to_string()
                    }
                    Err(probe_error) => {
                        format!("post-disconnect activity probe also failed: {probe_error}")
                    }
                };
                return Err(format!(
                    "Failed to roll back {}: {error}; {probe_context}; lease ownership was retained for retry",
                    key.label()
                ));
            }
            // A provider may report an error after successfully removing its
            // interface/process.  Re-check before retaining a pending cleanup.
            match runtime.probe_active(key).await {
                Ok(false) => {
                    registry.entries.remove(key);
                    Ok(Some(ReleasedVpnLease {
                        vpn_type: key.vpn_type.as_str().to_string(),
                        connection_id: key.connection_id.clone(),
                        disconnected: true,
                        remaining_leases: 0,
                    }))
                }
                Ok(true) => Err(format!(
                    "Failed to release {}: {error}; lease ownership was retained for retry",
                    key.label()
                )),
                Err(probe_error) => Err(format!(
                    "Failed to release {}: {error}; post-disconnect activity probe also failed and lease ownership was retained for retry: {probe_error}",
                    key.label()
                )),
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
        fail_connect_after_activation: HashSet<VpnLeaseKey>,
        probe_error_after_failed_connect: HashSet<VpnLeaseKey>,
        failed_connect_retained: HashSet<VpnLeaseKey>,
        fail_disconnect_once: HashSet<VpnLeaseKey>,
        probe_errors: HashMap<VpnLeaseKey, usize>,
        connect_without_readiness: HashSet<VpnLeaseKey>,
    }

    impl VpnRuntime for MockRuntime {
        async fn probe_active(&mut self, key: &VpnLeaseKey) -> Result<bool, String> {
            if let Some(remaining) = self.probe_errors.get_mut(key) {
                if *remaining > 0 {
                    *remaining -= 1;
                    return Err("simulated activity probe failure".to_string());
                }
            }
            if self.probe_error_after_failed_connect.contains(key)
                && self.failed_connect_retained.contains(key)
            {
                return Err("simulated retained-start probe failure".to_string());
            }
            Ok(self.active.contains(key))
        }

        async fn connect(&mut self, key: &VpnLeaseKey) -> Result<(), String> {
            self.connect_calls.push(key.clone());
            if self.fail_connect.contains(key) {
                return Err("simulated connect failure".to_string());
            }
            if self.fail_connect_after_activation.contains(key) {
                self.active.insert(key.clone());
                self.failed_connect_retained.insert(key.clone());
                return Err("simulated connect failure after activation".to_string());
            }
            if !self.connect_without_readiness.contains(key) {
                self.active.insert(key.clone());
            }
            Ok(())
        }

        async fn disconnect(&mut self, key: &VpnLeaseKey) -> Result<(), String> {
            self.disconnect_calls.push(key.clone());
            if self.fail_disconnect_once.remove(key) {
                return Err("simulated disconnect failure".to_string());
            }
            self.active.remove(key);
            self.failed_connect_retained.remove(key);
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
    async fn restored_wireguard_present_is_borrowed_and_retained_after_release() {
        let mut registry = VpnLeaseRegistry::default();
        let mut runtime = MockRuntime::default();
        let wireguard = key(RuntimeVpnType::WireGuard, "wg-restored-present");
        runtime.active.insert(wireguard.clone());

        let acquired = acquire_session_vpn_leases(
            &mut registry,
            "ssh-restored",
            vec![request("wireguard", "wg-restored-present")],
            &mut runtime,
        )
        .await
        .unwrap();
        assert!(acquired.leases[0].was_already_connected);
        assert!(!acquired.leases[0].started_by_lifecycle);

        let released = release_session_vpn_leases(&mut registry, "ssh-restored", &mut runtime)
            .await
            .unwrap();
        assert!(released.errors.is_empty());
        assert!(!released.released[0].disconnected);
        assert!(runtime.active.contains(&wireguard));
        assert!(runtime.disconnect_calls.is_empty());
    }

    #[tokio::test]
    async fn restored_wireguard_absent_is_started_and_cleaned_after_release() {
        let mut registry = VpnLeaseRegistry::default();
        let mut runtime = MockRuntime::default();
        let wireguard = key(RuntimeVpnType::WireGuard, "wg-restored-absent");

        let acquired = acquire_session_vpn_leases(
            &mut registry,
            "rdp-restored",
            vec![request("wireguard", "wg-restored-absent")],
            &mut runtime,
        )
        .await
        .unwrap();
        assert!(!acquired.leases[0].was_already_connected);
        assert!(acquired.leases[0].started_by_lifecycle);

        let released = release_session_vpn_leases(&mut registry, "rdp-restored", &mut runtime)
            .await
            .unwrap();
        assert!(released.errors.is_empty());
        assert!(released.released[0].disconnected);
        assert_eq!(runtime.connect_calls, vec![wireguard.clone()]);
        assert_eq!(runtime.disconnect_calls, vec![wireguard]);
    }

    #[tokio::test]
    async fn restored_wireguard_query_error_records_no_lease() {
        let mut registry = VpnLeaseRegistry::default();
        let mut runtime = MockRuntime::default();
        let wireguard = key(RuntimeVpnType::WireGuard, "wg-restored-unknown");
        runtime.probe_errors.insert(wireguard, 1);

        let error = acquire_session_vpn_leases(
            &mut registry,
            "ssh-restored",
            vec![request("wireguard", "wg-restored-unknown")],
            &mut runtime,
        )
        .await
        .unwrap_err();
        assert!(error.contains("could not determine whether the VPN is active"));
        assert!(registry.entries.is_empty());
        assert!(runtime.connect_calls.is_empty());
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
    async fn later_failure_restores_prior_shared_lease_without_tearing_it_down() {
        let mut registry = VpnLeaseRegistry::default();
        let mut runtime = MockRuntime::default();
        let openvpn = key(RuntimeVpnType::OpenVpn, "corp-shared");
        let zerotier = key(RuntimeVpnType::ZeroTier, "private-net");

        acquire_session_vpn_leases(
            &mut registry,
            "ssh-existing",
            vec![request("openvpn", "corp-shared")],
            &mut runtime,
        )
        .await
        .unwrap();
        runtime.fail_connect.insert(zerotier.clone());

        let error = acquire_session_vpn_leases(
            &mut registry,
            "rdp-new",
            vec![
                request("openvpn", "corp-shared"),
                request("zerotier", "private-net"),
            ],
            &mut runtime,
        )
        .await
        .unwrap_err();

        assert!(error.contains("simulated connect failure"));
        assert!(runtime.disconnect_calls.is_empty());
        assert!(runtime.active.contains(&openvpn));
        assert_eq!(
            registry.usage(&openvpn),
            Some(VpnLeaseUsage {
                owner_count: 1,
                cleanup_pending: false,
            })
        );
        assert!(registry.entries[&openvpn].owners.contains("ssh-existing"));
        assert!(!registry.entries[&openvpn].owners.contains("rdp-new"));
    }

    #[tokio::test]
    async fn later_failure_after_reviving_shared_lease_restores_prior_snapshot() {
        let mut registry = VpnLeaseRegistry::default();
        let mut runtime = MockRuntime::default();
        let wireguard = key(RuntimeVpnType::WireGuard, "wg-shared-revive");
        let zerotier = key(RuntimeVpnType::ZeroTier, "private-net");

        acquire_session_vpn_leases(
            &mut registry,
            "ssh-existing",
            vec![request("wireguard", "wg-shared-revive")],
            &mut runtime,
        )
        .await
        .unwrap();
        runtime.active.remove(&wireguard);
        runtime.fail_connect.insert(zerotier.clone());

        let error = acquire_session_vpn_leases(
            &mut registry,
            "rdp-new",
            vec![
                request("wireguard", "wg-shared-revive"),
                request("zerotier", "private-net"),
            ],
            &mut runtime,
        )
        .await
        .unwrap_err();

        assert!(error.contains("simulated connect failure"));
        assert_eq!(runtime.disconnect_calls, vec![wireguard.clone()]);
        assert!(!runtime.active.contains(&wireguard));
        assert_eq!(
            registry.usage(&wireguard),
            Some(VpnLeaseUsage {
                owner_count: 1,
                cleanup_pending: false,
            })
        );
        assert!(registry.entries[&wireguard].owners.contains("ssh-existing"));
        assert!(!registry.entries[&wireguard].owners.contains("rdp-new"));
        assert!(registry.rollback_restores.is_empty());
    }

    #[tokio::test]
    async fn same_owner_later_failure_rolls_back_successful_revive_to_exact_snapshot() {
        let mut registry = VpnLeaseRegistry::default();
        let mut runtime = MockRuntime::default();
        let wireguard = key(RuntimeVpnType::WireGuard, "wg-same-owner-revive");
        let zerotier = key(RuntimeVpnType::ZeroTier, "private-net");

        acquire_session_vpn_leases(
            &mut registry,
            "ssh-existing",
            vec![request("wireguard", "wg-same-owner-revive")],
            &mut runtime,
        )
        .await
        .unwrap();
        let prior_entry = registry.entries[&wireguard].clone();
        runtime.active.remove(&wireguard);
        runtime.fail_connect.insert(zerotier);

        let error = acquire_session_vpn_leases(
            &mut registry,
            "ssh-existing",
            vec![
                request("wireguard", "wg-same-owner-revive"),
                request("zerotier", "private-net"),
            ],
            &mut runtime,
        )
        .await
        .unwrap_err();

        assert!(error.contains("simulated connect failure"));
        assert_eq!(runtime.disconnect_calls, vec![wireguard.clone()]);
        assert!(!runtime.active.contains(&wireguard));
        assert_eq!(registry.entries.get(&wireguard), Some(&prior_entry));
        assert!(registry.rollback_restores.is_empty());
    }

    #[tokio::test]
    async fn failed_revived_shared_rollback_retries_without_losing_prior_owner() {
        let mut registry = VpnLeaseRegistry::default();
        let mut runtime = MockRuntime::default();
        let wireguard = key(RuntimeVpnType::WireGuard, "wg-shared-retry");
        let zerotier = key(RuntimeVpnType::ZeroTier, "private-net");

        acquire_session_vpn_leases(
            &mut registry,
            "ssh-existing",
            vec![request("wireguard", "wg-shared-retry")],
            &mut runtime,
        )
        .await
        .unwrap();
        runtime.active.remove(&wireguard);
        runtime.fail_connect.insert(zerotier);
        runtime.fail_disconnect_once.insert(wireguard.clone());

        let error = acquire_session_vpn_leases(
            &mut registry,
            "rdp-new",
            vec![
                request("wireguard", "wg-shared-retry"),
                request("zerotier", "private-net"),
            ],
            &mut runtime,
        )
        .await
        .unwrap_err();

        assert!(error.contains("rollback cleanup failed"));
        assert_eq!(
            registry.usage(&wireguard),
            Some(VpnLeaseUsage {
                owner_count: 2,
                cleanup_pending: true,
            })
        );
        assert!(matches!(
            registry.rollback_restores.get(&wireguard),
            Some(Some(previous))
                if previous.owners.len() == 1 && previous.owners.contains("ssh-existing")
        ));

        let retry = release_session_vpn_leases(&mut registry, "rdp-new", &mut runtime)
            .await
            .unwrap();
        assert!(retry.errors.is_empty());
        assert!(retry.released[0].disconnected);
        assert_eq!(retry.released[0].remaining_leases, 1);
        assert_eq!(
            registry.usage(&wireguard),
            Some(VpnLeaseUsage {
                owner_count: 1,
                cleanup_pending: false,
            })
        );
        assert!(registry.entries[&wireguard].owners.contains("ssh-existing"));
        assert!(!registry.entries[&wireguard].owners.contains("rdp-new"));
        assert!(registry.rollback_restores.is_empty());
    }

    #[tokio::test]
    async fn connect_error_with_confirmed_inactivity_records_no_current_key() {
        let mut registry = VpnLeaseRegistry::default();
        let mut runtime = MockRuntime::default();
        let openvpn = key(RuntimeVpnType::OpenVpn, "corp");
        runtime.fail_connect.insert(openvpn.clone());

        let error = acquire_session_vpn_leases(
            &mut registry,
            "ssh-connect-error",
            vec![request("openvpn", "corp")],
            &mut runtime,
        )
        .await
        .unwrap_err();

        assert!(error.contains("simulated connect failure"));
        assert!(runtime.disconnect_calls.is_empty());
        assert!(registry.entries.is_empty());
        assert!(registry.rollback_restores.is_empty());
    }

    #[tokio::test]
    async fn connect_error_after_activation_is_compensated_before_returning() {
        let mut registry = VpnLeaseRegistry::default();
        let mut runtime = MockRuntime::default();
        let wireguard = key(RuntimeVpnType::WireGuard, "wg-partial-error");
        runtime
            .fail_connect_after_activation
            .insert(wireguard.clone());

        let error = acquire_session_vpn_leases(
            &mut registry,
            "rdp-connect-error",
            vec![request("wireguard", "wg-partial-error")],
            &mut runtime,
        )
        .await
        .unwrap_err();

        assert!(error.contains("simulated connect failure after activation"));
        assert_eq!(runtime.disconnect_calls, vec![wireguard.clone()]);
        assert!(!runtime.active.contains(&wireguard));
        assert!(registry.entries.is_empty());
        assert!(registry.rollback_restores.is_empty());
    }

    #[tokio::test]
    async fn uncertain_connect_error_is_compensated_before_returning() {
        let mut registry = VpnLeaseRegistry::default();
        let mut runtime = MockRuntime::default();
        let tailscale = key(RuntimeVpnType::Tailscale, "tail-partial-error");
        runtime
            .fail_connect_after_activation
            .insert(tailscale.clone());
        runtime
            .probe_error_after_failed_connect
            .insert(tailscale.clone());

        let error = acquire_session_vpn_leases(
            &mut registry,
            "ssh-connect-unknown",
            vec![request("tailscale", "tail-partial-error")],
            &mut runtime,
        )
        .await
        .unwrap_err();

        assert!(error.contains("simulated connect failure after activation"));
        assert_eq!(runtime.disconnect_calls, vec![tailscale.clone()]);
        assert!(!runtime.active.contains(&tailscale));
        assert!(registry.entries.is_empty());
    }

    #[tokio::test]
    async fn failed_connect_compensation_is_retained_and_retried() {
        let mut registry = VpnLeaseRegistry::default();
        let mut runtime = MockRuntime::default();
        let zerotier = key(RuntimeVpnType::ZeroTier, "zt-partial-error");
        runtime
            .fail_connect_after_activation
            .insert(zerotier.clone());
        runtime.fail_disconnect_once.insert(zerotier.clone());

        let error = acquire_session_vpn_leases(
            &mut registry,
            "rdp-connect-error",
            vec![request("zerotier", "zt-partial-error")],
            &mut runtime,
        )
        .await
        .unwrap_err();

        assert!(error.contains("rollback cleanup failed"));
        assert_eq!(
            registry.usage(&zerotier),
            Some(VpnLeaseUsage {
                owner_count: 1,
                cleanup_pending: true,
            })
        );
        assert!(matches!(
            registry.rollback_restores.get(&zerotier),
            Some(None)
        ));

        let reacquire_error = acquire_session_vpn_leases(
            &mut registry,
            "rdp-connect-error",
            vec![request("zerotier", "zt-partial-error")],
            &mut runtime,
        )
        .await
        .unwrap_err();
        assert!(reacquire_error.contains("cleanup pending"));
        assert_eq!(runtime.connect_calls, vec![zerotier.clone()]);
        assert_eq!(runtime.disconnect_calls, vec![zerotier.clone()]);

        let retry = release_session_vpn_leases(&mut registry, "rdp-connect-error", &mut runtime)
            .await
            .unwrap();
        assert!(retry.errors.is_empty());
        assert!(retry.released[0].disconnected);
        assert!(registry.usage(&zerotier).is_none());
        assert_eq!(runtime.disconnect_calls, vec![zerotier.clone(), zerotier]);
    }

    #[tokio::test]
    async fn same_owner_connect_error_restores_the_exact_prior_lease_entry() {
        let mut registry = VpnLeaseRegistry::default();
        let mut runtime = MockRuntime::default();
        let wireguard = key(RuntimeVpnType::WireGuard, "wg-restart-error");

        acquire_session_vpn_leases(
            &mut registry,
            "ssh-existing",
            vec![request("wireguard", "wg-restart-error")],
            &mut runtime,
        )
        .await
        .unwrap();
        let prior_usage = registry.usage(&wireguard);
        runtime.active.remove(&wireguard);
        runtime
            .fail_connect_after_activation
            .insert(wireguard.clone());

        let error = acquire_session_vpn_leases(
            &mut registry,
            "ssh-existing",
            vec![request("wireguard", "wg-restart-error")],
            &mut runtime,
        )
        .await
        .unwrap_err();

        assert!(error.contains("simulated connect failure after activation"));
        assert_eq!(registry.usage(&wireguard), prior_usage);
        assert!(registry.rollback_restores.is_empty());
        assert_eq!(runtime.disconnect_calls, vec![wireguard.clone()]);

        let release = release_session_vpn_leases(&mut registry, "ssh-existing", &mut runtime)
            .await
            .unwrap();
        assert!(release.errors.is_empty());
        assert!(registry.usage(&wireguard).is_none());
    }

    #[tokio::test]
    async fn same_owner_failed_compensation_retry_releases_prior_entry_without_losing_it_early() {
        let mut registry = VpnLeaseRegistry::default();
        let mut runtime = MockRuntime::default();
        let wireguard = key(RuntimeVpnType::WireGuard, "wg-restart-error");

        acquire_session_vpn_leases(
            &mut registry,
            "ssh-existing",
            vec![request("wireguard", "wg-restart-error")],
            &mut runtime,
        )
        .await
        .unwrap();
        runtime.active.remove(&wireguard);
        runtime
            .fail_connect_after_activation
            .insert(wireguard.clone());
        runtime.fail_disconnect_once.insert(wireguard.clone());

        acquire_session_vpn_leases(
            &mut registry,
            "ssh-existing",
            vec![request("wireguard", "wg-restart-error")],
            &mut runtime,
        )
        .await
        .unwrap_err();
        assert_eq!(registry.usage(&wireguard).unwrap().owner_count, 1);
        assert!(matches!(
            registry.rollback_restores.get(&wireguard),
            Some(Some(previous)) if previous.owners.contains("ssh-existing")
        ));

        let release = release_session_vpn_leases(&mut registry, "ssh-existing", &mut runtime)
            .await
            .unwrap();
        assert!(release.errors.is_empty());
        assert!(release.released[0].disconnected);
        assert_eq!(release.released[0].remaining_leases, 0);
        assert!(registry.usage(&wireguard).is_none());
        assert!(registry.rollback_restores.is_empty());
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
    async fn degraded_zerotier_membership_fails_acquire_without_recording_a_session() {
        let mut registry = VpnLeaseRegistry::default();
        let mut runtime = MockRuntime::default();
        let zerotier = key(RuntimeVpnType::ZeroTier, "private-net");
        runtime.probe_errors.insert(zerotier.clone(), 1);

        let error = acquire_session_vpn_leases(
            &mut registry,
            "ssh-degraded",
            vec![request("zerotier", "private-net")],
            &mut runtime,
        )
        .await
        .unwrap_err();

        assert!(error.contains("could not determine whether the VPN is active"));
        assert!(registry.entries.is_empty());
        assert!(runtime.connect_calls.is_empty());
        assert!(runtime.disconnect_calls.is_empty());
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
        assert_eq!(registry.usage(&wg).unwrap().owner_count, 1);

        let retry = release_session_vpn_leases(&mut registry, "ssh-1", &mut runtime)
            .await
            .unwrap();
        assert!(retry.errors.is_empty());
        assert!(retry.released[0].disconnected);
        assert!(!registry.entries.contains_key(&wg));
        assert_eq!(runtime.disconnect_calls, vec![wg.clone(), wg]);
    }

    #[tokio::test]
    async fn readiness_failure_rolls_back_current_key_and_retries_failed_cleanup() {
        let mut registry = VpnLeaseRegistry::default();
        let mut runtime = MockRuntime::default();
        let wg = key(RuntimeVpnType::WireGuard, "wg-partial");
        runtime.connect_without_readiness.insert(wg.clone());
        runtime.fail_disconnect_once.insert(wg.clone());

        let error = acquire_session_vpn_leases(
            &mut registry,
            "ssh-partial",
            vec![request("wireguard", "wg-partial")],
            &mut runtime,
        )
        .await
        .unwrap_err();

        assert!(error.contains("provider returned success but the VPN is not active"));
        assert!(error.contains("rollback cleanup failed"));
        assert!(error.contains("simulated disconnect failure"));
        assert_eq!(runtime.disconnect_calls, vec![wg.clone()]);
        assert_eq!(
            registry.usage(&wg),
            Some(VpnLeaseUsage {
                owner_count: 1,
                cleanup_pending: true,
            })
        );

        let retry = release_session_vpn_leases(&mut registry, "ssh-partial", &mut runtime)
            .await
            .unwrap();
        assert!(retry.errors.is_empty());
        assert!(retry.released[0].disconnected);
        assert_eq!(runtime.disconnect_calls, vec![wg.clone(), wg.clone()]);
        assert!(registry.usage(&wg).is_none());
    }

    #[tokio::test]
    async fn readiness_failure_rolls_back_a_restart_even_when_owner_already_had_the_lease() {
        let mut registry = VpnLeaseRegistry::default();
        let mut runtime = MockRuntime::default();
        let wg = key(RuntimeVpnType::WireGuard, "wg-restart");

        acquire_session_vpn_leases(
            &mut registry,
            "ssh-existing",
            vec![request("wireguard", "wg-restart")],
            &mut runtime,
        )
        .await
        .unwrap();
        runtime.active.remove(&wg);
        runtime.connect_without_readiness.insert(wg.clone());

        let error = acquire_session_vpn_leases(
            &mut registry,
            "ssh-existing",
            vec![request("wireguard", "wg-restart")],
            &mut runtime,
        )
        .await
        .unwrap_err();

        assert!(error.contains("provider returned success but the VPN is not active"));
        assert_eq!(runtime.connect_calls, vec![wg.clone(), wg.clone()]);
        assert_eq!(runtime.disconnect_calls, vec![wg.clone()]);
        assert_eq!(
            registry.usage(&wg),
            Some(VpnLeaseUsage {
                owner_count: 1,
                cleanup_pending: false,
            })
        );

        let release = release_session_vpn_leases(&mut registry, "ssh-existing", &mut runtime)
            .await
            .unwrap();
        assert!(release.errors.is_empty());
        assert!(registry.usage(&wg).is_none());
        // The successful failed-start rollback already removed the partial
        // provider resource, so final owner release only confirms inactivity.
        assert_eq!(runtime.disconnect_calls, vec![wg]);
    }

    #[tokio::test]
    async fn degraded_zerotier_final_release_attempts_leave_and_clears_on_success() {
        let mut registry = VpnLeaseRegistry::default();
        let mut runtime = MockRuntime::default();
        let zerotier = key(RuntimeVpnType::ZeroTier, "private-net");

        acquire_session_vpn_leases(
            &mut registry,
            "rdp-probe",
            vec![request("zerotier", "private-net")],
            &mut runtime,
        )
        .await
        .unwrap();
        runtime.probe_errors.insert(zerotier.clone(), 1);

        let released = release_session_vpn_leases(&mut registry, "rdp-probe", &mut runtime)
            .await
            .unwrap();
        assert!(released.errors.is_empty());
        assert!(released.released[0].disconnected);
        assert!(registry.usage(&zerotier).is_none());
        assert_eq!(runtime.disconnect_calls, vec![zerotier]);
    }

    #[tokio::test]
    async fn degraded_zerotier_leave_failure_retains_owner_for_retry() {
        let mut registry = VpnLeaseRegistry::default();
        let mut runtime = MockRuntime::default();
        let zerotier = key(RuntimeVpnType::ZeroTier, "private-net");

        acquire_session_vpn_leases(
            &mut registry,
            "rdp-probe",
            vec![request("zerotier", "private-net")],
            &mut runtime,
        )
        .await
        .unwrap();
        runtime.probe_errors.insert(zerotier.clone(), 1);
        runtime.fail_disconnect_once.insert(zerotier.clone());

        let failed = release_session_vpn_leases(&mut registry, "rdp-probe", &mut runtime)
            .await
            .unwrap();
        assert_eq!(failed.errors.len(), 1);
        assert!(failed.errors[0].contains("activity probe failed"));
        assert!(failed.errors[0].contains("teardown failed"));
        assert!(failed.errors[0].contains("retained for retry"));
        assert_eq!(
            registry.usage(&zerotier),
            Some(VpnLeaseUsage {
                owner_count: 1,
                cleanup_pending: true,
            })
        );
        assert_eq!(runtime.disconnect_calls, vec![zerotier.clone()]);

        let retry = release_session_vpn_leases(&mut registry, "rdp-probe", &mut runtime)
            .await
            .unwrap();
        assert!(retry.errors.is_empty());
        assert!(retry.released[0].disconnected);
        assert!(registry.usage(&zerotier).is_none());
        assert_eq!(runtime.disconnect_calls, vec![zerotier.clone(), zerotier]);
    }

    #[tokio::test]
    async fn direct_teardown_guard_reports_only_safe_aggregate_lease_counts() {
        let mut registry = VpnLeaseRegistry::default();
        let mut runtime = MockRuntime::default();
        let tailscale = key(RuntimeVpnType::Tailscale, "tailnet");
        let requests = vec![request("tailscale", "tailnet")];

        acquire_session_vpn_leases(
            &mut registry,
            "secret-session-owner-one",
            requests.clone(),
            &mut runtime,
        )
        .await
        .unwrap();
        acquire_session_vpn_leases(
            &mut registry,
            "secret-session-owner-two",
            requests,
            &mut runtime,
        )
        .await
        .unwrap();

        let error = registry
            .ensure_direct_teardown_allowed(&tailscale, "disconnect")
            .unwrap_err();
        assert!(error.contains("2 active sessions"));
        assert!(!error.contains("secret-session-owner-one"));
        assert!(!error.contains("secret-session-owner-two"));
    }

    #[tokio::test]
    async fn held_direct_teardown_guard_serializes_a_competing_acquire() {
        let state = new_vpn_lease_service_state();
        let key = key(RuntimeVpnType::ZeroTier, "private-net");
        let (guard_entered_tx, guard_entered_rx) = tokio::sync::oneshot::channel();
        let (contender_locked_tx, mut contender_locked_rx) = tokio::sync::oneshot::channel();

        let manual_teardown = {
            let state = Arc::clone(&state);
            let key = key.clone();
            async move {
                let registry = state.lock().await;
                registry
                    .ensure_direct_teardown_allowed(&key, "disconnect")
                    .unwrap();
                guard_entered_tx.send(()).unwrap();

                // This yield represents the awaited provider call in each
                // direct command. The competing acquire cannot take the
                // lifecycle mutex until that call and guard scope finish.
                tokio::task::yield_now().await;
                assert!(matches!(
                    contender_locked_rx.try_recv(),
                    Err(tokio::sync::oneshot::error::TryRecvError::Empty)
                ));
                drop(registry);
                contender_locked_rx.await.unwrap();
            }
        };
        let competing_acquire = {
            let state = Arc::clone(&state);
            async move {
                guard_entered_rx.await.unwrap();
                let _registry = state.lock().await;
                contender_locked_tx.send(()).unwrap();
            }
        };

        tokio::join!(manual_teardown, competing_acquire);
    }
}
