//! Package management — list, install, uninstall, start, stop.

use crate::client::SynoClient;
use crate::error::SynologyResult;
use crate::types::*;

pub struct PackagesManager;

impl PackagesManager {
    /// List all installed packages.
    pub async fn list_installed(client: &SynoClient) -> SynologyResult<Vec<PackageInfo>> {
        let v = client.best_version("SYNO.Core.Package", 1).unwrap_or(1);
        client
            .api_call(
                "SYNO.Core.Package",
                v,
                "list",
                &[(
                    "additional",
                    "[\"description\",\"description_enu\",\"dependent_packages\",\"status\"]",
                )],
            )
            .await
    }

    /// Get info for a specific package.
    pub async fn get_package(client: &SynoClient, id: &str) -> SynologyResult<PackageInfo> {
        let v = client.best_version("SYNO.Core.Package", 1).unwrap_or(1);
        client
            .api_call("SYNO.Core.Package", v, "get", &[("id", id)])
            .await
    }

    /// Start a package.
    pub async fn start(client: &SynoClient, id: &str) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Core.Package.Control", 1)
            .unwrap_or(1);
        client
            .api_post_void("SYNO.Core.Package.Control", v, "start", &[("id", id)])
            .await
    }

    /// Stop a package.
    pub async fn stop(client: &SynoClient, id: &str) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Core.Package.Control", 1)
            .unwrap_or(1);
        client
            .api_post_void("SYNO.Core.Package.Control", v, "stop", &[("id", id)])
            .await
    }

    /// Install a package from the Package Center.
    pub async fn install(client: &SynoClient, id: &str, volume: &str) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Core.Package.Installation", 1)
            .unwrap_or(1);
        client
            .api_post_void(
                "SYNO.Core.Package.Installation",
                v,
                "install",
                &[("id", id), ("volume", volume)],
            )
            .await
    }

    /// Uninstall a package.
    pub async fn uninstall(client: &SynoClient, id: &str) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Core.Package.Uninstallation", 1)
            .unwrap_or(1);
        client
            .api_post_void(
                "SYNO.Core.Package.Uninstallation",
                v,
                "uninstall",
                &[("id", id)],
            )
            .await
    }

    /// Check for package updates.
    pub async fn check_updates(client: &SynoClient) -> SynologyResult<Vec<PackageInfo>> {
        let v = client
            .best_version("SYNO.Core.Package.Server", 1)
            .unwrap_or(1);
        client
            .api_call("SYNO.Core.Package.Server", v, "list_upgradable", &[])
            .await
    }

    /// List available packages from Package Center feeds.
    pub async fn list_available(client: &SynoClient) -> SynologyResult<Vec<PackageInfo>> {
        let v = client
            .best_version("SYNO.Core.Package.Feed", 1)
            .unwrap_or(1);
        client
            .api_call("SYNO.Core.Package.Feed", v, "list", &[])
            .await
    }

    /// List Package Center feeds (community sources).
    pub async fn list_feeds(client: &SynoClient) -> SynologyResult<serde_json::Value> {
        let v = client
            .best_version("SYNO.Core.Package.Feed", 1)
            .unwrap_or(1);
        client
            .api_call("SYNO.Core.Package.Feed", v, "list", &[])
            .await
    }

    /// Check if a specific package is running.
    pub async fn is_running(client: &SynoClient, id: &str) -> SynologyResult<bool> {
        match Self::get_package(client, id).await {
            Ok(pkg) => Ok(pkg.status == "running"),
            Err(_) => Ok(false),
        }
    }
}
