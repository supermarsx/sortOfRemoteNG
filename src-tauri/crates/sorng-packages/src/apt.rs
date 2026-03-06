//! apt/apt-get package management (Debian/Ubuntu).
use crate::client;
use crate::error::PkgError;
use crate::types::*;

pub async fn update(host: &PkgHost) -> Result<String, PkgError> { client::exec_ok(host, "apt-get", &["update", "-qq"]).await }
pub async fn upgrade(host: &PkgHost) -> Result<String, PkgError> { client::exec_ok(host, "apt-get", &["upgrade", "-y", "-qq"]).await }
pub async fn dist_upgrade(host: &PkgHost) -> Result<String, PkgError> { client::exec_ok(host, "apt-get", &["dist-upgrade", "-y", "-qq"]).await }
pub async fn install(host: &PkgHost, packages: &[&str]) -> Result<String, PkgError> {
    let mut args = vec!["install", "-y", "-qq"];
    args.extend_from_slice(packages);
    client::exec_ok(host, "apt-get", &args).await
}
pub async fn remove(host: &PkgHost, packages: &[&str]) -> Result<String, PkgError> {
    let mut args = vec!["remove", "-y", "-qq"];
    args.extend_from_slice(packages);
    client::exec_ok(host, "apt-get", &args).await
}
pub async fn purge(host: &PkgHost, packages: &[&str]) -> Result<String, PkgError> {
    let mut args = vec!["purge", "-y", "-qq"];
    args.extend_from_slice(packages);
    client::exec_ok(host, "apt-get", &args).await
}
pub async fn autoremove(host: &PkgHost) -> Result<String, PkgError> { client::exec_ok(host, "apt-get", &["autoremove", "-y", "-qq"]).await }
pub async fn search(host: &PkgHost, query: &str) -> Result<Vec<Package>, PkgError> {
    let stdout = client::exec_ok(host, "apt-cache", &["search", query]).await?;
    Ok(stdout.lines().filter_map(|l| { let (name, desc) = l.split_once(" - ")?; Some(Package { name: name.trim().into(), version: String::new(), architecture: None, description: Some(desc.into()), installed: false, repo: None, size: None, install_date: None }) }).collect())
}
pub async fn list_installed(host: &PkgHost) -> Result<Vec<Package>, PkgError> {
    let stdout = client::exec_ok(host, "dpkg-query", &["-W", "-f", "${Package}|${Version}|${Architecture}|${Description}\\n"]).await?;
    Ok(parse_dpkg_list(&stdout))
}
pub async fn list_upgradable(host: &PkgHost) -> Result<Vec<PackageUpdate>, PkgError> {
    let stdout = client::exec_ok(host, "apt", &["list", "--upgradable", "-qq"]).await?;
    Ok(stdout.lines().filter_map(|l| {
        let parts: Vec<&str> = l.split_whitespace().collect();
        if parts.len() < 2 { return None; }
        let name = parts[0].split('/').next().unwrap_or(parts[0]).to_string();
        Some(PackageUpdate { name, current_version: String::new(), new_version: parts.get(1).unwrap_or(&"").to_string(), repo: None, security: false })
    }).collect())
}

fn parse_dpkg_list(output: &str) -> Vec<Package> {
    output.lines().filter_map(|line| {
        let parts: Vec<&str> = line.splitn(4, '|').collect();
        if parts.len() < 2 { return None; }
        Some(Package { name: parts[0].into(), version: parts[1].into(), architecture: parts.get(2).map(|s| s.to_string()), description: parts.get(3).map(|s| s.to_string()), installed: true, repo: None, size: None, install_date: None })
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_parse_dpkg() {
        let output = "vim|8.2.3995|amd64|Vi IMproved\ncurl|7.81.0|amd64|command line tool\n";
        let pkgs = parse_dpkg_list(output);
        assert_eq!(pkgs.len(), 2);
        assert_eq!(pkgs[0].name, "vim");
        assert_eq!(pkgs[0].version, "8.2.3995");
    }
}
