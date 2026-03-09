//! Path resolution and directory management for portable mode.

use std::path::{Path, PathBuf};

use crate::error::PortableError;
use crate::types::{PortableConfig, PortableMode, PortablePaths, PortableStatus};

/// Resolve all application data paths based on the current configuration
/// and the directory containing the executable.
///
/// In **portable** mode, all paths are relative to `exe_dir`.
/// In **installed** mode, `config.data_directory` is used as the base,
/// or a sensible default if empty.
pub fn resolve_paths(config: &PortableConfig, exe_dir: &str) -> PortablePaths {
    let base = match config.mode {
        PortableMode::Portable => PathBuf::from(exe_dir).join(&config.relative_data_dir),
        PortableMode::Installed => {
            if config.data_directory.is_empty() {
                // Fallback to a "data" subdirectory next to the exe
                PathBuf::from(exe_dir).join("data")
            } else {
                PathBuf::from(&config.data_directory)
            }
        }
    };

    let base_str = base.to_string_lossy().to_string();
    let base_dir = PathBuf::from(exe_dir).to_string_lossy().to_string();

    PortablePaths {
        base_dir,
        data_dir: base_str.clone(),
        settings_dir: join_path(&base_str, "settings"),
        collections_dir: join_path(&base_str, "collections"),
        backups_dir: join_path(&base_str, "backups"),
        recordings_dir: join_path(&base_str, "recordings"),
        extensions_dir: join_path(&base_str, "extensions"),
        logs_dir: join_path(&base_str, "logs"),
        temp_dir: join_path(&base_str, "temp"),
        cache_dir: join_path(&base_str, "cache"),
    }
}

/// Create all directories in the path structure if they don't exist.
pub fn ensure_directories(paths: &PortablePaths) -> Result<(), PortableError> {
    let dirs = [
        &paths.data_dir,
        &paths.settings_dir,
        &paths.collections_dir,
        &paths.backups_dir,
        &paths.recordings_dir,
        &paths.extensions_dir,
        &paths.logs_dir,
        &paths.temp_dir,
        &paths.cache_dir,
    ];

    for dir in &dirs {
        let p = Path::new(dir);
        if !p.exists() {
            std::fs::create_dir_all(p)
                .map_err(|e| PortableError::DirectoryCreateFailed(format!("{}: {}", dir, e)))?;
            log::info!("Created directory: {}", dir);
        }
    }

    Ok(())
}

/// Compute a relative path from `base` to `path`.
///
/// If the path is not relative to the base, returns the original path string.
pub fn get_relative_path(base: &str, path: &str) -> String {
    let base_p = Path::new(base);
    let path_p = Path::new(path);

    match path_p.strip_prefix(base_p) {
        Ok(relative) => relative.to_string_lossy().to_string(),
        Err(_) => path.to_string(),
    }
}

/// Gather runtime status information about the portable environment.
pub fn get_portable_status(paths: &PortablePaths) -> Result<PortableStatus, PortableError> {
    let data_path = Path::new(&paths.data_dir);
    let mode = if Path::new(&paths.base_dir).join(".portable").exists() {
        PortableMode::Portable
    } else {
        PortableMode::Installed
    };

    let total_size = calculate_directory_size(&paths.data_dir);

    // File count: simplified recursive count
    let file_count = count_files(&paths.data_dir);

    // Drive info is best-effort
    let drive_info = crate::detector::get_drive_info(&paths.data_dir);
    let free_space = drive_info.as_ref().map(|d| d.free_bytes).unwrap_or(0);
    let is_removable = drive_info.as_ref().map(|d| d.is_removable).unwrap_or(false);
    let drive_label = drive_info.map(|d| d.label);

    Ok(PortableStatus {
        mode,
        data_dir: data_path.to_string_lossy().to_string(),
        total_size_bytes: total_size,
        free_space_bytes: free_space,
        file_count,
        is_removable_drive: is_removable,
        drive_label,
    })
}

/// Calculate the total size of a directory recursively.
///
/// This is a simplified implementation. For very large directory trees
/// this could be slow; a production version might cache or background
/// this computation.
pub fn calculate_directory_size(dir: &str) -> u64 {
    let path = Path::new(dir);
    if !path.is_dir() {
        return 0;
    }

    let mut total: u64 = 0;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let metadata = entry.metadata();
            if let Ok(meta) = metadata {
                if meta.is_file() {
                    total += meta.len();
                } else if meta.is_dir() {
                    total += calculate_directory_size(entry.path().to_string_lossy().as_ref());
                }
            }
        }
    }

    total
}

/// Count files in a directory recursively.
fn count_files(dir: &str) -> u64 {
    let path = Path::new(dir);
    if !path.is_dir() {
        return 0;
    }

    let mut count: u64 = 0;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    count += 1;
                } else if meta.is_dir() {
                    count += count_files(entry.path().to_string_lossy().as_ref());
                }
            }
        }
    }

    count
}

/// Join a base path with a child component.
fn join_path(base: &str, child: &str) -> String {
    Path::new(base).join(child).to_string_lossy().to_string()
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::PortableConfig;
    use std::fs;

    #[test]
    fn resolve_paths_portable() {
        let config = PortableConfig {
            mode: PortableMode::Portable,
            relative_data_dir: "data".to_string(),
            ..Default::default()
        };
        let paths = resolve_paths(&config, "/app");
        assert!(paths.data_dir.contains("data"));
        assert!(paths.settings_dir.contains("settings"));
        assert!(paths.collections_dir.contains("collections"));
    }

    #[test]
    fn resolve_paths_installed() {
        let config = PortableConfig {
            mode: PortableMode::Installed,
            data_directory: "/home/user/.sortofremote".to_string(),
            ..Default::default()
        };
        let paths = resolve_paths(&config, "/app");
        assert!(paths.data_dir.contains(".sortofremote"));
    }

    #[test]
    fn resolve_paths_installed_empty_data_dir() {
        let config = PortableConfig {
            mode: PortableMode::Installed,
            data_directory: String::new(),
            ..Default::default()
        };
        let paths = resolve_paths(&config, "/app");
        assert!(paths.data_dir.contains("data"));
    }

    #[test]
    fn ensure_directories_creates() {
        let temp = std::env::temp_dir().join("sorng_test_ensure_dirs");
        let _ = fs::remove_dir_all(&temp);

        let config = PortableConfig {
            mode: PortableMode::Portable,
            relative_data_dir: "data".to_string(),
            ..Default::default()
        };
        let paths = resolve_paths(&config, temp.to_str().unwrap());
        ensure_directories(&paths).unwrap();

        assert!(Path::new(&paths.data_dir).exists());
        assert!(Path::new(&paths.settings_dir).exists());
        assert!(Path::new(&paths.collections_dir).exists());
        assert!(Path::new(&paths.backups_dir).exists());
        assert!(Path::new(&paths.recordings_dir).exists());
        assert!(Path::new(&paths.extensions_dir).exists());
        assert!(Path::new(&paths.logs_dir).exists());
        assert!(Path::new(&paths.temp_dir).exists());
        assert!(Path::new(&paths.cache_dir).exists());

        // Cleanup
        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn get_relative_path_basic() {
        assert_eq!(
            get_relative_path("/app/data", "/app/data/settings"),
            "settings"
        );
        assert_eq!(
            get_relative_path("/app/data", "/somewhere/else"),
            "/somewhere/else"
        );
    }

    #[test]
    fn calculate_directory_size_empty() {
        let temp = std::env::temp_dir().join("sorng_test_dirsize");
        let _ = fs::create_dir_all(&temp);

        let size = calculate_directory_size(temp.to_str().unwrap());
        // An empty directory has size 0
        assert_eq!(size, 0);

        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn calculate_directory_size_with_files() {
        let temp = std::env::temp_dir().join("sorng_test_dirsize2");
        let _ = fs::remove_dir_all(&temp);
        let _ = fs::create_dir_all(&temp);

        fs::write(temp.join("a.txt"), "hello").unwrap(); // 5 bytes
        fs::write(temp.join("b.txt"), "world!").unwrap(); // 6 bytes

        let size = calculate_directory_size(temp.to_str().unwrap());
        assert_eq!(size, 11);

        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn calculate_directory_size_nonexistent() {
        assert_eq!(calculate_directory_size("/nonexistent/12345"), 0);
    }
}
