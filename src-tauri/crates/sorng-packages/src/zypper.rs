//! zypper package management (openSUSE/SLES).
use crate::client;
use crate::error::PkgError;
use crate::types::*;

pub async fn install(host: &PkgHost, packages: &[&str]) -> Result<String, PkgError> {
    let mut args = vec!["install", "-y"];
    args.extend_from_slice(packages);
    client::exec_ok(host, "zypper", &args).await
}
pub async fn remove(host: &PkgHost, packages: &[&str]) -> Result<String, PkgError> {
    let mut args = vec!["remove", "-y"];
    args.extend_from_slice(packages);
    client::exec_ok(host, "zypper", &args).await
}
pub async fn update(host: &PkgHost) -> Result<String, PkgError> {
    client::exec_ok(host, "zypper", &["refresh"]).await
}
pub async fn upgrade(host: &PkgHost) -> Result<String, PkgError> {
    client::exec_ok(host, "zypper", &["update", "-y"]).await
}

/// List available package updates.
///
/// Executes `zypper list-updates` and parses the tabular output.
/// Output format:
/// ```text
/// S | Repository         | Name           | Current Version | Available Version | Arch
/// --+--------------------+----------------+-----------------+-------------------+-------
/// v | repo-oss           | bash           | 5.2-1.1         | 5.2.15-1.3        | x86_64
/// ```
pub async fn list_updates(host: &PkgHost) -> Result<Vec<PackageUpdate>, PkgError> {
    let stdout = client::exec_ok(host, "zypper", &["--non-interactive", "list-updates"]).await?;
    Ok(stdout
        .lines()
        .filter(|l| {
            let trimmed = l.trim_start();
            // Lines starting with "v" indicate an available version update
            trimmed.starts_with("v ") || trimmed.starts_with("v|")
        })
        .filter_map(|l| {
            let parts: Vec<&str> = l.split('|').collect();
            if parts.len() < 5 {
                return None;
            }
            Some(PackageUpdate {
                name: parts[2].trim().into(),
                current_version: parts[3].trim().into(),
                new_version: parts[4].trim().into(),
                repo: Some(parts[1].trim().into()),
                security: false,
            })
        })
        .collect())
}

pub async fn list_installed(host: &PkgHost) -> Result<Vec<Package>, PkgError> {
    let stdout = client::exec_ok(
        host,
        "rpm",
        &[
            "-qa",
            "--queryformat",
            "%{NAME}|%{VERSION}|%{ARCH}|%{SUMMARY}\\n",
        ],
    )
    .await?;
    Ok(stdout
        .lines()
        .filter_map(|l| {
            let p: Vec<&str> = l.splitn(4, '|').collect();
            if p.len() < 2 {
                return None;
            }
            Some(Package {
                name: p[0].into(),
                version: p[1].into(),
                architecture: p.get(2).map(|s| s.to_string()),
                description: p.get(3).map(|s| s.to_string()),
                installed: true,
                repo: None,
                size: None,
                install_date: None,
            })
        })
        .collect())
}
pub async fn search(host: &PkgHost, query: &str) -> Result<Vec<Package>, PkgError> {
    let stdout = client::exec_ok(host, "zypper", &["search", "-s", query]).await?;
    Ok(stdout
        .lines()
        .skip(5)
        .filter_map(|l| {
            let p: Vec<&str> = l.split('|').collect();
            if p.len() < 4 {
                return None;
            }
            Some(Package {
                name: p[1].trim().into(),
                version: p[3].trim().into(),
                architecture: p.get(4).map(|s| s.trim().to_string()),
                description: None,
                installed: p[0].contains('i'),
                repo: p.get(5).map(|s| s.trim().to_string()),
                size: None,
                install_date: None,
            })
        })
        .collect())
}
