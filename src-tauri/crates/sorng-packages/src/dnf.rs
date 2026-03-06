//! dnf/yum package management (RHEL/Fedora).
use crate::client;
use crate::error::PkgError;
use crate::types::*;

pub async fn install(host: &PkgHost, packages: &[&str]) -> Result<String, PkgError> {
    let mut args = vec!["install", "-y"];
    args.extend_from_slice(packages);
    client::exec_ok(host, "dnf", &args).await
}
pub async fn remove(host: &PkgHost, packages: &[&str]) -> Result<String, PkgError> {
    let mut args = vec!["remove", "-y"];
    args.extend_from_slice(packages);
    client::exec_ok(host, "dnf", &args).await
}
pub async fn update(host: &PkgHost) -> Result<String, PkgError> { client::exec_ok(host, "dnf", &["check-update", "-q"]).await }
pub async fn upgrade(host: &PkgHost) -> Result<String, PkgError> { client::exec_ok(host, "dnf", &["upgrade", "-y", "-q"]).await }
pub async fn list_installed(host: &PkgHost) -> Result<Vec<Package>, PkgError> {
    let stdout = client::exec_ok(host, "rpm", &["-qa", "--queryformat", "%{NAME}|%{VERSION}-%{RELEASE}|%{ARCH}|%{SUMMARY}\\n"]).await?;
    Ok(stdout.lines().filter_map(|l| { let p: Vec<&str> = l.splitn(4, '|').collect(); if p.len() < 2 { return None; } Some(Package { name: p[0].into(), version: p[1].into(), architecture: p.get(2).map(|s| s.to_string()), description: p.get(3).map(|s| s.to_string()), installed: true, repo: None, size: None, install_date: None }) }).collect())
}
pub async fn list_updates(host: &PkgHost) -> Result<Vec<PackageUpdate>, PkgError> {
    let stdout = client::exec_ok(host, "dnf", &["check-update", "-q"]).await?;
    Ok(stdout.lines().filter_map(|l| { let p: Vec<&str> = l.split_whitespace().collect(); if p.len() < 3 { return None; } Some(PackageUpdate { name: p[0].into(), current_version: String::new(), new_version: p[1].into(), repo: Some(p[2].into()), security: false }) }).collect())
}
pub async fn search(host: &PkgHost, query: &str) -> Result<Vec<Package>, PkgError> {
    let stdout = client::exec_ok(host, "dnf", &["search", "-q", query]).await?;
    Ok(stdout.lines().filter_map(|l| { let (name, desc) = l.split_once(" : ")?; Some(Package { name: name.split('.').next()?.into(), version: String::new(), architecture: None, description: Some(desc.into()), installed: false, repo: None, size: None, install_date: None }) }).collect())
}
