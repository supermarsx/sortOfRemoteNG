//! Datastore / storage operations via the vSphere REST API.

use crate::error::VmwareResult;
use crate::types::*;
use crate::vsphere::VsphereClient;

/// Datastore and VM disk operations.
pub struct StorageManager<'a> {
    client: &'a VsphereClient,
}

impl<'a> StorageManager<'a> {
    pub fn new(client: &'a VsphereClient) -> Self {
        Self { client }
    }

    // ── Datastores ──────────────────────────────────────────────────

    /// List all datastores.
    pub async fn list_datastores(&self) -> VmwareResult<Vec<DatastoreSummary>> {
        self.client
            .get::<Vec<DatastoreSummary>>("/api/vcenter/datastore")
            .await
    }

    /// List datastores in a specific datacenter.
    pub async fn list_datastores_in_datacenter(
        &self,
        datacenter: &str,
    ) -> VmwareResult<Vec<DatastoreSummary>> {
        self.client
            .get_with_params::<Vec<DatastoreSummary>>(
                "/api/vcenter/datastore",
                &[("datacenters".into(), datacenter.to_string())],
            )
            .await
    }

    /// List datastores of a specific type.
    pub async fn list_datastores_by_type(
        &self,
        ds_type: &str,
    ) -> VmwareResult<Vec<DatastoreSummary>> {
        self.client
            .get_with_params::<Vec<DatastoreSummary>>(
                "/api/vcenter/datastore",
                &[("types".into(), ds_type.to_string())],
            )
            .await
    }

    /// Get details of a specific datastore.
    pub async fn get_datastore(&self, datastore_id: &str) -> VmwareResult<DatastoreInfo> {
        let path = format!("/api/vcenter/datastore/{datastore_id}");
        self.client.get::<DatastoreInfo>(&path).await
    }

    /// Find a datastore by name.
    pub async fn find_datastore_by_name(
        &self,
        name: &str,
    ) -> VmwareResult<Option<DatastoreSummary>> {
        let dss = self
            .client
            .get_with_params::<Vec<DatastoreSummary>>(
                "/api/vcenter/datastore",
                &[("names".into(), name.to_string())],
            )
            .await?;
        Ok(dss.into_iter().next())
    }

    // ── VM Disks ────────────────────────────────────────────────────

    /// List disks on a VM.
    pub async fn list_vm_disks(&self, vm_id: &str) -> VmwareResult<Vec<VmDiskInfo>> {
        let path = format!("/api/vcenter/vm/{vm_id}/hardware/disk");
        self.client.get::<Vec<VmDiskInfo>>(&path).await
    }

    /// Get details of a specific disk.
    pub async fn get_vm_disk(&self, vm_id: &str, disk_id: &str) -> VmwareResult<VmDiskInfo> {
        let path = format!("/api/vcenter/vm/{vm_id}/hardware/disk/{disk_id}");
        self.client.get::<VmDiskInfo>(&path).await
    }

    /// Add a disk to a VM.
    pub async fn add_vm_disk(&self, vm_id: &str, spec: &VmDiskCreateSpec) -> VmwareResult<String> {
        #[derive(serde::Deserialize)]
        struct Created {
            value: String,
        }
        let path = format!("/api/vcenter/vm/{vm_id}/hardware/disk");
        let resp: Created = self.client.post(&path, spec).await?;
        Ok(resp.value)
    }

    /// Remove a disk from a VM.
    pub async fn remove_vm_disk(&self, vm_id: &str, disk_id: &str) -> VmwareResult<()> {
        let path = format!("/api/vcenter/vm/{vm_id}/hardware/disk/{disk_id}");
        self.client.delete(&path).await
    }

    /// Update a VM disk (e.g. resize).
    pub async fn update_vm_disk(
        &self,
        vm_id: &str,
        disk_id: &str,
        spec: &VmDiskUpdateSpec,
    ) -> VmwareResult<()> {
        let path = format!("/api/vcenter/vm/{vm_id}/hardware/disk/{disk_id}");
        self.client.patch(&path, spec).await
    }

    // ── CD-ROM ──────────────────────────────────────────────────────

    /// List CD-ROM devices on a VM.
    pub async fn list_vm_cdroms(&self, vm_id: &str) -> VmwareResult<Vec<VmCdromInfo>> {
        let path = format!("/api/vcenter/vm/{vm_id}/hardware/cdrom");
        self.client.get::<Vec<VmCdromInfo>>(&path).await
    }

    /// Add a CD-ROM to a VM.
    pub async fn add_vm_cdrom(
        &self,
        vm_id: &str,
        spec: &VmCdromCreateSpec,
    ) -> VmwareResult<String> {
        #[derive(serde::Deserialize)]
        struct Created {
            value: String,
        }
        let path = format!("/api/vcenter/vm/{vm_id}/hardware/cdrom");
        let resp: Created = self.client.post(&path, spec).await?;
        Ok(resp.value)
    }

    /// Remove a CD-ROM from a VM.
    pub async fn remove_vm_cdrom(&self, vm_id: &str, cdrom_id: &str) -> VmwareResult<()> {
        let path = format!("/api/vcenter/vm/{vm_id}/hardware/cdrom/{cdrom_id}");
        self.client.delete(&path).await
    }

    // ── Convenience ─────────────────────────────────────────────────

    /// Calculate total storage used by a VM across all disks (in bytes).
    pub async fn get_vm_total_disk_bytes(&self, vm_id: &str) -> VmwareResult<u64> {
        let disks = self.list_vm_disks(vm_id).await?;
        Ok(disks.iter().map(|d| d.capacity.unwrap_or(0)).sum())
    }
}

// ── Extra types for disk / cdrom CRUD ───────────────────────────────

/// Disk info from vSphere API.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VmDiskInfo {
    #[serde(default)]
    pub disk: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub r#type: String,
    #[serde(default)]
    pub capacity: Option<u64>,
    #[serde(default)]
    pub backing: Option<VmDiskBacking>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VmDiskBacking {
    #[serde(default)]
    pub r#type: String,
    #[serde(default)]
    pub vmdk_file: String,
}

/// Spec to create a new disk.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VmDiskCreateSpec {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_vmdk: Option<NewVmdkSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backing: Option<DiskBackingCreateSpec>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct NewVmdkSpec {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capacity: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storage_policy: Option<StoragePolicySpec>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DiskBackingCreateSpec {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vmdk_file: Option<String>,
}

/// Spec to update a disk (resize).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VmDiskUpdateSpec {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capacity: Option<u64>,
}

/// CD-ROM info.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VmCdromInfo {
    #[serde(default)]
    pub cdrom: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub r#type: String,
    #[serde(default)]
    pub backing: Option<VmCdromBacking>,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub start_connected: bool,
    #[serde(default)]
    pub allow_guest_control: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VmCdromBacking {
    #[serde(default)]
    pub r#type: String,
    #[serde(default)]
    pub iso_file: String,
}

/// Spec to create a CD-ROM device.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VmCdromCreateSpec {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backing: Option<CdromBackingCreateSpec>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_connected: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allow_guest_control: Option<bool>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CdromBackingCreateSpec {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub iso_file: Option<String>,
}
