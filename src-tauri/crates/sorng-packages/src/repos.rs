//! Package repository management.
use crate::client;
use crate::error::PkgError;
use crate::types::*;

pub async fn list_repos_apt(host: &PkgHost) -> Result<Vec<PackageRepo>, PkgError> {
    let stdout = client::exec_ok(host, "apt-cache", &["policy"]).await?;
    let mut repos = Vec::new();
    for line in stdout.lines() {
        let line = line.trim();
        if line.starts_with("http") || line.starts_with("https") {
            repos.push(PackageRepo {
                id: line.split_whitespace().next().unwrap_or("").into(),
                name: line.to_string(),
                url: line.split_whitespace().next().unwrap_or("").into(),
                enabled: true,
                repo_type: Some("deb".into()),
                gpg_check: true,
                gpg_key: None,
            });
        }
    }
    Ok(repos)
}

pub async fn list_repos_dnf(host: &PkgHost) -> Result<Vec<PackageRepo>, PkgError> {
    let stdout = client::exec_ok(host, "dnf", &["repolist", "-v"]).await?;
    let mut repos = Vec::new();
    let mut id = String::new();
    let mut name = String::new();
    let mut url = String::new();
    for line in stdout.lines() {
        let line = line.trim();
        if line.starts_with("Repo-id") {
            id = line.split(':').nth(1).unwrap_or("").trim().into();
        } else if line.starts_with("Repo-name") {
            name = line.split(':').nth(1).unwrap_or("").trim().into();
        } else if line.starts_with("Repo-baseurl") {
            url = line.split(':').nth(1).unwrap_or("").trim().into();
        } else if line.is_empty() && !id.is_empty() {
            repos.push(PackageRepo {
                id: id.clone(),
                name: name.clone(),
                url: url.clone(),
                enabled: true,
                repo_type: Some("rpm".into()),
                gpg_check: true,
                gpg_key: None,
            });
            id.clear();
            name.clear();
            url.clear();
        }
    }
    if !id.is_empty() {
        repos.push(PackageRepo {
            id,
            name,
            url,
            enabled: true,
            repo_type: Some("rpm".into()),
            gpg_check: true,
            gpg_key: None,
        });
    }
    Ok(repos)
}
