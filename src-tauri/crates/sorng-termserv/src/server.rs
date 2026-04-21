//! Server management — open/close remote servers, enumerate domain servers,
//! shutdown/reboot, listener enumeration.

use crate::types::*;
use crate::wts_ffi;
use log::info;
use windows::Win32::Foundation::HANDLE;

/// Open a handle to a remote RD Session Host server.
/// Returns a `HANDLE` that must be closed via [`close_server`].
pub fn open_server(server_name: &str) -> TsResult<HANDLE> {
    info!("Opening WTS handle to server '{}'", server_name);
    wts_ffi::open_server(server_name)
}

/// Close a previously opened server handle.
pub fn close_server(handle: HANDLE) {
    wts_ffi::close_server(handle);
}

/// Enumerate all RD Session Host servers in a domain.
pub fn enumerate_domain_servers(domain: &str) -> TsResult<Vec<TsServerInfo>> {
    info!("Enumerating RD Session Host servers in domain '{}'", domain);
    wts_ffi::enumerate_servers(domain)
}

/// Shut down the RD Session Host server.
pub fn shutdown(server: HANDLE, flag: ShutdownFlag) -> TsResult<()> {
    info!("Initiating shutdown with flag {:?}", flag);
    wts_ffi::shutdown_system(server, flag.to_u32())
}

/// Enumerate all RDS listeners on a server.
pub fn list_listeners(server: HANDLE) -> TsResult<Vec<TsListenerInfo>> {
    wts_ffi::enumerate_listeners(server)
}

#[cfg(test)]
mod tests {
    // Server tests require actual remote server handles.
    // Integration tests would go here.
}
