//! NFS server control.
use crate::client;
use crate::error::FileSharingError;
use crate::types::*;

pub async fn start(host: &FileSharingHost) -> Result<(), FileSharingError> { client::exec_ok(host, "systemctl", &["start", "nfs-server"]).await?; Ok(()) }
pub async fn stop(host: &FileSharingHost) -> Result<(), FileSharingError> { client::exec_ok(host, "systemctl", &["stop", "nfs-server"]).await?; Ok(()) }
pub async fn restart(host: &FileSharingHost) -> Result<(), FileSharingError> { client::exec_ok(host, "systemctl", &["restart", "nfs-server"]).await?; Ok(()) }
pub async fn status(host: &FileSharingHost) -> Result<bool, FileSharingError> {
    let (_, _, code) = client::exec(host, "systemctl", &["is-active", "nfs-server"]).await?;
    Ok(code == 0)
}
pub async fn list_clients(host: &FileSharingHost) -> Result<Vec<NfsActiveClient>, FileSharingError> {
    let stdout = client::exec_ok(host, "showmount", &["-a", "--no-headers"]).await?;
    Ok(stdout.lines().filter_map(|line| {
        let (ip, path) = line.split_once(':')?;
        Some(NfsActiveClient { client_ip: ip.trim().into(), export_path: path.trim().into(), nfs_version: "4".into() })
    }).collect())
}
