//! Final-client linker policy for the pinned CEF 682c378 Windows bootstrap.
//!
//! A sandboxed child loads the same client DLL as the browser. Its loader must
//! not initialize browser-only GUI/COM dependencies before RunWinMain can
//! dispatch CefExecuteProcess. This changes loading order, never sandbox policy.
//!
//! Keep the CEF list synchronized with CEF_DELAYLOAD_FLAGS in
//! https://github.com/chromiumembedded/cef/blob/682c378d70d5780061e96644dca16ddd8fd157a9/cmake/cef_variables.cmake.in
//! The static cef_dll_wrapper build cannot apply these flags to a Rust final link.

const CEF_DELAY_LOAD_DLLS: &[&str] = &[
    "libcef.dll",
    "api-ms-win-core-synch-l1-2-0.dll",
    "api-ms-win-core-winrt-error-l1-1-0.dll",
    "api-ms-win-core-winrt-l1-1-0.dll",
    "api-ms-win-core-winrt-string-l1-1-0.dll",
    "advapi32.dll",
    "bcryptprimitives.dll",
    "comctl32.dll",
    "comdlg32.dll",
    "credui.dll",
    "cryptui.dll",
    "d3d11.dll",
    "d3d12.dll",
    "d3d9.dll",
    "dbghelp.dll",
    "dcomp.dll",
    "dwmapi.dll",
    "dxgi.dll",
    "dxva2.dll",
    "esent.dll",
    "fontsub.dll",
    "gdi32.dll",
    "hid.dll",
    "imagehlp.dll",
    "imm32.dll",
    "mmdevapi.dll",
    "msi.dll",
    "netapi32.dll",
    "ncrypt.dll",
    "ole32.dll",
    "oleacc.dll",
    "oleaut32.dll",
    "pdh.dll",
    "propsys.dll",
    "psapi.dll",
    "rpcrt4.dll",
    "rstrtmgr.dll",
    "setupapi.dll",
    "shell32.dll",
    "shlwapi.dll",
    "uiautomationcore.dll",
    "urlmon.dll",
    "user32.dll",
    "usp10.dll",
    "uxtheme.dll",
    "wer.dll",
    "wevtapi.dll",
    "wininet.dll",
    "winusb.dll",
    "wsock32.dll",
    "wtsapi32.dll",
    "crypt32.dll",
    "dhcpcsvc.dll",
    "dwrite.dll",
    "iphlpapi.dll",
    "secur32.dll",
    "userenv.dll",
    "winhttp.dll",
    "winmm.dll",
    "winspool.drv",
    "wintrust.dll",
    "ws2_32.dll",
];

// Rust's Windows bindings import COM/WinRT entry points directly from combase,
// rather than exclusively through CEF's API-set/ole32 import libraries. Avoid
// initializing this browser-side COM dependency in the sandboxed DLL loader.
const RUST_DELAY_LOAD_DLLS: &[&str] = &["combase.dll"];

// Canonicalize the pinned app's mixed-source import closures to the Windows SDK.
// MSVC's delayed-import descriptor merges DLL names case-insensitively while
// sorting their IAT fragments case-sensitively. Mixing windows-targets' lowercase
// imports with SDK uppercase imports therefore creates orphan call stubs.
// Resolve these references before dependency archive scanning. The final-PE
// guard and full-app network probe protect these lists against graph changes.
const WINSOCK_IMPORTS: &[&str] = &[
    "WSAStartup",
    "WSACleanup",
    "WSASendMsg",
    "WSAIoctl",
    "WSASend",
    "WSARecv",
    "freeaddrinfo",
    "getnameinfo",
    "getaddrinfo",
    "WSAGetLastError",
    "select",
    "__WSAFDIsSet",
    "socket",
    "WSADuplicateSocketW",
    "shutdown",
    "sendto",
    "connect",
    "WSASocketW",
    "listen",
    "send",
    "recv",
    "bind",
    "closesocket",
    "ioctlsocket",
    "getsockopt",
    "setsockopt",
    "getpeername",
    "getsockname",
    "recvfrom",
    "accept",
];

// Downloads added SDK SHELL32 imports alongside windows-targets' shell32
// imports. The resulting descriptor advertised only four SDK entries, leaving
// seven real call stubs outside its IAT. Anchor BOTH fragments, not just the
// new downloads functions; changing /DELAYLOAD casing alone cannot merge them.
const SHELL32_IMPORTS: &[&str] = &[
    "SHOpenFolderAndSelectItems",
    "ILCreateFromPathW",
    "Shell_NotifyIconW",
    "ILFree",
    "SHGetKnownFolderPath",
    "SHCreateItemFromParsingName",
    "ShellExecuteW",
    "Shell_NotifyIconGetRect",
    "DragFinish",
    "SHAppBarMessage",
    "DragQueryFileW",
];

fn canonical_import_directives(cef_enabled: bool, os: &str, env: &str) -> Vec<String> {
    if !cef_enabled || os != "windows" || env != "msvc" {
        return Vec::new();
    }
    let mut result = Vec::new();
    for (library, imports) in [("ws2_32", WINSOCK_IMPORTS), ("shell32", SHELL32_IMPORTS)] {
        result.push(format!("cargo:rustc-link-lib=dylib={library}"));
        result.extend(
            imports
                .iter()
                .map(|symbol| format!("cargo:rustc-link-arg=/INCLUDE:__imp_{symbol}")),
        );
    }
    result
}

fn linker_arguments(
    cef_enabled: bool,
    target_os: &str,
    target_env: &str,
) -> Result<Vec<String>, &'static str> {
    if !cef_enabled || target_os != "windows" {
        return Ok(Vec::new());
    }
    if target_env != "msvc" {
        return Err(
            "The pinned Windows CEF bootstrap requires the MSVC delay-load linker contract",
        );
    }

    // Make the delay-load helper explicit at the same final link. cef-dll-sys
    // also supplies this SDK library; naming it again does not add a DLL import.
    // Keep kernel32/ntdll/the CRT eager: they support the loader/helper itself.
    // CEF deliberately lists optional DLLs which a particular client may not
    // import. Suppress only LNK4199 (unused /DELAYLOAD); keep all other linker
    // diagnostics visible. Verify required delayed imports in the final PE.
    let mut arguments = vec!["delayimp.lib".to_owned(), "/IGNORE:4199".to_owned()];
    arguments.extend(
        CEF_DELAY_LOAD_DLLS
            .iter()
            .chain(RUST_DELAY_LOAD_DLLS)
            .map(|dll| format!("/DELAYLOAD:{dll}")),
    );
    Ok(arguments)
}

/// Call from each final client package's build.rs, not an rlib dependency.
/// Cargo's target environment is used so cross-compilation works identically.
pub fn configure(cef_enabled: bool) {
    let os = std::env::var("CARGO_CFG_TARGET_OS").expect("Cargo supplies the target OS");
    let env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    for directive in canonical_import_directives(cef_enabled, &os, &env) {
        println!("{directive}");
    }
    for argument in linker_arguments(cef_enabled, &os, &env)
        .expect("Cannot link a sandbox-compatible CEF client")
    {
        // The app manifest declares rlib; the browser driver selects cdylib via
        // `cargo rustc --lib --crate-type cdylib`. Use the general final-link
        // directive, not one conditional on a manifest-declared cdylib target.
        println!("cargo:rustc-link-arg={argument}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn canonical_winsock_imports_are_early_anchored_and_remain_delayed() {
        let directives = canonical_import_directives(true, "windows", "msvc");
        assert_eq!(directives[0], "cargo:rustc-link-lib=dylib=ws2_32");
        assert_eq!(
            directives.len(),
            WINSOCK_IMPORTS.len() + SHELL32_IMPORTS.len() + 2
        );
        assert_eq!(
            WINSOCK_IMPORTS.len(),
            WINSOCK_IMPORTS.iter().collect::<BTreeSet<_>>().len()
        );
        for symbol in [
            "WSAStartup",
            "WSACleanup",
            "bind",
            "WSASocketW",
            "closesocket",
            "WSARecv",
        ] {
            assert!(directives.contains(&format!("cargo:rustc-link-arg=/INCLUDE:__imp_{symbol}")));
        }
        assert!(linker_arguments(true, "windows", "msvc")
            .unwrap()
            .contains(&"/DELAYLOAD:ws2_32.dll".to_owned()));
        for (enabled, os, env) in [
            (false, "windows", "msvc"),
            (true, "windows", "gnu"),
            (true, "linux", "gnu"),
            (true, "macos", ""),
        ] {
            assert!(canonical_import_directives(enabled, os, env).is_empty());
        }
    }

    #[test]
    fn canonical_shell32_imports_cover_both_fragments_and_remain_delayed() {
        let directives = canonical_import_directives(true, "windows", "msvc");
        let first = WINSOCK_IMPORTS.len() + 1;
        assert_eq!(directives[first], "cargo:rustc-link-lib=dylib=shell32");
        assert_eq!(SHELL32_IMPORTS.len(), 11);
        assert_eq!(
            directives.len(),
            directives.iter().collect::<BTreeSet<_>>().len()
        );
        for (index, symbol) in SHELL32_IMPORTS.iter().enumerate() {
            assert_eq!(
                directives[first + index + 1],
                format!("cargo:rustc-link-arg=/INCLUDE:__imp_{symbol}")
            );
        }
        assert!(linker_arguments(true, "windows", "msvc")
            .unwrap()
            .contains(&"/DELAYLOAD:shell32.dll".to_owned()));
    }

    #[test]
    fn no_msvc_flags_for_non_windows_or_non_cef_builds() {
        for (enabled, os, env) in [
            (false, "windows", "msvc"),
            (false, "windows", "gnu"),
            (true, "linux", "gnu"),
            (true, "macos", ""),
        ] {
            assert!(linker_arguments(enabled, os, env).unwrap().is_empty());
        }
    }

    #[test]
    fn unsupported_windows_linker_does_not_silently_omit_sandbox_requirements() {
        assert!(linker_arguments(true, "windows", "gnu").is_err());
        assert!(linker_arguments(true, "windows", "").is_err());
    }

    #[test]
    fn delays_gui_com_cef_and_transitive_gui_import_roots() {
        let arguments = linker_arguments(true, "windows", "msvc").unwrap();
        assert_eq!(arguments[0], "delayimp.lib");
        for dll in [
            "libcef.dll",
            "user32.dll",
            "gdi32.dll",
            "ole32.dll",
            "oleaut32.dll",
            "combase.dll",
            "comctl32.dll",
            "shell32.dll",
            "dwmapi.dll",
            "winmm.dll",
            "ws2_32.dll",
        ] {
            assert!(arguments.contains(&format!("/DELAYLOAD:{dll}")), "{dll}");
        }
    }

    #[test]
    fn suppresses_only_optional_unused_delayload_warning() {
        let arguments = linker_arguments(true, "windows", "msvc").unwrap();
        let ignored: Vec<_> = arguments
            .iter()
            .filter(|arg| arg.starts_with("/IGNORE:"))
            .map(String::as_str)
            .collect();
        assert_eq!(ignored, ["/IGNORE:4199"]);
        assert!(!arguments.iter().any(|arg| arg.starts_with("/WX")));
        assert_eq!(
            arguments.len(),
            CEF_DELAY_LOAD_DLLS.len() + RUST_DELAY_LOAD_DLLS.len() + 2
        );
    }

    #[test]
    fn all_rust_bootstrap_clients_apply_policy_at_the_final_link() {
        for fixture in [
            include_str!("../crates/sorng-browser-host/tests/native_acceptance/build.rs"),
            include_str!("../crates/sorng-browser-host/tests/native_tls_acceptance/build.rs"),
        ] {
            assert!(fixture.contains("#[path = \"../../../../native/cef_windows_delay_load.rs\"]"));
            assert!(fixture.contains("cef_windows_delay_load::configure(true)"));
            assert!(fixture
                .contains("cargo:rerun-if-changed=../../../../native/cef_windows_delay_load.rs"));
        }
        let app = include_str!("../build.rs");
        assert!(app.contains("#[path = \"native/cef_windows_delay_load.rs\"]"));
        assert!(app.contains("cef_windows_delay_load::configure(std::env::var_os(\"CARGO_FEATURE_NATIVE_BROWSER\").is_some())"));
        assert!(app.contains("cargo:rerun-if-changed=native/cef_windows_delay_load.rs"));
    }

    #[test]
    fn policy_is_unique_and_preserves_loader_core_imports() {
        let arguments = linker_arguments(true, "windows", "msvc").unwrap();
        assert_eq!(
            arguments.len(),
            arguments.iter().collect::<BTreeSet<_>>().len()
        );
        assert_eq!(arguments[1], "/IGNORE:4199");
        assert!(arguments[2..]
            .iter()
            .all(|arg| arg.starts_with("/DELAYLOAD:")));
        for eager in [
            "kernel32.dll",
            "ntdll.dll",
            "ucrtbase.dll",
            "vcruntime140.dll",
        ] {
            assert!(!arguments.contains(&format!("/DELAYLOAD:{eager}")));
        }
    }
}
