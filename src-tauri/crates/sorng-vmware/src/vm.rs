//! VM lifecycle management via the vSphere REST API.
//!
//! Covers listing, CRUD, power operations, guest operations,
//! cloning, migration, CPU/memory hot-reconfiguration, and more.

use crate::error::VmwareResult;
use crate::types::*;
use crate::vsphere::VsphereClient;

use std::collections::HashMap;

/// High-level VM operations backed by `VsphereClient`.
pub struct VmManager<'a> {
    client: &'a VsphereClient,
}

impl<'a> VmManager<'a> {
    pub fn new(client: &'a VsphereClient) -> Self {
        Self { client }
    }

    // ── List / Get ──────────────────────────────────────────────────

    /// List VMs, optionally filtered.
    pub async fn list_vms(
        &self,
        filter_names: Option<&[&str]>,
        filter_hosts: Option<&[&str]>,
        filter_clusters: Option<&[&str]>,
        filter_datacenters: Option<&[&str]>,
        filter_folders: Option<&[&str]>,
        filter_resource_pools: Option<&[&str]>,
        filter_power_states: Option<&[VmPowerState]>,
    ) -> VmwareResult<Vec<VmSummary>> {
        let mut params: Vec<(String, String)> = Vec::new();

        if let Some(names) = filter_names {
            for n in names {
                params.push(("names".into(), n.to_string()));
            }
        }
        if let Some(hosts) = filter_hosts {
            for h in hosts {
                params.push(("hosts".into(), h.to_string()));
            }
        }
        if let Some(clusters) = filter_clusters {
            for c in clusters {
                params.push(("clusters".into(), c.to_string()));
            }
        }
        if let Some(dcs) = filter_datacenters {
            for d in dcs {
                params.push(("datacenters".into(), d.to_string()));
            }
        }
        if let Some(folders) = filter_folders {
            for f in folders {
                params.push(("folders".into(), f.to_string()));
            }
        }
        if let Some(rps) = filter_resource_pools {
            for r in rps {
                params.push(("resource_pools".into(), r.to_string()));
            }
        }
        if let Some(states) = filter_power_states {
            for s in states {
                let val = serde_json::to_value(s)
                    .unwrap_or_default()
                    .as_str()
                    .unwrap_or("POWERED_OFF")
                    .to_string();
                params.push(("power_states".into(), val));
            }
        }

        if params.is_empty() {
            self.client.get::<Vec<VmSummary>>("/api/vcenter/vm").await
        } else {
            self.client
                .get_with_params::<Vec<VmSummary>>("/api/vcenter/vm", &params)
                .await
        }
    }

    /// List all VMs (no filter).
    pub async fn list_all_vms(&self) -> VmwareResult<Vec<VmSummary>> {
        self.list_vms(None, None, None, None, None, None, None)
            .await
    }

    /// Get full details for a single VM.
    pub async fn get_vm(&self, vm_id: &str) -> VmwareResult<VmInfo> {
        let path = format!("/api/vcenter/vm/{vm_id}");
        self.client.get::<VmInfo>(&path).await
    }

    // ── Create / Delete ─────────────────────────────────────────────

    /// Create a new VM. Returns the VM identifier.
    pub async fn create_vm(&self, spec: &VmCreateSpec) -> VmwareResult<String> {
        #[derive(serde::Deserialize)]
        struct Created {
            value: String,
        }
        let resp: Created = self.client.post("/api/vcenter/vm", spec).await?;
        Ok(resp.value)
    }

    /// Delete (unregister and remove) a VM.
    pub async fn delete_vm(&self, vm_id: &str) -> VmwareResult<()> {
        let path = format!("/api/vcenter/vm/{vm_id}");
        self.client.delete(&path).await
    }

    // ── Power operations ────────────────────────────────────────────

    /// Power on a VM.
    pub async fn power_on(&self, vm_id: &str) -> VmwareResult<()> {
        let path = format!("/api/vcenter/vm/{vm_id}/power?action=start");
        self.client.post_empty(&path).await
    }

    /// Power off a VM (hard).
    pub async fn power_off(&self, vm_id: &str) -> VmwareResult<()> {
        let path = format!("/api/vcenter/vm/{vm_id}/power?action=stop");
        self.client.post_empty(&path).await
    }

    /// Suspend a VM.
    pub async fn suspend(&self, vm_id: &str) -> VmwareResult<()> {
        let path = format!("/api/vcenter/vm/{vm_id}/power?action=suspend");
        self.client.post_empty(&path).await
    }

    /// Hard reset a VM.
    pub async fn reset(&self, vm_id: &str) -> VmwareResult<()> {
        let path = format!("/api/vcenter/vm/{vm_id}/power?action=reset");
        self.client.post_empty(&path).await
    }

    /// Get current power state.
    pub async fn get_power_state(&self, vm_id: &str) -> VmwareResult<VmPowerState> {
        #[derive(serde::Deserialize)]
        struct PowerInfo {
            state: VmPowerState,
        }
        let path = format!("/api/vcenter/vm/{vm_id}/power");
        let info: PowerInfo = self.client.get(&path).await?;
        Ok(info.state)
    }

    // ── Guest operations ────────────────────────────────────────────

    /// Graceful guest shutdown (requires VMware Tools).
    pub async fn shutdown_guest(&self, vm_id: &str) -> VmwareResult<()> {
        let path = format!("/api/vcenter/vm/{vm_id}/guest/power?action=shutdown");
        self.client.post_empty(&path).await
    }

    /// Graceful guest reboot (requires VMware Tools).
    pub async fn reboot_guest(&self, vm_id: &str) -> VmwareResult<()> {
        let path = format!("/api/vcenter/vm/{vm_id}/guest/power?action=reboot");
        self.client.post_empty(&path).await
    }

    /// Standby (guest-level sleep).
    pub async fn standby_guest(&self, vm_id: &str) -> VmwareResult<()> {
        let path = format!("/api/vcenter/vm/{vm_id}/guest/power?action=standby");
        self.client.post_empty(&path).await
    }

    /// Get guest identity information (hostname, IP, OS).
    pub async fn get_guest_identity(&self, vm_id: &str) -> VmwareResult<GuestIdentity> {
        let path = format!("/api/vcenter/vm/{vm_id}/guest/identity");
        self.client.get::<GuestIdentity>(&path).await
    }

    // ── Hardware reconfiguration ────────────────────────────────────

    /// Update VM CPU configuration.
    pub async fn update_cpu(&self, vm_id: &str, spec: &VmCpuUpdate) -> VmwareResult<()> {
        let path = format!("/api/vcenter/vm/{vm_id}/hardware/cpu");
        self.client.patch(&path, spec).await
    }

    /// Update VM memory configuration.
    pub async fn update_memory(&self, vm_id: &str, spec: &VmMemoryUpdate) -> VmwareResult<()> {
        let path = format!("/api/vcenter/vm/{vm_id}/hardware/memory");
        self.client.patch(&path, spec).await
    }

    /// Get VM hardware overview.
    pub async fn get_hardware(&self, vm_id: &str) -> VmwareResult<VmHardware> {
        let path = format!("/api/vcenter/vm/{vm_id}/hardware");
        self.client.get::<VmHardware>(&path).await
    }

    // ── Clone / Relocate ────────────────────────────────────────────

    /// Clone a VM. Returns the new VM identifier.
    ///
    /// Notes: The vSphere REST API does not have a dedicated clone endpoint
    /// in all versions. This uses the `vcenter/vm?action=clone` endpoint
    /// available in vSphere 7.0 U2+.
    pub async fn clone_vm(&self, spec: &VmCloneSpec) -> VmwareResult<String> {
        #[derive(serde::Deserialize)]
        struct Cloned {
            #[serde(default)]
            value: String,
        }
        let resp: Cloned = self
            .client
            .post("/api/vcenter/vm?action=clone", spec)
            .await?;
        Ok(resp.value)
    }

    /// Relocate (migrate) a VM to a different host/datastore.
    pub async fn relocate_vm(
        &self,
        vm_id: &str,
        spec: &VmRelocateSpec,
    ) -> VmwareResult<()> {
        let path = format!("/api/vcenter/vm/{vm_id}?action=relocate");
        self.client.post_raw(&path, spec).await?;
        Ok(())
    }

    // ── Register / Unregister ───────────────────────────────────────

    /// Register (add to inventory) a VM from a datastore path.
    pub async fn register_vm(
        &self,
        name: &str,
        datastore_path: &str,
        resource_pool: Option<&str>,
        folder: Option<&str>,
    ) -> VmwareResult<String> {
        #[derive(serde::Serialize)]
        struct RegisterSpec {
            name: String,
            path: String,
            #[serde(skip_serializing_if = "Option::is_none")]
            resource_pool: Option<String>,
            #[serde(skip_serializing_if = "Option::is_none")]
            folder: Option<String>,
        }
        #[derive(serde::Deserialize)]
        struct Registered {
            value: String,
        }
        let spec = RegisterSpec {
            name: name.to_string(),
            path: datastore_path.to_string(),
            resource_pool: resource_pool.map(|s| s.to_string()),
            folder: folder.map(|s| s.to_string()),
        };
        let resp: Registered = self
            .client
            .post("/api/vcenter/vm?action=register", &spec)
            .await?;
        Ok(resp.value)
    }

    /// Unregister (remove from inventory without deleting) a VM.
    pub async fn unregister_vm(&self, vm_id: &str) -> VmwareResult<()> {
        let path = format!("/api/vcenter/vm/{vm_id}?action=unregister");
        self.client.post_empty(&path).await
    }

    // ── Convenience helpers ─────────────────────────────────────────

    /// Find a VM by name (case-insensitive). Returns the first match.
    pub async fn find_vm_by_name(&self, name: &str) -> VmwareResult<Option<VmSummary>> {
        let vms = self
            .list_vms(Some(&[name]), None, None, None, None, None, None)
            .await?;
        Ok(vms.into_iter().next())
    }

    /// List powered-on VMs only.
    pub async fn list_running_vms(&self) -> VmwareResult<Vec<VmSummary>> {
        self.list_vms(
            None,
            None,
            None,
            None,
            None,
            None,
            Some(&[VmPowerState::PoweredOn]),
        )
        .await
    }

    /// Get a map of VM id → name for all VMs.
    pub async fn get_vm_name_map(&self) -> VmwareResult<HashMap<String, String>> {
        let vms = self.list_all_vms().await?;
        Ok(vms.into_iter().map(|v| (v.vm, v.name)).collect())
    }
}
