//! Compile-only harness for the app entry while main owns lib.rs wiring.
//! Never execute this harness: registry functions deliberately cannot run CEF.
#[path = "../../../src/origin_browser_entry.rs"]
mod origin_browser_entry;

pub fn run() {
    panic!("compile-only harness");
}

mod origin_browser_runtime {
    pub(crate) fn revoke_all() {
        panic!("compile-only harness");
    }
    pub(crate) fn install(
        _: sorng_browser_host::cef_runtime::CefRuntime<'static>,
        _: bool,
    ) -> Result<(), String> {
        panic!("compile-only harness");
    }
    pub(crate) fn shutdown() -> Result<(), String> {
        panic!("compile-only harness");
    }
}
