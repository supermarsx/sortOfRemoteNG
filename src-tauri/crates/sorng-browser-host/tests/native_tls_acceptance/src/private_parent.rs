//! Fixture-only parent visibility, never focus, on an attested non-input desktop.
#[cfg(any(target_os = "windows", test))]
use serde_json::{json, Value};

#[cfg(any(target_os = "windows", test))]
const SHOW_FLAGS: u32 = 0x0040 | 0x0010 | 0x0004 | 0x0002 | 0x0001;

#[cfg(any(target_os = "windows", test))]
#[derive(Clone, Debug, PartialEq, Eq)]
struct Snapshot {
    station: String,
    startup_desktop: String,
    thread_desktop: String,
    window_desktop: String,
    input_query_ok: bool,
    input_query_bytes: u32,
    receives_input: i32,
    current_pid: u32,
    current_thread: u32,
    window_pid: u32,
    window_thread: u32,
    top_level: bool,
    visible: bool,
}
#[cfg(any(target_os = "windows", test))]
trait Api {
    fn snapshot(&self, window: isize) -> Result<Snapshot, &'static str>;
    fn show_without_activation(&self, window: isize, flags: u32) -> Result<(), &'static str>;
}
#[cfg(any(target_os = "windows", test))]
fn validate_non_input(ok: bool, bytes: u32, value: i32) -> Result<(), &'static str> {
    if !ok {
        return Err("private-parent-input-query-failed");
    }
    if bytes != 4 {
        return Err("private-parent-input-query-size");
    }
    match value {
        0 => Ok(()),
        1 => Err("private-parent-desktop-receives-input"),
        _ => Err("private-parent-input-query-unknown"),
    }
}
#[cfg(any(target_os = "windows", test))]
fn validate(facts: &Snapshot) -> Result<(), &'static str> {
    let Some(token) = facts.thread_desktop.strip_prefix("sorng-acceptance-") else {
        return Err("private-parent-desktop-name");
    };
    if token.len() != 16
        || !token
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("private-parent-desktop-name");
    }
    if !facts.station.eq_ignore_ascii_case("WinSta0")
        || facts.startup_desktop != format!("{}\\{}", facts.station, facts.thread_desktop)
        || facts.window_desktop != facts.thread_desktop
    {
        return Err("private-parent-desktop-binding");
    }
    validate_non_input(
        facts.input_query_ok,
        facts.input_query_bytes,
        facts.receives_input,
    )?;
    if facts.current_pid == 0
        || facts.current_thread == 0
        || facts.current_pid != facts.window_pid
        || facts.current_thread != facts.window_thread
        || !facts.top_level
    {
        return Err("private-parent-window-owner");
    }
    Ok(())
}
#[cfg(any(target_os = "windows", test))]
fn same_parent(before: &Snapshot, current: &Snapshot) -> bool {
    before.station == current.station
        && before.startup_desktop == current.startup_desktop
        && before.thread_desktop == current.thread_desktop
        && before.window_desktop == current.window_desktop
        && before.current_pid == current.current_pid
        && before.current_thread == current.current_thread
        && before.window_pid == current.window_pid
        && before.window_thread == current.window_thread
}
#[cfg(any(target_os = "windows", test))]
fn present(api: &impl Api, window: isize) -> Result<Value, &'static str> {
    if window == 0 {
        return Err("private-parent-window-unavailable");
    }
    let initial = api.snapshot(window)?;
    validate(&initial)?;
    if initial.visible {
        return Err("private-parent-already-visible");
    }
    // Re-attest the actual OS state immediately before the only visibility call.
    let before = api.snapshot(window)?;
    validate(&before)?;
    if !same_parent(&initial, &before) || before.visible {
        return Err("private-parent-before-show-changed");
    }
    api.show_without_activation(window, SHOW_FLAGS)?;
    let after = api.snapshot(window)?;
    validate(&after)?;
    if !same_parent(&before, &after) || !after.visible {
        return Err("private-parent-after-show-changed");
    }
    Ok(
        json!({"privateDesktopAttested":true,"ownedDesktopInputQuerySucceeded":true,"ownedDesktopReceivesInput":false,
        "ownUiThreadWindow":true,"parentPreviouslyVisible":false,"parentVisible":true,
        "noActivate":true,"noZorder":true,"desktopSwitchRequested":false,"focusRequested":false}),
    )
}

#[cfg(any(target_os = "windows", test))]
const USER32_SYMBOLS: [&[u8]; 6] = [
    b"GetThreadDesktop\0",
    b"GetProcessWindowStation\0",
    b"GetUserObjectInformationW\0",
    b"GetWindowThreadProcessId\0",
    b"GetAncestor\0",
    b"IsWindowVisible\0",
];
#[cfg(any(target_os = "windows", test))]
const SHOW_SYMBOL: &[u8] = b"SetWindowPos\0";
#[cfg(any(target_os = "windows", test))]
fn checked_symbols(
    module: &str,
    system: &str,
    mut resolve: impl FnMut(&[u8]) -> Option<usize>,
) -> Result<[usize; 7], &'static str> {
    if module.is_empty()
        || system.is_empty()
        || module.len() > 1024
        || system.len() > 1024
        || module.chars().any(char::is_control)
        || system.chars().any(char::is_control)
        || !module.replace('/', "\\").eq_ignore_ascii_case(
            &format!("{}\\user32.dll", system.trim_end_matches(['\\', '/'])).replace('/', "\\"),
        )
    {
        return Err("private-parent-system-module-binding");
    }
    let mut addresses = [0; 7];
    for (index, name) in USER32_SYMBOLS
        .iter()
        .copied()
        .chain([SHOW_SYMBOL])
        .enumerate()
    {
        addresses[index] = resolve(name)
            .filter(|address| *address != 0)
            .ok_or("private-parent-symbol-unavailable")?;
    }
    Ok(addresses)
}
#[cfg(target_os = "windows")]
mod windows {
    use super::*;
    use std::ffi::{c_char, c_void};
    #[repr(C)]
    struct StartupInfo {
        cb: u32,
        reserved: *mut u16,
        desktop: *mut u16,
        title: *mut u16,
        x: u32,
        y: u32,
        x_size: u32,
        y_size: u32,
        x_chars: u32,
        y_chars: u32,
        fill: u32,
        flags: u32,
        show: u16,
        reserved_count: u16,
        reserved_bytes: *mut u8,
        input: isize,
        output: isize,
        error: isize,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentThreadId() -> u32;
        fn GetCurrentProcessId() -> u32;
        fn GetStartupInfoW(info: *mut StartupInfo);
        fn GetModuleHandleW(name: *const u16) -> *mut c_void;
        fn GetModuleFileNameW(module: *mut c_void, output: *mut u16, capacity: u32) -> u32;
        fn GetSystemDirectoryW(output: *mut u16, capacity: u32) -> u32;
        fn GetProcAddress(module: *mut c_void, name: *const c_char) -> *mut c_void;
    }
    type ThreadDesktop = unsafe extern "system" fn(u32) -> isize;
    type ProcessStation = unsafe extern "system" fn() -> isize;
    type ObjectInfo = unsafe extern "system" fn(isize, i32, *mut c_void, u32, *mut u32) -> i32;
    type WindowOwner = unsafe extern "system" fn(isize, *mut u32) -> u32;
    type Ancestor = unsafe extern "system" fn(isize, u32) -> isize;
    type Visible = unsafe extern "system" fn(isize) -> i32;
    type Position = unsafe extern "system" fn(isize, isize, i32, i32, i32, i32, u32) -> i32;
    pub(super) struct Native {
        thread_desktop: ThreadDesktop,
        process_station: ProcessStation,
        object_info: ObjectInfo,
        window_owner: WindowOwner,
        ancestor: Ancestor,
        visible: Visible,
        position: Position,
    }
    impl Native {
        pub(super) fn new() -> Result<Self, &'static str> {
            let name: Vec<u16> = "user32.dll\0".encode_utf16().collect();
            // Already loaded by Tao; never LoadLibrary, search, or fall back.
            let module = unsafe { GetModuleHandleW(name.as_ptr()) };
            if module.is_null() {
                return Err("private-parent-module-unavailable");
            }
            let mut path = [0u16; 512];
            let mut system = [0u16; 512];
            let path_len = unsafe { GetModuleFileNameW(module, path.as_mut_ptr(), 512) } as usize;
            let system_len = unsafe { GetSystemDirectoryW(system.as_mut_ptr(), 512) } as usize;
            if path_len == 0
                || path_len >= 512
                || system_len == 0
                || system_len >= 512
                || path[path_len] != 0
                || system[system_len] != 0
            {
                return Err("private-parent-module-path-bound");
            }
            let path = String::from_utf16(&path[..path_len])
                .map_err(|_| "private-parent-module-path-encoding")?;
            let system = String::from_utf16(&system[..system_len])
                .map_err(|_| "private-parent-module-path-encoding")?;
            let addresses = checked_symbols(&path, &system, |name| {
                let address = unsafe { GetProcAddress(module, name.as_ptr().cast()) };
                (!address.is_null()).then_some(address as usize)
            })?;
            // Each address came from one fixed export of the verified loaded System32 module.
            // Types are the exact Win32 WINAPI (extern system) signatures.
            Ok(Self {
                thread_desktop: unsafe {
                    std::mem::transmute::<usize, ThreadDesktop>(addresses[0])
                },
                process_station: unsafe {
                    std::mem::transmute::<usize, ProcessStation>(addresses[1])
                },
                object_info: unsafe { std::mem::transmute::<usize, ObjectInfo>(addresses[2]) },
                window_owner: unsafe { std::mem::transmute::<usize, WindowOwner>(addresses[3]) },
                ancestor: unsafe { std::mem::transmute::<usize, Ancestor>(addresses[4]) },
                visible: unsafe { std::mem::transmute::<usize, Visible>(addresses[5]) },
                position: unsafe { std::mem::transmute::<usize, Position>(addresses[6]) },
            })
        }
        fn object_name(&self, handle: isize) -> Result<String, &'static str> {
            if handle == 0 {
                return Err("private-parent-object-unavailable");
            }
            let mut buffer = [0u16; 256];
            let mut needed = 0;
            let ok = unsafe {
                (self.object_info)(handle, 2, buffer.as_mut_ptr().cast(), 512, &mut needed)
            };
            if ok == 0 || !(2..=512).contains(&needed) || needed % 2 != 0 {
                return Err("private-parent-object-name-unavailable");
            }
            let end = buffer[..needed as usize / 2]
                .iter()
                .position(|v| *v == 0)
                .ok_or("private-parent-object-name-bound")?;
            if end == 0 {
                return Err("private-parent-object-name-bound");
            }
            String::from_utf16(&buffer[..end]).map_err(|_| "private-parent-object-name-encoding")
        }
    }
    fn startup_desktop() -> Result<String, &'static str> {
        // GetStartupInfoW returns process-lifetime OS-owned strings.
        let mut info: StartupInfo = unsafe { std::mem::zeroed() };
        info.cb = std::mem::size_of::<StartupInfo>() as u32;
        unsafe {
            GetStartupInfoW(&mut info);
        }
        if info.desktop.is_null() {
            return Err("private-parent-startup-unavailable");
        }
        let mut buffer = Vec::with_capacity(64);
        for index in 0..256 {
            let value = unsafe { *info.desktop.add(index) };
            if value == 0 {
                if buffer.is_empty() {
                    return Err("private-parent-startup-bound");
                }
                return String::from_utf16(&buffer).map_err(|_| "private-parent-startup-encoding");
            }
            buffer.push(value);
        }
        Err("private-parent-startup-bound")
    }
    impl Api for Native {
        fn snapshot(&self, window: isize) -> Result<Snapshot, &'static str> {
            let current_thread = unsafe { GetCurrentThreadId() };
            let current_pid = unsafe { GetCurrentProcessId() };
            let mut window_pid = 0;
            let window_thread = unsafe { (self.window_owner)(window, &mut window_pid) };
            if window_thread == 0 || window_thread != current_thread || window_pid != current_pid {
                return Err("private-parent-window-owner");
            }
            let station = self
                .object_name(unsafe { (self.process_station)() })
                .map_err(|_| "private-parent-station-metadata-unavailable")?;
            let desktop = unsafe { (self.thread_desktop)(current_thread) };
            let thread_desktop = self
                .object_name(desktop)
                .map_err(|_| "private-parent-thread-desktop-metadata-unavailable")?;
            let window_desktop = self
                .object_name(unsafe { (self.thread_desktop)(window_thread) })
                .map_err(|_| "private-parent-window-desktop-metadata-unavailable")?;
            // Documented UOI_IO queries ONLY our already-owned desktop. It is the
            // sole non-input check, never a fallback from opening another desktop.
            let mut receives_input = i32::MIN;
            let mut input_query_bytes = 0;
            let input_query_ok = unsafe {
                (self.object_info)(
                    desktop,
                    6,
                    (&mut receives_input as *mut i32).cast(),
                    4,
                    &mut input_query_bytes,
                )
            } != 0;
            Ok(Snapshot {
                station,
                startup_desktop: startup_desktop()?,
                thread_desktop,
                window_desktop,
                input_query_ok,
                input_query_bytes,
                receives_input,
                current_pid,
                current_thread,
                window_pid,
                window_thread,
                top_level: unsafe { (self.ancestor)(window, 2) == window },
                visible: unsafe { (self.visible)(window) != 0 },
            })
        }
        fn show_without_activation(&self, window: isize, flags: u32) -> Result<(), &'static str> {
            if flags != SHOW_FLAGS {
                return Err("private-parent-show-policy");
            }
            if unsafe { (self.position)(window, 0, 0, 0, 0, 0, flags) } == 0 {
                return Err("private-parent-show-failed");
            }
            Ok(())
        }
    }
}
#[cfg(target_os = "windows")]
pub fn show(window: &tao::window::Window) -> Result<Value, &'static str> {
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    let handle = window
        .window_handle()
        .map_err(|_| "private-parent-handle-unavailable")?;
    let RawWindowHandle::Win32(handle) = handle.as_raw() else {
        return Err("private-parent-handle-kind");
    };
    present(&windows::Native::new()?, handle.hwnd.get())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::VecDeque;
    struct Mock {
        snapshots: RefCell<VecDeque<Result<Snapshot, &'static str>>>,
        calls: RefCell<Vec<&'static str>>,
        flags: RefCell<Vec<u32>>,
    }
    impl Api for Mock {
        fn snapshot(&self, _: isize) -> Result<Snapshot, &'static str> {
            self.calls.borrow_mut().push("snapshot");
            self.snapshots.borrow_mut().pop_front().unwrap()
        }
        fn show_without_activation(&self, _: isize, flags: u32) -> Result<(), &'static str> {
            self.calls.borrow_mut().push("show");
            self.flags.borrow_mut().push(flags);
            Ok(())
        }
    }
    fn facts() -> Snapshot {
        Snapshot {
            station: "WinSta0".into(),
            startup_desktop: "WinSta0\\sorng-acceptance-0123456789abcdef".into(),
            thread_desktop: "sorng-acceptance-0123456789abcdef".into(),
            window_desktop: "sorng-acceptance-0123456789abcdef".into(),
            input_query_ok: true,
            input_query_bytes: 4,
            receives_input: 0,
            current_pid: 10,
            current_thread: 20,
            window_pid: 10,
            window_thread: 20,
            top_level: true,
            visible: false,
        }
    }
    fn mock(rows: Vec<Result<Snapshot, &'static str>>) -> Mock {
        Mock {
            snapshots: RefCell::new(rows.into()),
            calls: RefCell::new(vec![]),
            flags: RefCell::new(vec![]),
        }
    }
    #[test]
    fn attestation_twice_precedes_exact_nonactivating_show_then_rechecks() {
        let mut after = facts();
        after.visible = true;
        let api = mock(vec![Ok(facts()), Ok(facts()), Ok(after)]);
        let report = present(&api, 1).unwrap();
        assert_eq!(
            *api.calls.borrow(),
            vec!["snapshot", "snapshot", "show", "snapshot"]
        );
        assert_eq!(*api.flags.borrow(), vec![0x57]);
        let text = report.to_string();
        assert!(
            !text.contains("0123456789abcdef")
                && !text.contains("WinSta0")
                && !text.contains("Default")
        );
        assert_eq!(report["parentVisible"], true);
        assert_eq!(report["focusRequested"], false);
    }
    #[test]
    fn foreign_interactive_unavailable_and_changed_bindings_never_show() {
        for scenario in [
            "input",
            "prefix",
            "startup",
            "foreign-pid",
            "foreign-thread",
            "desktop",
            "station",
            "not-top",
            "already-visible",
        ] {
            let mut wrong = facts();
            match scenario {
                "input" => wrong.receives_input = 1,
                "prefix" => wrong.thread_desktop = "unreviewed-private".into(),
                "startup" => wrong.startup_desktop = "WinSta0\\Default".into(),
                "foreign-pid" => wrong.window_pid += 1,
                "foreign-thread" => wrong.window_thread += 1,
                "desktop" => wrong.window_desktop = "other".into(),
                "station" => wrong.station = "foreign".into(),
                "not-top" => wrong.top_level = false,
                "already-visible" => wrong.visible = true,
                _ => unreachable!(),
            }
            let api = mock(vec![Ok(wrong)]);
            assert!(present(&api, 1).is_err(), "{scenario}");
            assert!(api.flags.borrow().is_empty());
        }
        let api = mock(vec![Err("private-parent-object-unavailable")]);
        assert!(present(&api, 1).is_err());
        assert!(api.flags.borrow().is_empty());
        let mut changed = facts();
        changed.current_pid = 30;
        changed.window_pid = 30;
        let api = mock(vec![Ok(facts()), Ok(changed)]);
        assert!(present(&api, 1).is_err());
        assert!(api.flags.borrow().is_empty());
    }
    #[test]
    fn after_show_loss_of_isolation_or_visibility_fails_closed() {
        for active in [true, false] {
            let mut after = facts();
            after.visible = active;
            if active {
                after.receives_input = 1;
            }
            let api = mock(vec![Ok(facts()), Ok(facts()), Ok(after)]);
            assert!(present(&api, 1).is_err());
            assert_eq!(api.flags.borrow().len(), 1);
        }
        let api = mock(vec![]);
        assert!(present(&api, 0).is_err());
        assert!(api.calls.borrow().is_empty());
    }
    #[test]
    fn only_verified_system_user32_and_exact_seven_symbols_are_admitted() {
        let seen = RefCell::new(Vec::new());
        let addresses = checked_symbols(
            r"C:\WINDOWS\system32\USER32.DLL",
            r"c:\windows\System32",
            |name| {
                seen.borrow_mut().push(name.to_vec());
                Some(1)
            },
        )
        .unwrap();
        assert_eq!(addresses, [1; 7]);
        assert_eq!(
            *seen.borrow(),
            USER32_SYMBOLS
                .iter()
                .copied()
                .chain([SHOW_SYMBOL])
                .map(|s| s.to_vec())
                .collect::<Vec<_>>()
        );
        for module in [
            r"C:\application\user32.dll",
            r"C:\Windows\System32\other.dll",
            "",
            "C:\\Windows\\System32\\user32.dll\n",
        ] {
            let mut calls = 0;
            assert!(checked_symbols(module, r"C:\Windows\System32", |_| {
                calls += 1;
                Some(1)
            })
            .is_err());
            assert_eq!(calls, 0);
        }
        let mut calls = 0;
        assert!(checked_symbols(
            r"C:\Windows\System32\user32.dll",
            r"C:\Windows\System32",
            |_| {
                calls += 1;
                None
            }
        )
        .is_err());
        assert_eq!(calls, 1);
        assert!(checked_symbols(
            r"C:\Windows\System32\user32.dll",
            r"C:\Windows\System32",
            |_| Some(0)
        )
        .is_err());
    }
    #[test]
    fn owned_desktop_query_requires_exact_successful_false_and_rechecks_changes() {
        assert!(validate_non_input(true, 4, 0).is_ok());
        for (ok, bytes, value) in [
            (false, 4, 0),
            (true, 0, 0),
            (true, 8, 0),
            (true, 4, 1),
            (true, 4, -1),
            (true, 4, 2),
        ] {
            assert!(validate_non_input(ok, bytes, value).is_err());
            let mut failed = facts();
            failed.input_query_ok = ok;
            failed.input_query_bytes = bytes;
            failed.receives_input = value;
            let api = mock(vec![Ok(failed)]);
            assert!(present(&api, 1).is_err());
            assert!(api.flags.borrow().is_empty());
        }
        let mut changed = facts();
        changed.receives_input = 1;
        let api = mock(vec![Ok(facts()), Ok(changed)]);
        assert!(present(&api, 1).is_err());
        assert!(api.flags.borrow().is_empty());
        let api = mock(vec![Ok(facts()), Err("private-parent-input-query-failed")]);
        assert!(present(&api, 1).is_err());
        assert!(api.flags.borrow().is_empty());
    }
}
