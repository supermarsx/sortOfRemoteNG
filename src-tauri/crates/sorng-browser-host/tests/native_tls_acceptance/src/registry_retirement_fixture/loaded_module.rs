//! Fixture-only exact loaded-image resolver; no search-path or fallback load.
#[derive(Debug)]
pub struct ResolveError;
pub use implementation::Module;
#[cfg(target_os = "windows")]
mod implementation {
    use super::ResolveError;
    use std::{
        ffi::{c_char, c_void, CStr},
        ptr,
    };
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetModuleHandleExW(flags: u32, address: *const u16, module: *mut *mut c_void) -> i32;
        fn GetProcAddress(module: *mut c_void, name: *const c_char) -> *mut c_void;
    }
    pub struct Module(*mut c_void);
    impl Module {
        pub unsafe fn from_address(
            address: *const c_void,
        ) -> std::result::Result<Self, ResolveError> {
            let mut module = ptr::null_mut();
            // FROM_ADDRESS | PIN: already loaded code remains mapped through all
            // callback/completion lifetimes, including failed shutdown cleanup.
            if address.is_null()
                || unsafe { GetModuleHandleExW(4 | 1, address.cast(), &mut module) } == 0
            {
                return Err(ResolveError);
            }
            Ok(Self(module))
        }
        pub unsafe fn symbol(&self, name: &CStr) -> std::result::Result<*mut c_void, ResolveError> {
            let symbol = unsafe { GetProcAddress(self.0, name.as_ptr()) };
            if symbol.is_null() || unsafe { Self::from_address(symbol) }?.0 != self.0 {
                return Err(ResolveError);
            }
            Ok(symbol)
        }
    }
}
#[cfg(any(target_os = "linux", target_os = "macos"))]
mod implementation {
    use super::ResolveError;
    use std::{
        ffi::{c_char, c_void, CStr},
        ptr,
    };
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
    pub struct Module {
        handle: *mut c_void,
        base: *mut c_void,
    }
    impl Module {
        pub unsafe fn from_address(
            address: *const c_void,
        ) -> std::result::Result<Self, ResolveError> {
            let mut info: DlInfo = unsafe { std::mem::zeroed() };
            if address.is_null()
                || unsafe { dladdr(address, &mut info) } == 0
                || info.name.is_null()
            {
                return Err(ResolveError);
            }
            #[cfg(target_os = "linux")]
            const NOLOAD: i32 = 4;
            #[cfg(target_os = "macos")]
            const NOLOAD: i32 = 0x10;
            // No search path/fallback load. Retain this already-loaded image for
            // process lifetime; never unload code still reachable by callbacks.
            let handle = unsafe { dlopen(info.name, NOLOAD | 2) };
            if handle.is_null() {
                return Err(ResolveError);
            }
            Ok(Self {
                handle,
                base: info.base,
            })
        }
        pub unsafe fn symbol(&self, name: &CStr) -> std::result::Result<*mut c_void, ResolveError> {
            let symbol = unsafe { dlsym(self.handle, name.as_ptr()) };
            let mut info: DlInfo = unsafe { std::mem::zeroed() };
            if symbol.is_null()
                || unsafe { dladdr(symbol, &mut info) } == 0
                || info.base != self.base
            {
                return Err(ResolveError);
            }
            Ok(symbol)
        }
    }
}
