//! Package management — list, install, uninstall, start, stop.
//!
//! `SYNO.Core.Package` answers `list` as `{"packages":[…],"total":n}` and `get`
//! as one flat package. Both carry `status`, `description` and the other
//! requested extras inside `additional` (N4S4/synology-api `core_package.py`,
//! dsm_helper `Core/Package.dart`). String parameters are JSON-quoted where
//! discovery declares `requestFormat: "JSON"` (`wire::string_param`).

use crate::client::SynoClient;
use crate::error::SynologyResult;
use crate::types::*;
use crate::wire::string_param;
use serde::Deserialize;

const PACKAGE: &str = "SYNO.Core.Package";

/// Extras `list` asks for; `status` is the one `is_running` and the panel need.
const LIST_ADDITIONAL: &str = "[\"description\",\"description_enu\",\"dependent_packages\",\"maintainer\",\"dsm_apps\",\"dsm_app_page\",\"is_uninstall_pages\",\"status\"]";

/// Extras `get` asks for (N4S4 `get_package` documents `status` and `dsm_apps`).
const GET_ADDITIONAL: &str = "[\"description\",\"maintainer\",\"dsm_apps\",\"status\"]";

pub struct PackagesManager;

/// One installed package as DSM sends it in `list` rows and in `get`.
#[derive(Deserialize)]
struct PackageWire {
    id: String,
    name: String,
    version: String,
    #[serde(default)]
    additional: Option<PackageAdditionalWire>,
}

#[derive(Deserialize)]
struct PackageAdditionalWire {
    #[serde(default)]
    status: Option<String>,
    /// The machine status; `status` may hold a description key instead
    /// (dsm_helper shows `"status":"status_description"` next to
    /// `"status_origin":"running"`).
    #[serde(default)]
    status_origin: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    maintainer: Option<String>,
    #[serde(default)]
    dsm_apps: Option<String>,
    #[serde(default)]
    dsm_app_page: Option<String>,
    #[serde(default)]
    is_uninstall_pages: Option<bool>,
}

impl From<PackageWire> for PackageInfo {
    fn from(wire: PackageWire) -> Self {
        let (status, description, is_uninstall_pages, additional) = match wire.additional {
            Some(extra) => (
                extra.status_origin.or(extra.status),
                extra.description.clone(),
                extra.is_uninstall_pages,
                Some(PackageAdditional {
                    description: extra.description,
                    maintainer: extra.maintainer,
                    dsm_apps: extra.dsm_apps,
                    dsm_app_page: extra.dsm_app_page,
                }),
            ),
            None => (None, None, None, None),
        };
        PackageInfo {
            id: wire.id,
            name: wire.name,
            version: wire.version,
            description,
            status,
            is_uninstall_pages,
            update_version: None,
            additional,
        }
    }
}

impl PackagesManager {
    /// List all installed packages.
    pub async fn list_installed(client: &SynoClient) -> SynologyResult<Vec<PackageInfo>> {
        let v = client.best_version(PACKAGE, 1).unwrap_or(1);
        let rows: Vec<PackageWire> = client
            .api_list(
                PACKAGE,
                v,
                "list",
                &[("additional", LIST_ADDITIONAL)],
                &["packages"],
            )
            .await?;
        Ok(rows.into_iter().map(PackageInfo::from).collect())
    }

    /// Get info for a specific package.
    pub async fn get_package(client: &SynoClient, id: &str) -> SynologyResult<PackageInfo> {
        let v = client.best_version(PACKAGE, 1).unwrap_or(1);
        let id = string_param(client, PACKAGE, id);
        let wire: PackageWire = client
            .api_call(
                PACKAGE,
                v,
                "get",
                &[("id", id.as_str()), ("additional", GET_ADDITIONAL)],
            )
            .await?;
        Ok(wire.into())
    }

    /// Start a package.
    pub async fn start(client: &SynoClient, id: &str) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Core.Package.Control", 1)
            .unwrap_or(1);
        let id = string_param(client, "SYNO.Core.Package.Control", id);
        client
            .api_post_void("SYNO.Core.Package.Control", v, "start", &[("id", &id)])
            .await
    }

    /// Stop a package.
    pub async fn stop(client: &SynoClient, id: &str) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Core.Package.Control", 1)
            .unwrap_or(1);
        let id = string_param(client, "SYNO.Core.Package.Control", id);
        client
            .api_post_void("SYNO.Core.Package.Control", v, "stop", &[("id", &id)])
            .await
    }

    /// Install a package from the Package Center.
    pub async fn install(client: &SynoClient, id: &str, volume: &str) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Core.Package.Installation", 1)
            .unwrap_or(1);
        let id = string_param(client, "SYNO.Core.Package.Installation", id);
        let volume = string_param(client, "SYNO.Core.Package.Installation", volume);
        client
            .api_post_void(
                "SYNO.Core.Package.Installation",
                v,
                "install",
                &[("id", &id), ("volume", &volume)],
            )
            .await
    }

    /// Uninstall a package.
    pub async fn uninstall(client: &SynoClient, id: &str) -> SynologyResult<()> {
        let v = client
            .best_version("SYNO.Core.Package.Uninstallation", 1)
            .unwrap_or(1);
        let id = string_param(client, "SYNO.Core.Package.Uninstallation", id);
        client
            .api_post_void(
                "SYNO.Core.Package.Uninstallation",
                v,
                "uninstall",
                &[("id", &id)],
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
            Ok(pkg) => Ok(pkg.status.as_deref() == Some("running")),
            Err(_) => Ok(false),
        }
    }
}
