//! Test-only macOS dynamic CEF loading. No browser process, sandbox bypass,
//! NSApplication, worker startup or CefInitialize is performed by this hook.

use std::{ffi::CString, os::unix::ffi::OsStrExt, path::Path, sync::Once};

/// Load once before any CEF string allocation/free or other CEF FFI in a test.
/// The framework intentionally stays loaded until process exit: tests can run
/// in parallel and native wrappers can be dropped after an individual test.
pub(crate) fn ensure_loaded() {
    static LOADED: Once = Once::new();
    LOADED.call_once(|| {
        // build.rs must emit this from DEP_CEF_DLL_WRAPPER_CEF_DIR, not from a
        // test's mutable CEF_PATH or a caller-supplied framework search path.
        let root = option_env!("SORNG_CEF_TEST_RUNTIME_DIR")
            .expect("build.rs must export the selected CEF SDK as SORNG_CEF_TEST_RUNTIME_DIR");
        let framework = Path::new(root)
            .join("Chromium Embedded Framework.framework/Chromium Embedded Framework")
            .canonicalize()
            .expect("pinned macOS CEF test framework is missing");
        let path = CString::new(framework.as_os_str().as_bytes())
            .expect("CEF test framework path contains NUL");
        assert_eq!(
            unsafe { cef::load_library(Some(&*path.as_ptr())) },
            1,
            "CEF test framework could not be loaded"
        );
        crate::bootstrap_platform::select_pinned_api()
            .expect("CEF test framework revision/API mismatch");
    });
}
