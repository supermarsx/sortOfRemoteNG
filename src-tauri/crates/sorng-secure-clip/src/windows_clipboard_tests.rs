//! Real Win32 clipboard regression, isolated from the interactive clipboard.
//!
//! A desktop alone is insufficient: the clipboard belongs to its window station.
//! https://learn.microsoft.com/windows/win32/winstation/about-window-stations-and-desktops
//! Only the re-executed child changes station; the normal test runner never does.
//!
//! Opt in by selecting `windows_clipboard_roundtrip_in_isolated_window_station`
//! with `--ignored`. Named station creation needs permissions that an ordinary
//! Windows test account may not have. Permission failures are not clipboard proof;
//! the automatic hidden-window-owner test in engine.rs does not need this access.

use super::{read_os_clipboard, write_os_clipboard, ClipEngine};
use crate::types::{ClearReason, CopyRequest, SecretKind, SecureClipConfig};
use std::mem::size_of;
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};
use std::ptr::null;
use std::time::{Duration, Instant};
use windows_sys::Win32::Foundation::{GENERIC_ALL, HANDLE};
use windows_sys::Win32::System::DataExchange::IsClipboardFormatAvailable;
use windows_sys::Win32::System::StationsAndDesktops::{
    CloseDesktop, CloseWindowStation, CreateDesktopW, CreateWindowStationW,
    GetProcessWindowStation, GetThreadDesktop, GetUserObjectInformationW, SetProcessWindowStation,
    SetThreadDesktop, HDESK, HWINSTA, UOI_FLAGS, UOI_NAME, USEROBJECTFLAGS,
};
use windows_sys::Win32::System::Threading::{GetCurrentThreadId, CREATE_NO_WINDOW};
use windows_sys::Win32::UI::WindowsAndMessaging::{CWF_CREATE_ONLY, WSF_VISIBLE};

const CHILD_TEST: &str = "engine::windows_clipboard_tests::isolated_windows_clipboard_child";
const CHILD_ENV: &str = "SORNG_SECURE_CLIP_ISOLATED_WINDOWS_CHILD";
const SUCCESS_MARKER: &str = "ISOLATED_WINDOWS_CLIPBOARD_ROUNDTRIP_OK";
const CF_UNICODETEXT: u32 = 13;

#[test]
#[ignore = "opt-in: requires permission to create a private Win32 window station; select this roundtrip with --ignored; no interactive clipboard fallback"]
fn windows_clipboard_roundtrip_in_isolated_window_station() {
    // Do not open, inspect, save or restore the interactive clipboard. Even
    // reading it would expose user data and cannot faithfully preserve all formats.
    let mut child = Command::new(std::env::current_exe().expect("test executable"))
        .args([
            "--exact",
            CHILD_TEST,
            "--ignored",
            "--nocapture",
            "--test-threads=1",
        ])
        .env(CHILD_ENV, std::process::id().to_string())
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn isolated clipboard test child");
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(10));
            }
            result => {
                // This is our exact owned child, never cargo or an app process.
                let _ = child.kill();
                let _ = child.wait();
                panic!("isolated clipboard child timed out or could not be polled: {result:?}");
            }
        }
    }
    let output = child
        .wait_with_output()
        .expect("collect clipboard child result");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        output.status.success() && stdout.contains(SUCCESS_MARKER),
        "isolated clipboard child failed ({}); no interactive clipboard fallback\n{stdout}\n{stderr}",
        output.status
    );
}

#[test]
#[ignore = "child fixture: run via windows_clipboard_roundtrip_in_isolated_window_station"]
fn isolated_windows_clipboard_child() {
    // Fail closed if accidentally selected by `cargo test --ignored`. Checking
    // the exact harness selection prevents station changes in a parallel suite.
    let parent_pid = std::env::var(CHILD_ENV)
        .expect("only the isolated parent test may launch this fixture")
        .parse::<u32>()
        .expect("parent PID");
    assert_ne!(parent_pid, std::process::id());
    let args: Vec<_> = std::env::args().collect();
    assert!(args.windows(2).any(|pair| pair == ["--exact", CHILD_TEST]));
    assert!(args.iter().any(|arg| arg == "--test-threads=1"));
    assert!(args.iter().any(|arg| arg == "--ignored"));

    let isolation = IsolatedStation::new();
    isolation.assert_current();
    // Prove a new empty clipboard before writing anything. There is deliberately
    // no fallback when station creation, desktop attachment or verification fails.
    assert_eq!(unsafe { IsClipboardFormatAvailable(CF_UNICODETEXT) }, 0);

    for value in [
        "synthetic clipboard text",
        "synthetic \u{1f510} caf\u{e9} \u{79d8}\u{5bc6}\r\nsecond line",
    ] {
        isolation.assert_current();
        write_os_clipboard(value).expect("real Win32 write with a non-null window owner");
        // The write's owner/guard has already dropped: reading must still work.
        assert_eq!(read_os_clipboard().expect("real Win32 Unicode read"), value);
    }

    // Exercise actual engine ownership checks and clear, not only raw helpers.
    let mut engine = ClipEngine::new();
    let request = CopyRequest {
        value: "synthetic secure value \u{1f511}".to_string(),
        kind: SecretKind::Password,
        label: None,
        connection_id: None,
        field: None,
        clear_after_secs: Some(300),
        max_pastes: None,
        one_time: false,
    };
    let config = SecureClipConfig::default();
    isolation.assert_current();
    engine
        .copy(&request, &config)
        .expect("engine copy to real clipboard");
    assert_eq!(
        read_os_clipboard().expect("read engine copy"),
        request.value
    );
    assert!(
        engine
            .clear(ClearReason::ManualClear)
            .expect("clear owned clipboard")
            .unwrap()
            .cleared
    );
    assert!(engine.current_entry().is_none());
    assert_eq!(unsafe { IsClipboardFormatAvailable(CF_UNICODETEXT) }, 0);
    assert!(
        read_os_clipboard().is_err(),
        "cleared clipboard must not retain text"
    );

    isolation.assert_current();
    engine.copy(&request, &config).expect("second engine copy");
    write_os_clipboard("synthetic replacement from another application")
        .expect("replace clipboard");
    engine
        .clear(ClearReason::ManualClear)
        .expect("clear stale secure entry");
    assert_eq!(
        read_os_clipboard().expect("preserved replacement"),
        "synthetic replacement from another application"
    );
    assert!(engine.current_entry().is_none());
    write_os_clipboard("").expect("clear isolated fixture data");
    assert_eq!(unsafe { IsClipboardFormatAvailable(CF_UNICODETEXT) }, 0);

    isolation.assert_current();
    drop(isolation);
    println!("{SUCCESS_MARKER}");
}

/// All handles are confined to this child thread. No SwitchDesktop or visible
/// window is used, and no clipboard function runs until assert_current succeeds.
struct IsolatedStation {
    previous_station: HWINSTA,
    previous_desktop: HDESK,
    station: HWINSTA,
    desktop: HDESK,
    name: String,
}

impl IsolatedStation {
    fn new() -> Self {
        // SAFETY: these borrowed handles are retained, not closed, and used only
        // to detach from our disposable station during cleanup.
        let previous_station = unsafe { GetProcessWindowStation() };
        let previous_desktop = unsafe { GetThreadDesktop(GetCurrentThreadId()) };
        assert!(!previous_station.is_null() && !previous_desktop.is_null());
        let name = format!(
            "sorng-clip-test-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        );
        let encoded: Vec<_> = name.encode_utf16().chain(Some(0)).collect();
        // CWF_CREATE_ONLY forbids opening an existing station, including a
        // same-name collision. Creation/permission errors must fail, not skip.
        // Do not fall back to a NULL name without CWF_CREATE_ONLY: its logon-
        // derived station can already exist and have another process's clipboard.
        let station =
            unsafe { CreateWindowStationW(encoded.as_ptr(), CWF_CREATE_ONLY, GENERIC_ALL, null()) };
        assert!(
            !station.is_null(),
            "create private station: {}",
            std::io::Error::last_os_error()
        );
        let mut isolation = Self {
            previous_station,
            previous_desktop,
            station,
            desktop: std::ptr::null_mut(),
            name,
        };
        // SAFETY: only this explicitly selected subprocess changes its station.
        assert_ne!(
            unsafe { SetProcessWindowStation(station) },
            0,
            "attach private station: {}",
            std::io::Error::last_os_error()
        );
        isolation.desktop = unsafe {
            CreateDesktopW(
                windows_sys::core::w!("sorng-clip-test-desktop"),
                null(),
                null(),
                0,
                GENERIC_ALL,
                null(),
            )
        };
        assert!(
            !isolation.desktop.is_null(),
            "create private desktop: {}",
            std::io::Error::last_os_error()
        );
        assert_ne!(
            unsafe { SetThreadDesktop(isolation.desktop) },
            0,
            "attach private desktop: {}",
            std::io::Error::last_os_error()
        );
        isolation.assert_current();
        isolation
    }

    fn assert_current(&self) {
        // SAFETY: owned station/desktop remain alive through all clipboard calls.
        unsafe {
            let current = GetProcessWindowStation();
            assert_eq!(current, self.station);
            assert_ne!(current, self.previous_station);
            assert_eq!(object_name(current), self.name);
            assert!(!self.name.eq_ignore_ascii_case("WinSta0"));
            let mut flags = USEROBJECTFLAGS::default();
            assert_ne!(
                GetUserObjectInformationW(
                    current,
                    UOI_FLAGS,
                    (&mut flags as *mut USEROBJECTFLAGS).cast(),
                    size_of::<USEROBJECTFLAGS>() as u32,
                    std::ptr::null_mut(),
                ),
                0,
                "query station flags: {}",
                std::io::Error::last_os_error()
            );
            assert_eq!(
                flags.dwFlags & WSF_VISIBLE as u32,
                0,
                "station must be noninteractive"
            );
            assert_eq!(GetThreadDesktop(GetCurrentThreadId()), self.desktop);
            assert_ne!(self.desktop, self.previous_desktop);
        }
    }
}

impl Drop for IsolatedStation {
    fn drop(&mut self) {
        // SAFETY: no clipboard calls occur after detachment. Best-effort cleanup
        // also runs on assertion failures; child exit releases any residual handles.
        unsafe {
            SetProcessWindowStation(self.previous_station);
            SetThreadDesktop(self.previous_desktop);
            if !self.desktop.is_null() {
                CloseDesktop(self.desktop);
            }
            CloseWindowStation(self.station);
        }
    }
}

fn object_name(handle: HANDLE) -> String {
    let mut buffer = [0u16; 256];
    // SAFETY: Win32 receives a valid, bounded UTF-16 output buffer.
    assert_ne!(
        unsafe {
            GetUserObjectInformationW(
                handle,
                UOI_NAME,
                buffer.as_mut_ptr().cast(),
                size_of::<[u16; 256]>() as u32,
                std::ptr::null_mut(),
            )
        },
        0,
        "query station name: {}",
        std::io::Error::last_os_error()
    );
    let end = buffer
        .iter()
        .position(|unit| *unit == 0)
        .expect("terminated station name");
    String::from_utf16(&buffer[..end]).expect("station name UTF-16")
}
