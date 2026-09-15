//! Services management — SMB, NFS, FTP, SSH, rsync, WebDAV.
//!
//! DSM names these settings differently from the IPC DTOs: `SYNO.Core.Service`
//! answers `{"service":[{service_id, display_name, enable_status, …}]}`, and the
//! SMB, NFS and Terminal `get` replies use `enable_samba`, `enable_nfs` and
//! `enable_ssh` (dsm_helper `Core/Service.dart`, `Core/FileServ/Smb.dart`,
//! `Core/Terminal.dart`; synology-csi `NfsInfo`). Private wire structs keep
//! DSM's names and map into the DTOs.

use crate::client::SynoClient;
use crate::error::SynologyResult;
use crate::types::*;
use crate::wire::string_param;
use serde::{de::Error as _, Deserialize, Deserializer};

const SERVICE: &str = "SYNO.Core.Service";

pub struct ServicesManager;

/// One `SYNO.Core.Service` row. DSM 7.4 at v1 sends `display_name` and no
/// `additional`; v3 with `additional=["active_status"]` sends a
/// `display_name_section_key` (a UI string key) and the run state.
#[derive(Deserialize)]
struct ServiceWire {
    service_id: String,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    display_name_section_key: Option<String>,
    /// `enabled`, `disabled` or `static` (always on, not switchable).
    enable_status: String,
    #[serde(default)]
    additional: Option<ServiceAdditionalWire>,
}

#[derive(Deserialize)]
struct ServiceAdditionalWire {
    #[serde(default)]
    active_status: Option<String>,
}

impl From<ServiceWire> for ServiceStatus {
    fn from(wire: ServiceWire) -> Self {
        let name = wire
            .display_name
            .or(wire.display_name_section_key)
            .unwrap_or_else(|| wire.service_id.clone());
        ServiceStatus {
            enabled: wire.enable_status == "enabled",
            running: wire
                .additional
                .and_then(|extra| extra.active_status)
                .map(|status| status == "active"),
            id: wire.service_id,
            name,
            port: None,
            service_type: None,
        }
    }
}

/// `SYNO.Core.FileServ.SMB` `get`. The protocol levels are DSM's raw numbers;
/// their labels are not public, so they are passed on as text, not guessed.
#[derive(Deserialize)]
struct SmbWire {
    #[serde(deserialize_with = "crate::wire::bool_lenient")]
    enable_samba: bool,
    #[serde(default)]
    workgroup: Option<String>,
    #[serde(default, deserialize_with = "crate::wire::opt_string_or_number")]
    smb_min_protocol: Option<String>,
    #[serde(default, deserialize_with = "crate::wire::opt_string_or_number")]
    smb_max_protocol: Option<String>,
}

impl From<SmbWire> for SmbConfig {
    fn from(wire: SmbWire) -> Self {
        SmbConfig {
            enabled: wire.enable_samba,
            workgroup: wire.workgroup,
            description: None,
            min_protocol: wire.smb_min_protocol,
            max_protocol: wire.smb_max_protocol,
            enable_smb2: None,
            enable_smb3: None,
        }
    }
}

/// `SYNO.Core.FileServ.NFS` `get` (synology-csi `NfsInfo`).
#[derive(Deserialize)]
struct NfsWire {
    #[serde(deserialize_with = "crate::wire::bool_lenient")]
    enable_nfs: bool,
    #[serde(default)]
    enable_nfs_v4: Option<bool>,
    #[serde(default)]
    nfs_v4_domain: Option<String>,
}

impl From<NfsWire> for NfsConfig {
    fn from(wire: NfsWire) -> Self {
        NfsConfig {
            enabled: wire.enable_nfs,
            enable_nfs_v4: wire.enable_nfs_v4,
            domain: wire.nfs_v4_domain.filter(|domain| !domain.is_empty()),
        }
    }
}

/// `SYNO.Core.Terminal` `get`. A port outside 0-65535 fails the decode, so it
/// is reported as a `json_schema` failure instead of being truncated.
#[derive(Deserialize)]
struct SshWire {
    #[serde(deserialize_with = "crate::wire::bool_lenient")]
    enable_ssh: bool,
    #[serde(deserialize_with = "tcp_port")]
    ssh_port: u16,
}

fn tcp_port<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u16, D::Error> {
    let number = crate::wire::u64_lenient(deserializer)?;
    u16::try_from(number).map_err(|_| D::Error::custom("expected a TCP port"))
}

impl From<SshWire> for SshConfig {
    fn from(wire: SshWire) -> Self {
        SshConfig {
            enabled: wire.enable_ssh,
            port: wire.ssh_port,
        }
    }
}

impl ServicesManager {
    /// List all services and their status.
    ///
    /// DSM 7 catalogs list `SYNO.Core.Service` up to v3. The run state comes
    /// only with `additional=["active_status"]` (dsm_helper); without it
    /// `running` stays unknown.
    pub async fn list(client: &SynoClient) -> SynologyResult<Vec<ServiceStatus>> {
        let v = client.best_version(SERVICE, 3).unwrap_or(1);
        let rows: Vec<ServiceWire> = client
            .api_list(
                SERVICE,
                v,
                "get",
                &[("additional", "[\"active_status\"]")],
                &["service"],
            )
            .await?;
        Ok(rows.into_iter().map(ServiceStatus::from).collect())
    }

    /// Enable or disable a service.
    pub async fn set_enabled(
        client: &SynoClient,
        service_id: &str,
        enabled: bool,
    ) -> SynologyResult<()> {
        let v = client.best_version(SERVICE, 1).unwrap_or(1);
        let en = if enabled { "true" } else { "false" };
        let id = string_param(client, SERVICE, service_id);
        client
            .api_post_void(SERVICE, v, "set", &[("id", &id), ("enable", en)])
            .await
    }

    // ─── SMB / CIFS ──────────────────────────────────────────────

    /// Get SMB service configuration.
    pub async fn get_smb_config(client: &SynoClient) -> SynologyResult<SmbConfig> {
        let v = client
            .best_version("SYNO.Core.FileServ.SMB", 3)
            .unwrap_or(1);
        let wire: SmbWire = client
            .api_call("SYNO.Core.FileServ.SMB", v, "get", &[])
            .await?;
        Ok(wire.into())
    }

    /// Enable / disable SMB.
    pub async fn set_smb_enabled(client: &SynoClient, enabled: bool) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Core.FileServ.SMB", 3)
            .unwrap_or(1);
        let en = if enabled { "true" } else { "false" };
        client
            .api_post_void("SYNO.Core.FileServ.SMB", v, "set", &[("enable_smb", en)])
            .await
    }

    // ─── NFS ─────────────────────────────────────────────────────

    /// Get NFS service configuration.
    pub async fn get_nfs_config(client: &SynoClient) -> SynologyResult<NfsConfig> {
        let v = client
            .best_version("SYNO.Core.FileServ.NFS", 2)
            .unwrap_or(1);
        let wire: NfsWire = client
            .api_call("SYNO.Core.FileServ.NFS", v, "get", &[])
            .await?;
        Ok(wire.into())
    }

    /// Enable / disable NFS.
    pub async fn set_nfs_enabled(client: &SynoClient, enabled: bool) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Core.FileServ.NFS", 2)
            .unwrap_or(1);
        let en = if enabled { "true" } else { "false" };
        client
            .api_post_void("SYNO.Core.FileServ.NFS", v, "set", &[("enable_nfs", en)])
            .await
    }

    // ─── FTP ─────────────────────────────────────────────────────

    /// Get FTP configuration.
    pub async fn get_ftp_config(client: &SynoClient) -> SynologyResult<serde_json::Value> {
        let v = client
            .best_version("SYNO.Core.FileServ.FTP", 3)
            .unwrap_or(1);
        client
            .api_call("SYNO.Core.FileServ.FTP", v, "get", &[])
            .await
    }

    /// Enable / disable FTP.
    pub async fn set_ftp_enabled(client: &SynoClient, enabled: bool) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Core.FileServ.FTP", 3)
            .unwrap_or(1);
        let en = if enabled { "true" } else { "false" };
        client
            .api_post_void("SYNO.Core.FileServ.FTP", v, "set", &[("enable_ftp", en)])
            .await
    }

    // ─── SSH ─────────────────────────────────────────────────────

    /// Get SSH configuration.
    pub async fn get_ssh_config(client: &SynoClient) -> SynologyResult<SshConfig> {
        let v = client.best_version("SYNO.Core.Terminal", 3).unwrap_or(1);
        let wire: SshWire = client.api_call("SYNO.Core.Terminal", v, "get", &[]).await?;
        Ok(wire.into())
    }

    /// Enable / disable SSH.
    pub async fn set_ssh_enabled(client: &SynoClient, enabled: bool) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.Terminal", 3).unwrap_or(1);
        let en = if enabled { "true" } else { "false" };
        client
            .api_post_void("SYNO.Core.Terminal", v, "set", &[("enable_ssh", en)])
            .await
    }

    /// Set SSH port.
    pub async fn set_ssh_port(client: &SynoClient, port: u16) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.Terminal", 3).unwrap_or(1);
        let p = port.to_string();
        client
            .api_post_void("SYNO.Core.Terminal", v, "set", &[("ssh_port", &p)])
            .await
    }

    // ─── WebDAV ──────────────────────────────────────────────────

    /// Get WebDAV config.
    pub async fn get_webdav_config(client: &SynoClient) -> SynologyResult<serde_json::Value> {
        let v = client
            .best_version("SYNO.Core.FileServ.WebDAV", 2)
            .unwrap_or(1);
        client
            .api_call("SYNO.Core.FileServ.WebDAV", v, "get", &[])
            .await
    }

    /// Enable / disable WebDAV.
    pub async fn set_webdav_enabled(client: &SynoClient, enabled: bool) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Core.FileServ.WebDAV", 2)
            .unwrap_or(1);
        let en = if enabled { "true" } else { "false" };
        client
            .api_post_void(
                "SYNO.Core.FileServ.WebDAV",
                v,
                "set",
                &[("enable_webdav", en)],
            )
            .await
    }

    // ─── Rsync ───────────────────────────────────────────────────

    /// Get rsync service status.
    pub async fn get_rsync_config(client: &SynoClient) -> SynologyResult<serde_json::Value> {
        let v = client
            .best_version("SYNO.Core.FileServ.Rsync", 2)
            .unwrap_or(1);
        client
            .api_call("SYNO.Core.FileServ.Rsync", v, "get", &[])
            .await
    }

    /// Enable / disable rsync network backup.
    pub async fn set_rsync_enabled(client: &SynoClient, enabled: bool) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Core.FileServ.Rsync", 2)
            .unwrap_or(1);
        let en = if enabled { "true" } else { "false" };
        client
            .api_post_void("SYNO.Core.FileServ.Rsync", v, "set", &[("enable", en)])
            .await
    }
}
