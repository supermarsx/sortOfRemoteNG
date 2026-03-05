//! Mode detection and drive information.
//!
//! Detects whether the application should run in portable or installed mode
//! by looking for a `.portable` marker file next to the executable.

use std::path::Path;

use crate::types::{DriveInfo, PortableMode};

/// Detect the operating mode by checking for a portable marker file
/// in the given executable directory.
///
/// If `<exe_dir>/.portable` exists, returns [`PortableMode::Portable`];
/// otherwise returns [`PortableMode::Installed`].
pub fn detect_mode(exe_dir: &str) -> PortableMode {
    let marker_path = Path::new(exe_dir).join(".portable");
    if marker_path.exists() {
        log::info!("Portable marker found at {:?} — running in portable mode", marker_path);
        PortableMode::Portable
    } else {
        log::debug!("No portable marker at {:?} — running in installed mode", marker_path);
        PortableMode::Installed
    }
}

/// Check whether the given path resides on a removable drive.
///
/// This is a simplified cross-platform stub. On non-Windows platforms it
/// always returns `false`. A full implementation would use platform APIs
/// (e.g. `GetDriveTypeW` on Windows) to query the drive type.
pub fn is_removable_drive(path: &str) -> bool {
    // On Windows we could use GetDriveTypeW, but for portability and
    // safety we return false unless we can positively identify a
    // removable drive.
    let _ = path;

    #[cfg(target_os = "windows")]
    {
        // Extract the drive root (e.g. "C:\\")
        if let Some(root) = extract_drive_root(path) {
            // In a real implementation:
            // unsafe { winapi::um::fileapi::GetDriveTypeW(...) == DRIVE_REMOVABLE }
            // For now, return false as a safe default.
            let _ = root;
        }
    }

    false
}

/// Get information about the drive hosting the given path.
///
/// Returns `None` if the information cannot be determined.
/// This is a simplified implementation that uses `std::fs` metadata
/// where possible and returns stub values for fields that require
/// platform-specific APIs.
pub fn get_drive_info(path: &str) -> Option<DriveInfo> {
    let p = Path::new(path);
    if !p.exists() {
        return None;
    }

    // Basic drive info with safe defaults
    Some(DriveInfo {
        label: extract_drive_root(path).unwrap_or_default(),
        total_bytes: 0, // Would need platform API (GetDiskFreeSpaceExW, statvfs)
        free_bytes: 0,  // Same as above
        is_removable: is_removable_drive(path),
        filesystem_type: "unknown".to_string(),
    })
}

/// Extract the drive root from a path (e.g. `C:\foo\bar` → `C:\`).
///
/// Returns `None` for relative paths or paths without a drive letter.
fn extract_drive_root(path: &str) -> Option<String> {
    let p = Path::new(path);

    // On Windows, paths like "C:\..." have a prefix component
    if cfg!(windows) {
        let path_str = p.to_string_lossy();
        if path_str.len() >= 3 {
            let first = path_str.as_bytes().first().copied().unwrap_or(0);
            let second = path_str.as_bytes().get(1).copied().unwrap_or(0);
            let third = path_str.as_bytes().get(2).copied().unwrap_or(0);
            if first.is_ascii_alphabetic() && second == b':' && (third == b'\\' || third == b'/') {
                return Some(format!("{}:\\", first as char));
            }
        }
    }

    // Fallback: use the root component
    p.components()
        .next()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn detect_mode_portable() {
        let temp = std::env::temp_dir().join("sorng_test_portable_detect");
        let _ = fs::create_dir_all(&temp);
        let marker = temp.join(".portable");
        fs::write(&marker, "").unwrap();

        let mode = detect_mode(temp.to_str().unwrap());
        assert_eq!(mode, PortableMode::Portable);

        // Cleanup
        let _ = fs::remove_file(&marker);
        let _ = fs::remove_dir(&temp);
    }

    #[test]
    fn detect_mode_installed() {
        let temp = std::env::temp_dir().join("sorng_test_installed_detect");
        let _ = fs::create_dir_all(&temp);
        // No marker file

        let mode = detect_mode(temp.to_str().unwrap());
        assert_eq!(mode, PortableMode::Installed);

        // Cleanup
        let _ = fs::remove_dir(&temp);
    }

    #[test]
    fn is_removable_always_false_stub() {
        assert!(!is_removable_drive("C:\\"));
        assert!(!is_removable_drive("/tmp"));
    }

    #[test]
    fn get_drive_info_nonexistent() {
        assert!(get_drive_info("/nonexistent/path/12345").is_none());
    }

    #[test]
    fn get_drive_info_existing() {
        let temp = std::env::temp_dir();
        let info = get_drive_info(temp.to_str().unwrap());
        assert!(info.is_some());
    }

    #[test]
    fn extract_drive_root_windows() {
        if cfg!(windows) {
            assert_eq!(extract_drive_root("C:\\Users\\test"), Some("C:\\".to_string()));
            assert_eq!(extract_drive_root("D:\\data"), Some("D:\\".to_string()));
        }
    }

    #[test]
    fn extract_drive_root_relative() {
        // Relative paths may or may not have a root; just ensure no panic
        let _ = extract_drive_root("relative/path");
    }
}
