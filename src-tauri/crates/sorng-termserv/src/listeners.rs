//! Listener management — enumerate and query RDS listeners.

use crate::types::*;
use crate::wts_ffi;
use windows::Win32::Foundation::HANDLE;

/// List all RDS listeners on the server.
pub fn list_listeners(server: HANDLE) -> TsResult<Vec<TsListenerInfo>> {
    wts_ffi::enumerate_listeners(server)
}
