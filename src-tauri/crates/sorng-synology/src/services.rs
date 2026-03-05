//! Services management — SMB, NFS, FTP, SSH, rsync, WebDAV.

use crate::client::SynoClient;
use crate::error::SynologyResult;
use crate::types::*;

pub struct ServicesManager;

impl ServicesManager {
    /// List all services and their status.
    pub async fn list(client: &SynoClient) -> SynologyResult<Vec<ServiceStatus>> {
        let v = client.best_version("SYNO.Core.Service", 1).unwrap_or(1);
        client.api_call("SYNO.Core.Service", v, "get", &[]).await
    }

    /// Enable or disable a service.
    pub async fn set_enabled(
        client: &SynoClient,
        service_id: &str,
        enabled: bool,
    ) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.Service", 1).unwrap_or(1);
        let en = if enabled { "true" } else { "false" };
        client.api_post_void(
            "SYNO.Core.Service",
            v,
            "set",
            &[("id", service_id), ("enable", en)],
        )
        .await
    }

    // ─── SMB / CIFS ──────────────────────────────────────────────

    /// Get SMB service configuration.
    pub async fn get_smb_config(client: &SynoClient) -> SynologyResult<SmbConfig> {
        let v = client.best_version("SYNO.Core.FileServ.SMB", 3).unwrap_or(1);
        client.api_call("SYNO.Core.FileServ.SMB", v, "get", &[]).await
    }

    /// Enable / disable SMB.
    pub async fn set_smb_enabled(client: &SynoClient, enabled: bool) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.FileServ.SMB", 3).unwrap_or(1);
        let en = if enabled { "true" } else { "false" };
        client.api_post_void("SYNO.Core.FileServ.SMB", v, "set", &[("enable_smb", en)]).await
    }

    // ─── NFS ─────────────────────────────────────────────────────

    /// Get NFS service configuration.
    pub async fn get_nfs_config(client: &SynoClient) -> SynologyResult<NfsConfig> {
        let v = client.best_version("SYNO.Core.FileServ.NFS", 2).unwrap_or(1);
        client.api_call("SYNO.Core.FileServ.NFS", v, "get", &[]).await
    }

    /// Enable / disable NFS.
    pub async fn set_nfs_enabled(client: &SynoClient, enabled: bool) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.FileServ.NFS", 2).unwrap_or(1);
        let en = if enabled { "true" } else { "false" };
        client.api_post_void("SYNO.Core.FileServ.NFS", v, "set", &[("enable_nfs", en)]).await
    }

    // ─── FTP ─────────────────────────────────────────────────────

    /// Get FTP configuration.
    pub async fn get_ftp_config(client: &SynoClient) -> SynologyResult<serde_json::Value> {
        let v = client.best_version("SYNO.Core.FileServ.FTP", 3).unwrap_or(1);
        client.api_call("SYNO.Core.FileServ.FTP", v, "get", &[]).await
    }

    /// Enable / disable FTP.
    pub async fn set_ftp_enabled(client: &SynoClient, enabled: bool) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.FileServ.FTP", 3).unwrap_or(1);
        let en = if enabled { "true" } else { "false" };
        client.api_post_void("SYNO.Core.FileServ.FTP", v, "set", &[("enable_ftp", en)]).await
    }

    // ─── SSH ─────────────────────────────────────────────────────

    /// Get SSH configuration.
    pub async fn get_ssh_config(client: &SynoClient) -> SynologyResult<SshConfig> {
        let v = client.best_version("SYNO.Core.Terminal", 3).unwrap_or(1);
        client.api_call("SYNO.Core.Terminal", v, "get", &[]).await
    }

    /// Enable / disable SSH.
    pub async fn set_ssh_enabled(client: &SynoClient, enabled: bool) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.Terminal", 3).unwrap_or(1);
        let en = if enabled { "true" } else { "false" };
        client.api_post_void("SYNO.Core.Terminal", v, "set", &[("enable_ssh", en)]).await
    }

    /// Set SSH port.
    pub async fn set_ssh_port(client: &SynoClient, port: u16) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.Terminal", 3).unwrap_or(1);
        let p = port.to_string();
        client.api_post_void("SYNO.Core.Terminal", v, "set", &[("ssh_port", &p)]).await
    }

    // ─── WebDAV ──────────────────────────────────────────────────

    /// Get WebDAV config.
    pub async fn get_webdav_config(client: &SynoClient) -> SynologyResult<serde_json::Value> {
        let v = client.best_version("SYNO.Core.FileServ.WebDAV", 2).unwrap_or(1);
        client.api_call("SYNO.Core.FileServ.WebDAV", v, "get", &[]).await
    }

    /// Enable / disable WebDAV.
    pub async fn set_webdav_enabled(client: &SynoClient, enabled: bool) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.FileServ.WebDAV", 2).unwrap_or(1);
        let en = if enabled { "true" } else { "false" };
        client.api_post_void("SYNO.Core.FileServ.WebDAV", v, "set", &[("enable_webdav", en)]).await
    }

    // ─── Rsync ───────────────────────────────────────────────────

    /// Get rsync service status.
    pub async fn get_rsync_config(client: &SynoClient) -> SynologyResult<serde_json::Value> {
        let v = client.best_version("SYNO.Core.FileServ.Rsync", 2).unwrap_or(1);
        client.api_call("SYNO.Core.FileServ.Rsync", v, "get", &[]).await
    }

    /// Enable / disable rsync network backup.
    pub async fn set_rsync_enabled(client: &SynoClient, enabled: bool) -> SynologyResult<()> {
        let v = client.best_version("SYNO.Core.FileServ.Rsync", 2).unwrap_or(1);
        let en = if enabled { "true" } else { "false" };
        client.api_post_void("SYNO.Core.FileServ.Rsync", v, "set", &[("enable", en)]).await
    }
}
