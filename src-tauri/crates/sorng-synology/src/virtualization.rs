//! Virtual Machine Manager — guests, snapshots, virtual switches.

use crate::client::SynoClient;
use crate::error::SynologyResult;
use crate::types::*;
use serde::Deserialize;

/// One `SYNO.Virtualization.API.Guest list` row, with DSM's field names
/// (Synology Virtual Machine Manager API guide, Guest list).
#[derive(Deserialize)]
struct GuestWire {
    guest_id: String,
    guest_name: String,
    status: String,
    description: Option<String>,
    vcpu_num: u32,
    /// Memory in MB, as the guide documents it.
    vram_size: u64,
    /// 0 = off, 1 = restore the last state, 2 = on.
    autorun: Option<i64>,
    storage_name: Option<String>,
}

impl From<GuestWire> for VmGuest {
    fn from(guest: GuestWire) -> Self {
        Self {
            guest_id: guest.guest_id,
            guest_name: guest.guest_name,
            status: guest.status,
            description: guest.description,
            vcpu_num: guest.vcpu_num,
            vram_size: guest.vram_size,
            autorun: guest.autorun.map(|mode| mode != 0),
            storage_name: guest.storage_name,
            // The list reports virtual disks, not the size of the storage.
            storage_size: None,
            vnc_port: None,
        }
    }
}

pub struct VirtualizationManager;

impl VirtualizationManager {
    /// List all virtual machines. `vramSize` is in MB.
    pub async fn list_guests(client: &SynoClient) -> SynologyResult<Vec<VmGuest>> {
        let v = client
            .best_version("SYNO.Virtualization.API.Guest", 1)
            .unwrap_or(1);
        let guests: Vec<GuestWire> = client
            .api_list(
                "SYNO.Virtualization.API.Guest",
                v,
                "list",
                &[("additional", "[\"status\",\"autorun\"]")],
                &["guests"],
            )
            .await?;
        Ok(guests.into_iter().map(VmGuest::from).collect())
    }

    /// Get details of a VM.
    pub async fn get_guest(client: &SynoClient, guest_id: &str) -> SynologyResult<VmGuest> {
        let v = client
            .best_version("SYNO.Virtualization.API.Guest", 1)
            .unwrap_or(1);
        client
            .api_call(
                "SYNO.Virtualization.API.Guest",
                v,
                "get",
                &[("guest_id", guest_id)],
            )
            .await
    }

    /// Power on a VM.
    pub async fn power_on(client: &SynoClient, guest_id: &str) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Virtualization.API.Guest.Action", 1)
            .unwrap_or(1);
        client
            .api_post_void(
                "SYNO.Virtualization.API.Guest.Action",
                v,
                "poweron",
                &[("guest_id", guest_id)],
            )
            .await
    }

    /// Power off a VM (graceful shutdown).
    pub async fn shutdown(client: &SynoClient, guest_id: &str) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Virtualization.API.Guest.Action", 1)
            .unwrap_or(1);
        client
            .api_post_void(
                "SYNO.Virtualization.API.Guest.Action",
                v,
                "shutdown",
                &[("guest_id", guest_id)],
            )
            .await
    }

    /// Force power off a VM.
    pub async fn force_shutdown(client: &SynoClient, guest_id: &str) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Virtualization.API.Guest.Action", 1)
            .unwrap_or(1);
        client
            .api_post_void(
                "SYNO.Virtualization.API.Guest.Action",
                v,
                "poweroff",
                &[("guest_id", guest_id)],
            )
            .await
    }

    /// Reset a VM.
    pub async fn reset(client: &SynoClient, guest_id: &str) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Virtualization.API.Guest.Action", 1)
            .unwrap_or(1);
        client
            .api_post_void(
                "SYNO.Virtualization.API.Guest.Action",
                v,
                "reset",
                &[("guest_id", guest_id)],
            )
            .await
    }

    // ─── Snapshots ───────────────────────────────────────────────

    /// List snapshots for a VM.
    pub async fn list_snapshots(
        client: &SynoClient,
        guest_id: &str,
    ) -> SynologyResult<Vec<VmSnapshot>> {
        let v = client
            .best_version("SYNO.Virtualization.API.Guest.Action", 1)
            .unwrap_or(1);
        client
            .api_call(
                "SYNO.Virtualization.API.Guest.Action",
                v,
                "snapshot_list",
                &[("guest_id", guest_id)],
            )
            .await
    }

    /// Take a snapshot.
    pub async fn take_snapshot(
        client: &SynoClient,
        guest_id: &str,
        description: &str,
    ) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Virtualization.API.Guest.Action", 1)
            .unwrap_or(1);
        client
            .api_post_void(
                "SYNO.Virtualization.API.Guest.Action",
                v,
                "snapshot_create",
                &[("guest_id", guest_id), ("desc", description)],
            )
            .await
    }

    /// Revert to a snapshot.
    pub async fn revert_snapshot(
        client: &SynoClient,
        guest_id: &str,
        snapshot_id: &str,
    ) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Virtualization.API.Guest.Action", 1)
            .unwrap_or(1);
        client
            .api_post_void(
                "SYNO.Virtualization.API.Guest.Action",
                v,
                "snapshot_revert",
                &[("guest_id", guest_id), ("snap_id", snapshot_id)],
            )
            .await
    }

    /// Delete a snapshot.
    pub async fn delete_snapshot(
        client: &SynoClient,
        guest_id: &str,
        snapshot_id: &str,
    ) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Virtualization.API.Guest.Action", 1)
            .unwrap_or(1);
        client
            .api_post_void(
                "SYNO.Virtualization.API.Guest.Action",
                v,
                "snapshot_delete",
                &[("guest_id", guest_id), ("snap_id", snapshot_id)],
            )
            .await
    }

    // ─── Virtual Switches ────────────────────────────────────────

    /// List virtual networks / switches.
    pub async fn list_networks(client: &SynoClient) -> SynologyResult<Vec<VmNetwork>> {
        let v = client
            .best_version("SYNO.Virtualization.API.Network", 1)
            .unwrap_or(1);
        client
            .api_call("SYNO.Virtualization.API.Network", v, "list", &[])
            .await
    }
}
