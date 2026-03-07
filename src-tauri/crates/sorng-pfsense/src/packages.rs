//! Package management for pfSense/OPNsense.

use crate::client::PfsenseClient;
use crate::error::{PfsenseError, PfsenseResult};
use crate::types::*;

pub struct PackageManager;

impl PackageManager {
    pub async fn list_installed(client: &PfsenseClient) -> PfsenseResult<Vec<PfsensePackage>> {
        let resp = client.api_get("/system/package").await?;
        let pkgs = resp.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        pkgs.into_iter()
            .map(|v| serde_json::from_value(v).map_err(|e| PfsenseError::parse(e.to_string())))
            .collect()
    }

    pub async fn list_available(client: &PfsenseClient) -> PfsenseResult<Vec<PfsensePackage>> {
        let resp = client.api_get("/system/package/available").await?;
        let pkgs = resp.get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default();
        pkgs.into_iter()
            .map(|v| serde_json::from_value(v).map_err(|e| PfsenseError::parse(e.to_string())))
            .collect()
    }

    pub async fn install(client: &PfsenseClient, name: &str) -> PfsenseResult<()> {
        let body = serde_json::json!({ "name": name });
        client.api_post("/system/package", &body).await?;
        Ok(())
    }

    pub async fn uninstall(client: &PfsenseClient, name: &str) -> PfsenseResult<()> {
        client.api_delete(&format!("/system/package/{name}")).await
    }

    pub async fn update(client: &PfsenseClient, name: &str) -> PfsenseResult<()> {
        let body = serde_json::json!({ "name": name });
        client.api_post("/system/package/update", &body).await?;
        Ok(())
    }

    pub async fn check_updates(client: &PfsenseClient) -> PfsenseResult<Vec<PfsensePackage>> {
        let installed = Self::list_installed(client).await?;
        let available = Self::list_available(client).await?;
        let updates: Vec<PfsensePackage> = installed.into_iter()
            .filter_map(|pkg| {
                available.iter()
                    .find(|a| a.name == pkg.name && a.version != pkg.installed_version)
                    .map(|a| PfsensePackage {
                        name: pkg.name,
                        version: a.version.clone(),
                        installed_version: pkg.installed_version,
                        description: pkg.description,
                        installed: true,
                        available_version: a.version.clone(),
                    })
            })
            .collect();
        Ok(updates)
    }

    pub async fn get_package_info(client: &PfsenseClient, name: &str) -> PfsenseResult<PfsensePackage> {
        let all = Self::list_available(client).await?;
        let mut pkg = all.into_iter()
            .find(|p| p.name == name)
            .ok_or_else(|| PfsenseError::package_not_found(name))?;
        let installed = Self::list_installed(client).await?;
        if let Some(inst) = installed.iter().find(|p| p.name == name) {
            pkg.installed = true;
            pkg.installed_version = inst.installed_version.clone();
        }
        Ok(pkg)
    }
}
