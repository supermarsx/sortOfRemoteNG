//! Native-only reveal. No shell interpretation, file execution, renderer path,
//! URL opening, or path-bearing error/log message is permitted here.
use std::path::Path;

pub(super) fn supported() -> bool {
    cfg!(any(
        target_os = "windows",
        target_os = "macos",
        target_os = "linux"
    ))
}

pub(super) fn reveal(path: &Path) -> Result<(), ()> {
    if !path.is_absolute() || path.as_os_str().len() > 32_768 {
        return Err(());
    }
    let metadata = std::fs::symlink_metadata(path).map_err(|_| ())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(());
    }
    platform_reveal(path)
}

#[cfg(target_os = "windows")]
fn platform_reveal(path: &Path) -> Result<(), ()> {
    use std::{ffi::c_void, os::windows::ffi::OsStrExt, ptr};
    #[link(name = "ole32")]
    unsafe extern "system" {
        fn CoInitializeEx(reserved: *const c_void, flags: u32) -> i32;
        fn CoUninitialize();
    }
    #[link(name = "shell32")]
    unsafe extern "system" {
        fn ILCreateFromPathW(path: *const u16) -> *mut c_void;
        fn ILFree(list: *mut c_void);
        fn SHOpenFolderAndSelectItems(
            folder: *const c_void,
            count: u32,
            children: *const *const c_void,
            flags: u32,
        ) -> i32;
    }
    let mut wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    if wide.contains(&0) {
        return Err(());
    }
    wide.push(0);
    // SAFETY: COM is balanced only when our initialization succeeded (S_FALSE
    // also needs balancing). RPC_E_CHANGED_MODE means COM already exists on
    // this thread. PIDL and its backing path stay live through the shell call.
    unsafe {
        let initialized = CoInitializeEx(ptr::null(), 2);
        if initialized < 0 && initialized != 0x80010106u32 as i32 {
            return Err(());
        }
        let pidl = ILCreateFromPathW(wide.as_ptr());
        let result = if pidl.is_null() {
            Err(())
        } else {
            // cidl=0 selects this exact item in its parent, never opens it.
            let result = SHOpenFolderAndSelectItems(pidl, 0, ptr::null(), 0);
            ILFree(pidl);
            if result >= 0 {
                Ok(())
            } else {
                Err(())
            }
        };
        if initialized >= 0 {
            CoUninitialize();
        }
        result
    }
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn platform_reveal(path: &Path) -> Result<(), ()> {
    use std::process::{Command, Stdio};
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("/usr/bin/open");
        command.arg("-R").arg(path);
        command
    };
    // xdg-open receives only an existing containing directory, never the file.
    // Some Linux file managers cannot select an individual file portably.
    #[cfg(target_os = "linux")]
    let mut command = {
        let parent = path.parent().ok_or(())?.canonicalize().map_err(|_| ())?;
        if !parent.is_dir() {
            return Err(());
        }
        let mut command = Command::new("/usr/bin/xdg-open");
        command.arg(parent);
        command
    };
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| ())?;
    // Reap without blocking CEF UI or exposing platform stderr (which can name
    // the private destination). The user explicitly requested this UI action.
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn platform_reveal(_path: &Path) -> Result<(), ()> {
    Err(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invalid_paths_fail_without_launching_anything() {
        assert!(supported());
        assert!(reveal(Path::new("relative.exe")).is_err());
        assert!(reveal(&std::env::temp_dir()).is_err());
    }
}
