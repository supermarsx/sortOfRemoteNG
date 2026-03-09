//! pacman package management (Arch).
use crate::client;
use crate::error::PkgError;
use crate::types::*;

pub async fn install(host: &PkgHost, packages: &[&str]) -> Result<String, PkgError> {
    let mut args = vec!["-S", "--noconfirm"];
    args.extend_from_slice(packages);
    client::exec_ok(host, "pacman", &args).await
}
pub async fn remove(host: &PkgHost, packages: &[&str]) -> Result<String, PkgError> {
    let mut args = vec!["-R", "--noconfirm"];
    args.extend_from_slice(packages);
    client::exec_ok(host, "pacman", &args).await
}
pub async fn sync_update(host: &PkgHost) -> Result<String, PkgError> {
    client::exec_ok(host, "pacman", &["-Syu", "--noconfirm"]).await
}
pub async fn list_installed(host: &PkgHost) -> Result<Vec<Package>, PkgError> {
    let stdout = client::exec_ok(host, "pacman", &["-Q"]).await?;
    Ok(stdout
        .lines()
        .filter_map(|l| {
            let parts: Vec<&str> = l.split_whitespace().collect();
            if parts.len() < 2 {
                return None;
            }
            Some(Package {
                name: parts[0].into(),
                version: parts[1].into(),
                architecture: None,
                description: None,
                installed: true,
                repo: None,
                size: None,
                install_date: None,
            })
        })
        .collect())
}
pub async fn list_updates(host: &PkgHost) -> Result<Vec<PackageUpdate>, PkgError> {
    let stdout = client::exec_ok(host, "pacman", &["-Qu"]).await?;
    Ok(stdout
        .lines()
        .filter_map(|l| {
            let p: Vec<&str> = l.split_whitespace().collect();
            if p.len() < 4 {
                return None;
            }
            Some(PackageUpdate {
                name: p[0].into(),
                current_version: p[1].into(),
                new_version: p[3].into(),
                repo: None,
                security: false,
            })
        })
        .collect())
}
pub async fn search(host: &PkgHost, query: &str) -> Result<Vec<Package>, PkgError> {
    let stdout = client::exec_ok(host, "pacman", &["-Ss", query]).await?;
    let mut pkgs = Vec::new();
    let mut lines = stdout.lines().peekable();
    while let Some(line) = lines.next() {
        if line.starts_with(' ') {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            let name = parts[0].rsplit('/').next().unwrap_or(parts[0]);
            let desc = lines.next().map(|l| l.trim().to_string());
            pkgs.push(Package {
                name: name.into(),
                version: parts[1].into(),
                architecture: None,
                description: desc,
                installed: false,
                repo: None,
                size: None,
                install_date: None,
            });
        }
    }
    Ok(pkgs)
}
