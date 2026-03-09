//! Snap package management.
use crate::client;
use crate::error::PkgError;
use crate::types::*;

pub async fn list_installed(host: &PkgHost) -> Result<Vec<SnapPackage>, PkgError> {
    let stdout = client::exec_ok(host, "snap", &["list"]).await?;
    Ok(stdout
        .lines()
        .skip(1)
        .filter_map(|l| {
            let cols: Vec<&str> = l.split_whitespace().collect();
            if cols.len() < 4 {
                return None;
            }
            Some(SnapPackage {
                name: cols[0].into(),
                version: cols[1].into(),
                rev: cols[2].into(),
                channel: cols.get(3).unwrap_or(&"").to_string(),
                publisher: cols.get(4).map(|s| s.to_string()),
                description: None,
                confined: true,
            })
        })
        .collect())
}
pub async fn install(
    host: &PkgHost,
    name: &str,
    channel: Option<&str>,
) -> Result<String, PkgError> {
    let mut args = vec!["install", name];
    if let Some(ch) = channel {
        args.push("--channel");
        args.push(ch);
    }
    client::exec_ok(host, "snap", &args).await
}
pub async fn remove(host: &PkgHost, name: &str) -> Result<String, PkgError> {
    client::exec_ok(host, "snap", &["remove", name]).await
}
pub async fn refresh(host: &PkgHost) -> Result<String, PkgError> {
    client::exec_ok(host, "snap", &["refresh"]).await
}
