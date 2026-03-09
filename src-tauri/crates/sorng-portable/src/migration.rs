//! Migration between portable and installed modes.
//!
//! Provides planning and execution of data migration, plus marker-file
//! management.

use std::fs;
use std::path::Path;

use crate::error::PortableError;
use crate::paths::calculate_directory_size;
use crate::types::{MigrationPlan, PortableMode, PortablePaths};

/// Plan a migration by inspecting the source directories and listing
/// all files that need to be copied.
pub fn plan_migration(
    from: &PortablePaths,
    _to: &PortablePaths,
) -> Result<MigrationPlan, PortableError> {
    let source_mode = if Path::new(&from.base_dir).join(".portable").exists() {
        PortableMode::Portable
    } else {
        PortableMode::Installed
    };
    let target_mode = match source_mode {
        PortableMode::Portable => PortableMode::Installed,
        PortableMode::Installed => PortableMode::Portable,
    };

    let files = collect_files_recursive(&from.data_dir);
    let total_size = calculate_directory_size(&from.data_dir);

    // Rough estimate: ~50 MB/s copy speed → time = size / 50_000_000
    let estimated_time = if total_size > 0 {
        (total_size as f64) / 50_000_000.0
    } else {
        0.0
    };

    Ok(MigrationPlan {
        source_mode,
        target_mode,
        files_to_copy: files,
        total_size_bytes: total_size,
        estimated_time_seconds: estimated_time,
    })
}

/// Execute a migration by copying all planned files from the source paths
/// to the target paths, preserving the directory structure.
pub fn execute_migration(
    plan: &MigrationPlan,
    from: &PortablePaths,
    to: &PortablePaths,
) -> Result<(), PortableError> {
    // Ensure target directories exist
    crate::paths::ensure_directories(to)?;

    let from_base = Path::new(&from.data_dir);
    let to_base = Path::new(&to.data_dir);

    for relative_path in &plan.files_to_copy {
        let src = from_base.join(relative_path);
        let dst = to_base.join(relative_path);

        // Create parent directory in destination
        if let Some(parent) = dst.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent).map_err(|e| {
                    PortableError::DirectoryCreateFailed(format!("{}: {}", parent.display(), e))
                })?;
            }
        }

        // Copy the file
        fs::copy(&src, &dst).map_err(|e| PortableError::CopyFailed {
            source: src.to_string_lossy().to_string(),
            dest: dst.to_string_lossy().to_string(),
            reason: e.to_string(),
        })?;

        log::debug!("Copied: {} → {}", src.display(), dst.display());
    }

    // Handle marker file
    match plan.target_mode {
        PortableMode::Portable => {
            create_portable_marker(&to.base_dir)?;
        }
        PortableMode::Installed => {
            // Remove marker from source if it exists
            let _ = remove_portable_marker(&from.base_dir);
        }
    }

    log::info!(
        "Migration complete: {} files, {} bytes",
        plan.files_to_copy.len(),
        plan.total_size_bytes
    );

    Ok(())
}

/// Create the `.portable` marker file in the given directory.
pub fn create_portable_marker(dir: &str) -> Result<(), PortableError> {
    let marker = Path::new(dir).join(".portable");
    fs::write(&marker, "")
        .map_err(|e| PortableError::MarkerCreateFailed(format!("{}: {}", marker.display(), e)))?;
    log::info!("Created portable marker: {}", marker.display());
    Ok(())
}

/// Remove the `.portable` marker file from the given directory.
pub fn remove_portable_marker(dir: &str) -> Result<(), PortableError> {
    let marker = Path::new(dir).join(".portable");
    if marker.exists() {
        fs::remove_file(&marker).map_err(|e| {
            PortableError::MarkerRemoveFailed(format!("{}: {}", marker.display(), e))
        })?;
        log::info!("Removed portable marker: {}", marker.display());
    }
    Ok(())
}

/// Validate that a directory is a valid portable data directory by checking
/// for expected subdirectories.
///
/// Returns a list of issues found (empty = valid).
pub fn validate_portable_directory(dir: &str) -> Vec<String> {
    let base = Path::new(dir);
    let mut issues = Vec::new();

    if !base.exists() {
        issues.push(format!("directory does not exist: {}", dir));
        return issues;
    }

    if !base.is_dir() {
        issues.push(format!("path is not a directory: {}", dir));
        return issues;
    }

    let expected_subdirs = [
        "settings",
        "collections",
        "backups",
        "recordings",
        "extensions",
        "logs",
    ];

    for subdir in &expected_subdirs {
        let p = base.join(subdir);
        if !p.exists() {
            issues.push(format!("missing subdirectory: {}", subdir));
        }
    }

    // Check for marker file
    if !base.parent().is_some_and(|p| p.join(".portable").exists()) {
        // Also check if marker is in the directory itself (some layouts)
        if !base.join("../.portable").exists() {
            issues
                .push("portable marker file (.portable) not found in parent directory".to_string());
        }
    }

    issues
}

/// Recursively collect all files in a directory, returning paths relative to `dir`.
fn collect_files_recursive(dir: &str) -> Vec<String> {
    let base = Path::new(dir);
    let mut files = Vec::new();
    collect_files_inner(base, base, &mut files);
    files
}

fn collect_files_inner(base: &Path, current: &Path, out: &mut Vec<String>) {
    if let Ok(entries) = fs::read_dir(current) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                let path = entry.path();
                if meta.is_file() {
                    if let Ok(relative) = path.strip_prefix(base) {
                        out.push(relative.to_string_lossy().to_string());
                    }
                } else if meta.is_dir() {
                    collect_files_inner(base, &path, out);
                }
            }
        }
    }
}

// ─── Tests ──────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_and_remove_marker() {
        let temp = std::env::temp_dir().join("sorng_test_marker");
        let _ = fs::create_dir_all(&temp);

        create_portable_marker(temp.to_str().unwrap()).unwrap();
        assert!(temp.join(".portable").exists());

        remove_portable_marker(temp.to_str().unwrap()).unwrap();
        assert!(!temp.join(".portable").exists());

        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn remove_nonexistent_marker_ok() {
        let temp = std::env::temp_dir().join("sorng_test_marker_noop");
        let _ = fs::create_dir_all(&temp);

        // Should not error even if marker doesn't exist
        remove_portable_marker(temp.to_str().unwrap()).unwrap();

        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn validate_portable_directory_missing() {
        let issues = validate_portable_directory("/nonexistent/12345");
        assert!(!issues.is_empty());
        assert!(issues[0].contains("does not exist"));
    }

    #[test]
    fn validate_portable_directory_empty() {
        let temp = std::env::temp_dir().join("sorng_test_validate");
        let _ = fs::remove_dir_all(&temp);
        let _ = fs::create_dir_all(&temp);

        let issues = validate_portable_directory(temp.to_str().unwrap());
        // Should report missing subdirectories
        assert!(!issues.is_empty());

        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn validate_portable_directory_complete() {
        let temp = std::env::temp_dir().join("sorng_test_validate_full");
        let _ = fs::remove_dir_all(&temp);
        let _ = fs::create_dir_all(&temp);

        for subdir in &[
            "settings",
            "collections",
            "backups",
            "recordings",
            "extensions",
            "logs",
        ] {
            fs::create_dir_all(temp.join(subdir)).unwrap();
        }

        let issues = validate_portable_directory(temp.to_str().unwrap());
        // Only the marker issue should remain (no subdirectory issues)
        let subdir_issues: Vec<_> = issues
            .iter()
            .filter(|i| i.contains("missing subdirectory"))
            .collect();
        assert!(subdir_issues.is_empty());

        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn collect_files_recursive_basic() {
        let temp = std::env::temp_dir().join("sorng_test_collect");
        let _ = fs::remove_dir_all(&temp);
        let _ = fs::create_dir_all(temp.join("sub"));

        fs::write(temp.join("a.txt"), "a").unwrap();
        fs::write(temp.join("sub/b.txt"), "b").unwrap();

        let files = collect_files_recursive(temp.to_str().unwrap());
        assert_eq!(files.len(), 2);

        let _ = fs::remove_dir_all(&temp);
    }

    #[test]
    fn plan_migration_basic() {
        let temp_from = std::env::temp_dir().join("sorng_test_migrate_from");
        let temp_to = std::env::temp_dir().join("sorng_test_migrate_to");
        let _ = fs::remove_dir_all(&temp_from);
        let _ = fs::remove_dir_all(&temp_to);
        let _ = fs::create_dir_all(temp_from.join("data"));

        fs::write(temp_from.join("data/test.txt"), "hello").unwrap();

        let from_paths = PortablePaths {
            base_dir: temp_from.to_string_lossy().to_string(),
            data_dir: temp_from.join("data").to_string_lossy().to_string(),
            settings_dir: temp_from
                .join("data/settings")
                .to_string_lossy()
                .to_string(),
            collections_dir: temp_from
                .join("data/collections")
                .to_string_lossy()
                .to_string(),
            backups_dir: temp_from.join("data/backups").to_string_lossy().to_string(),
            recordings_dir: temp_from
                .join("data/recordings")
                .to_string_lossy()
                .to_string(),
            extensions_dir: temp_from
                .join("data/extensions")
                .to_string_lossy()
                .to_string(),
            logs_dir: temp_from.join("data/logs").to_string_lossy().to_string(),
            temp_dir: temp_from.join("data/temp").to_string_lossy().to_string(),
            cache_dir: temp_from.join("data/cache").to_string_lossy().to_string(),
        };
        let to_paths = PortablePaths {
            base_dir: temp_to.to_string_lossy().to_string(),
            data_dir: temp_to.join("data").to_string_lossy().to_string(),
            settings_dir: temp_to.join("data/settings").to_string_lossy().to_string(),
            collections_dir: temp_to
                .join("data/collections")
                .to_string_lossy()
                .to_string(),
            backups_dir: temp_to.join("data/backups").to_string_lossy().to_string(),
            recordings_dir: temp_to
                .join("data/recordings")
                .to_string_lossy()
                .to_string(),
            extensions_dir: temp_to
                .join("data/extensions")
                .to_string_lossy()
                .to_string(),
            logs_dir: temp_to.join("data/logs").to_string_lossy().to_string(),
            temp_dir: temp_to.join("data/temp").to_string_lossy().to_string(),
            cache_dir: temp_to.join("data/cache").to_string_lossy().to_string(),
        };

        let plan = plan_migration(&from_paths, &to_paths).unwrap();
        assert_eq!(plan.files_to_copy.len(), 1);
        assert_eq!(plan.total_size_bytes, 5); // "hello" = 5 bytes

        let _ = fs::remove_dir_all(&temp_from);
        let _ = fs::remove_dir_all(&temp_to);
    }
}
