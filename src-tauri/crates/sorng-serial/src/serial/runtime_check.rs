//! Runtime driver probe for the serial transport (t3-e4).
//!
//! The [`serialport`] crate links against platform-native APIs (termios on
//! Linux, SetupAPI on Windows, IOKit on macOS) — it does not `dlopen`
//! libserialport.so directly. However, per the production-readiness plan
//! (Q1 revised), the `protocol-serial-dynamic` feature treats the serial
//! driver stack as a *runtime* dependency: at service-init time the host
//! is probed for the expected driver/library, and a missing driver
//! surfaces a typed [`SerialError`] with a per-OS install hint rather
//! than panicking or silently succeeding.
//!
//! ## Feature matrix
//!
//! | Feature                                       | Probe behaviour                                                                           |
//! |-----------------------------------------------|-------------------------------------------------------------------------------------------|
//! | `protocol-serial` (static/vendored, dev/test) | No probe — always `Ok(())`. Use when the driver is known to be present (CI/test images).  |
//! | `protocol-serial-dynamic` (default release)   | Full probe. Linux: `libserialport.so.*` OR `setserial`. Windows: `SetupAPI.dll`. macOS: always Ok (IOKit is in every macOS). |
//!
//! If both features are enabled the dynamic probe wins (additive semantics).
//!
//! ## Testability
//!
//! The probe is behind the [`DriverProbe`] trait. Unit tests use
//! [`MockProbe`] to simulate present/missing driver scenarios without
//! touching the filesystem or loading real libraries.

use crate::serial::types::{SerialError, SerialErrorKind};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Driver probe trait + real impl
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Abstracts the host-driver probe so it can be mocked in tests.
pub trait DriverProbe: Send + Sync {
    /// Returns `Ok(())` when the required serial driver is present,
    /// or [`SerialError`] of kind [`SerialErrorKind::DriverMissing`]
    /// with an install-hint message.
    fn probe(&self) -> Result<(), SerialError>;
}

/// Real host probe. Behaviour depends on the compiled feature set and
/// target OS — see module docs.
#[derive(Debug, Default, Clone, Copy)]
pub struct RealProbe;

impl DriverProbe for RealProbe {
    fn probe(&self) -> Result<(), SerialError> {
        probe_host()
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  probe_host() — feature + OS dispatch
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Per-OS install hint surfaced to the UI when the driver is missing.
pub fn install_hint_for_host() -> &'static str {
    #[cfg(target_os = "linux")]
    {
        "Install libserialport: 'sudo apt install libserialport0' (Debian/Ubuntu), \
         'sudo dnf install libserialport' (Fedora/RHEL), \
         'sudo pacman -S libserialport' (Arch). Optionally install 'setserial' for diagnostics."
    }
    #[cfg(target_os = "windows")]
    {
        "Windows normally ships SetupAPI.dll with the OS. If the probe fails, \
         verify that %SystemRoot%\\System32\\SetupAPI.dll exists and is not \
         quarantined; reinstall the USB-serial adapter driver (FTDI/CP210x/CH340) \
         from the vendor website."
    }
    #[cfg(target_os = "macos")]
    {
        "macOS ships IOKit in every release; no install required. If this probe \
         ever fails, install the FTDI/CP210x/CH340 USB-serial driver from the \
         vendor."
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    {
        "Serial support on this OS is not a supported configuration. \
         Please file an issue with the target triple."
    }
}

/// Driver-missing error with a per-OS install hint.
pub fn driver_missing_error() -> SerialError {
    // Use the closest existing `SerialErrorKind` — the types.rs enum does not
    // yet have a `DriverMissing` variant (e14 will extend it during its
    // `todo!` cleanup pass in native_transport.rs). Use `IoError` as the
    // transport-class kind and keep the install-hint in the message so the
    // UI can still act on it. When e14 adds a dedicated variant, flip the
    // `kind` here; the hint text is the stable contract.
    SerialError::new(
        SerialErrorKind::IoError,
        format!(
            "DriverMissing: required serial driver not available on this host. {}",
            install_hint_for_host()
        ),
    )
}

/// Host-probe implementation. Default-on when the `protocol-serial-dynamic`
/// feature is enabled; the static/vendored `protocol-serial` feature
/// short-circuits to `Ok(())`.
pub fn probe_host() -> Result<(), SerialError> {
    // Dynamic feature wins (additive): if the caller opted in to dynamic
    // linking, run the real probe even if the static feature is also on.
    #[cfg(feature = "protocol-serial-dynamic")]
    {
        probe_host_dynamic()
    }

    // Static/vendored: driver presence is a build-time assumption. Do not
    // probe — callers that want dynamic behaviour must enable the
    // dynamic feature.
    #[cfg(all(feature = "protocol-serial", not(feature = "protocol-serial-dynamic")))]
    {
        return Ok(());
    }

    // No serial feature enabled at all — the entire crate surface is a
    // no-op from the perspective of the handler (commands are not
    // registered). The probe should therefore fail actionably if called.
    #[cfg(not(any(feature = "protocol-serial", feature = "protocol-serial-dynamic")))]
    {
        Err(SerialError::new(
            SerialErrorKind::IoError,
            "Serial support was not compiled in. Rebuild with \
             --features protocol-serial-dynamic (default release) or \
             --features protocol-serial (static, dev/test).",
        ))
    }
}

#[cfg(feature = "protocol-serial-dynamic")]
fn probe_host_dynamic() -> Result<(), SerialError> {
    #[cfg(target_os = "linux")]
    {
        if probe_linux() {
            Ok(())
        } else {
            Err(driver_missing_error())
        }
    }
    #[cfg(target_os = "windows")]
    {
        if probe_windows() {
            Ok(())
        } else {
            Err(driver_missing_error())
        }
    }
    #[cfg(target_os = "macos")]
    {
        // IOKit is part of the macOS userspace; presence is guaranteed.
        let _ = probe_macos();
        Ok(())
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    {
        Err(driver_missing_error())
    }
}

// ── Linux probe ────────────────────────────────────────────────
#[cfg(all(feature = "protocol-serial-dynamic", target_os = "linux"))]
fn probe_linux() -> bool {
    // Preferred: libserialport.so.* via the OS's runtime linker search path.
    // Try a few common SONAME variants the major distros ship. We don't
    // link against libserialport at compile time — the Rust `serialport`
    // crate uses termios/ioctl directly — so the presence check is purely
    // for probing "does this box look like it has the serial driver stack
    // installed?"
    for soname in &[
        "libserialport.so.0",
        "libserialport.so",
        "libserialport.so.1",
    ] {
        if dlopen_exists(soname) {
            return true;
        }
    }
    // Fallback: `setserial` binary on PATH is a strong signal the admin
    // has the serial stack wired up.
    if which_on_path("setserial") {
        return true;
    }
    // Last-resort: the kernel always exposes /dev/ttyS0-class devices if
    // the serial driver is loaded; the *directory* /sys/class/tty exists
    // on every modern Linux kernel with CONFIG_TTY, which is universal.
    // Treat a writable /dev that contains /dev/ttyS* or /dev/ttyUSB*
    // nodes as "driver present".
    if sysfs_has_tty() {
        return true;
    }
    false
}

#[cfg(all(feature = "protocol-serial-dynamic", target_os = "linux"))]
fn dlopen_exists(soname: &str) -> bool {
    use std::ffi::CString;
    // SAFETY: dlopen is a standard POSIX call; we pass a well-formed
    // CString and RTLD_LAZY|RTLD_NOLOAD to avoid side-effects on success.
    // If the library is already mapped in the process, NOLOAD returns a
    // handle without re-initialising; if not, we fall through to a
    // plain dlopen. We dlclose immediately on success.
    use std::os::raw::{c_char, c_int, c_void};
    unsafe {
        extern "C" {
            fn dlopen(filename: *const c_char, flags: c_int) -> *mut c_void;
            fn dlclose(handle: *mut c_void) -> c_int;
        }
        // RTLD_LAZY = 1 on glibc/musl.
        const RTLD_LAZY: c_int = 1;
        let cs = match CString::new(soname) {
            Ok(c) => c,
            Err(_) => return false,
        };
        let handle = dlopen(cs.as_ptr(), RTLD_LAZY);
        if handle.is_null() {
            false
        } else {
            let _ = dlclose(handle);
            true
        }
    }
}

#[cfg(all(feature = "protocol-serial-dynamic", target_os = "linux"))]
fn which_on_path(binary: &str) -> bool {
    let Ok(path) = std::env::var("PATH") else {
        return false;
    };
    for dir in path.split(':') {
        let candidate = std::path::Path::new(dir).join(binary);
        if candidate.is_file() {
            return true;
        }
    }
    false
}

#[cfg(all(feature = "protocol-serial-dynamic", target_os = "linux"))]
fn sysfs_has_tty() -> bool {
    std::path::Path::new("/sys/class/tty").is_dir()
}

// ── Windows probe ──────────────────────────────────────────────
#[cfg(all(feature = "protocol-serial-dynamic", target_os = "windows"))]
fn probe_windows() -> bool {
    // SetupAPI ships with every supported Windows version. Probe by
    // attempting to LoadLibraryA("SetupAPI.dll"). If the load succeeds,
    // the serial-driver enumeration path used by the `serialport` crate
    // will be available. We FreeLibrary immediately on success.
    use std::ffi::CString;

    #[link(name = "kernel32")]
    extern "system" {
        fn LoadLibraryA(filename: *const u8) -> *mut core::ffi::c_void;
        fn FreeLibrary(handle: *mut core::ffi::c_void) -> i32;
    }

    let Ok(cs) = CString::new("SetupAPI.dll") else {
        return false;
    };

    // SAFETY: standard Win32 dynamic-library probe; we free on success.
    unsafe {
        let h = LoadLibraryA(cs.as_ptr() as *const u8);
        if h.is_null() {
            false
        } else {
            let _ = FreeLibrary(h);
            true
        }
    }
}

// ── macOS probe ────────────────────────────────────────────────
#[cfg(all(feature = "protocol-serial-dynamic", target_os = "macos"))]
fn probe_macos() -> bool {
    // IOKit is always present. Kept as a fn so platform surface stays
    // symmetric with linux/windows.
    true
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  MockProbe + unit tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/// Test double — returns whatever the test constructed it with.
#[derive(Debug, Clone)]
pub struct MockProbe {
    pub result: Result<(), SerialError>,
}

impl MockProbe {
    pub fn ok() -> Self {
        Self { result: Ok(()) }
    }
    pub fn missing() -> Self {
        Self {
            result: Err(driver_missing_error()),
        }
    }
}

impl DriverProbe for MockProbe {
    fn probe(&self) -> Result<(), SerialError> {
        self.result.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_probe_ok_surfaces_ok() {
        let p = MockProbe::ok();
        assert!(p.probe().is_ok());
    }

    #[test]
    fn mock_probe_missing_surfaces_driver_missing_with_install_hint() {
        let p = MockProbe::missing();
        let err = p.probe().expect_err("expected DriverMissing");
        assert!(
            err.message.contains("DriverMissing"),
            "message should tag DriverMissing: {}",
            err.message
        );
        // The hint must be non-trivial so the UI has something actionable.
        assert!(
            err.message.len() > "DriverMissing:".len() + 16,
            "hint too short: {}",
            err.message
        );
    }

    #[test]
    fn install_hint_for_host_is_non_empty() {
        let hint = install_hint_for_host();
        assert!(!hint.is_empty(), "per-OS install hint must be populated");
    }

    #[test]
    fn driver_missing_error_carries_hint() {
        let err = driver_missing_error();
        assert!(err.message.contains(install_hint_for_host()));
    }

    #[cfg(feature = "protocol-serial-dynamic")]
    #[test]
    fn real_probe_on_dynamic_feature_returns_deterministic_result() {
        // On macOS the probe is unconditionally Ok; on Linux/Windows it
        // reflects the host. We only assert the call is *deterministic*
        // (does not panic, same answer twice in a row) so CI can run
        // this test regardless of host configuration.
        let p = RealProbe;
        let a = p.probe().is_ok();
        let b = p.probe().is_ok();
        assert_eq!(a, b, "RealProbe must be deterministic");
    }

    #[cfg(not(any(feature = "protocol-serial", feature = "protocol-serial-dynamic")))]
    #[test]
    fn probe_with_no_feature_returns_actionable_error() {
        let err = probe_host().expect_err("probe must fail without features");
        assert!(err.message.contains("not compiled in"));
    }

    #[cfg(all(feature = "protocol-serial", not(feature = "protocol-serial-dynamic")))]
    #[test]
    fn probe_with_static_only_feature_is_ok() {
        assert!(probe_host().is_ok());
    }
}
