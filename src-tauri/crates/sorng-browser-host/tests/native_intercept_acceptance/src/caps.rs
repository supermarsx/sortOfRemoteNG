//! Read-only copy of the loaded bridge's raw capability word, for the log.
//! `NativeTlsBridge` exposes only predicates; this reads the same exported
//! `cef_sorng_tls_get_api_v2` table from the already loaded CEF image (no
//! search path, no load) after `NativeTlsBridge::from_loaded_supported`
//! has validated it.
use std::ffi::{c_char, c_void};

#[repr(C)]
struct Api {
    size: u32,
    abi_version: u32,
    capabilities: u64,
}

pub const NAMES: &[(u64, &str)] = &[
    (1, "SOCKET"),
    (2, "REVOKE"),
    (4, "HTTP1"),
    (8, "EXCEPTIONS"),
    (16, "CUSTOM_CA"),
    (32, "PRIVATE"),
    (64, "SAME_AUTHORITY_HTTP2"),
    (1 << 7, "OWNED_HTTP3"),
    (1 << 8, "PROXY_APPLIED"),
    (1 << 9, "BOUNDED_RETIREMENT"),
    (1 << 10, "HTTP_DISK_CACHE"),
];
pub const CUSTOM_CA: u64 = 16;

pub fn names(bits: u64) -> Vec<&'static str> {
    NAMES
        .iter()
        .filter(|(bit, _)| bits & bit != 0)
        .map(|(_, name)| *name)
        .collect()
}

/// # Safety
/// CEF must be initialized and the bridge already validated on this thread.
pub unsafe fn loaded_capabilities() -> Option<u64> {
    let anchor = unsafe { cef::sys::cef_api_hash(cef::sys::CEF_API_VERSION_LAST, 2) };
    let symbol = unsafe { module::symbol(anchor.cast(), c"cef_sorng_tls_get_api_v2".as_ptr())? };
    let get: unsafe extern "C" fn() -> *const Api = unsafe { std::mem::transmute(symbol) };
    let api = unsafe { get() };
    if api.is_null() || unsafe { (*api).abi_version } != 2 || unsafe { (*api).size } < 16 {
        return None;
    }
    Some(unsafe { (*api).capabilities })
}

#[cfg(target_os = "windows")]
mod module {
    use super::*;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetModuleHandleExW(flags: u32, address: *const u16, module: *mut *mut c_void) -> i32;
        fn GetProcAddress(module: *mut c_void, name: *const c_char) -> *mut c_void;
    }
    pub unsafe fn symbol(address: *const c_void, name: *const c_char) -> Option<*mut c_void> {
        let mut module = std::ptr::null_mut();
        // FROM_ADDRESS | UNCHANGED_REFCOUNT: the image is already pinned by the bridge.
        if address.is_null()
            || unsafe { GetModuleHandleExW(4 | 2, address.cast(), &mut module) } == 0
        {
            return None;
        }
        let symbol = unsafe { GetProcAddress(module, name) };
        (!symbol.is_null()).then_some(symbol)
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
mod module {
    use super::*;
    #[repr(C)]
    struct DlInfo {
        name: *const c_char,
        base: *mut c_void,
        symbol: *const c_char,
        address: *mut c_void,
    }
    #[cfg_attr(target_os = "linux", link(name = "dl"))]
    unsafe extern "C" {
        fn dladdr(address: *const c_void, info: *mut DlInfo) -> i32;
        fn dlopen(name: *const c_char, flags: i32) -> *mut c_void;
        fn dlsym(handle: *mut c_void, name: *const c_char) -> *mut c_void;
    }
    pub unsafe fn symbol(address: *const c_void, name: *const c_char) -> Option<*mut c_void> {
        let mut info: DlInfo = unsafe { std::mem::zeroed() };
        if address.is_null() || unsafe { dladdr(address, &mut info) } == 0 || info.name.is_null() {
            return None;
        }
        #[cfg(target_os = "linux")]
        const NOLOAD: i32 = 4;
        #[cfg(target_os = "macos")]
        const NOLOAD: i32 = 0x10;
        let handle = unsafe { dlopen(info.name, NOLOAD | 2) };
        if handle.is_null() {
            return None;
        }
        let symbol = unsafe { dlsym(handle, name) };
        (!symbol.is_null()).then_some(symbol)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_follow_the_bridge_header_bits() {
        assert_eq!(names(16 | 1), vec!["SOCKET", "CUSTOM_CA"]);
        assert_eq!(names(1 << 10), vec!["HTTP_DISK_CACHE"]);
        assert!(names(0).is_empty());
    }
}
