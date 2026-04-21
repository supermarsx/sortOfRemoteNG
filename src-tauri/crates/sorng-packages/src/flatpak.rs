//! Flatpak package management.
use crate::client;
use crate::error::PkgError;
use crate::types::*;

pub async fn list_installed(host: &PkgHost) -> Result<Vec<FlatpakPackage>, PkgError> {
    let stdout = client::exec_ok(
        host,
        "flatpak",
        &[
            "list",
            "--columns=application,name,version,origin,arch,branch",
        ],
    )
    .await?;
    Ok(stdout
        .lines()
        .filter_map(|l| {
            let cols: Vec<&str> = l.split('\t').collect();
            if cols.len() < 5 {
                return None;
            }
            Some(FlatpakPackage {
                app_id: cols[0].into(),
                name: cols[1].into(),
                version: cols.get(2).unwrap_or(&"").to_string(),
                origin: cols[3].into(),
                arch: cols.get(4).unwrap_or(&"").to_string(),
                branch: cols.get(5).unwrap_or(&"").to_string(),
            })
        })
        .collect())
}
pub async fn install(host: &PkgHost, app_id: &str) -> Result<String, PkgError> {
    client::exec_ok(host, "flatpak", &["install", "-y", app_id]).await
}
pub async fn remove(host: &PkgHost, app_id: &str) -> Result<String, PkgError> {
    client::exec_ok(host, "flatpak", &["uninstall", "-y", app_id]).await
}
pub async fn update(host: &PkgHost) -> Result<String, PkgError> {
    client::exec_ok(host, "flatpak", &["update", "-y"]).await
}
