//! Device-local CEF installation data, not a persistent website profile.
//!
//! This small bootstrap file is deliberately separate from synchronized and
//! potentially locked application settings. Website cookies remain inside the
//! owning encrypted database; every CEF request context keeps an empty cache path.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::Manager;

const CONFIG_FILE: &str = "native-browser-location.json";
const CONFIG_MAX_BYTES: usize = 16_384;
static ACCESS: Mutex<()> = Mutex::new(());
static ACTIVE_ROOT: OnceLock<PathBuf> = OnceLock::new();

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Location {
    version: u8,
    parent_directory: Option<PathBuf>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDataDirectory {
    pub parent_directory: Option<String>,
    pub effective_directory: String,
    pub active_directory: Option<String>,
    pub restart_required: bool,
}

fn path_text(path: &Path) -> Result<String, String> {
    path.to_str()
        .filter(|value| !value.is_empty() && !value.contains('\0'))
        .map(str::to_owned)
        .ok_or_else(|| "The browser data folder must have a valid text path.".into())
}

fn parent_path(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir))
        || !path.is_dir()
    {
        return Err("Choose an existing absolute folder for browser working data.".into());
    }
    path_text(path)?;
    let canonical = path
        .canonicalize()
        .map_err(|_| "The browser data folder cannot be accessed.")?;
    path_text(&canonical)?;
    Ok(canonical)
}

fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Junctions and other reparse points must not alias managed profiles.
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn app_data_path(path: &Path, create: bool) -> Result<PathBuf, String> {
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Err("The application data folder could not be resolved.".into());
    }
    path_text(path)?;
    if create {
        fs::create_dir_all(path)
            .map_err(|_| "The browser location settings folder cannot be created.")?;
    }
    match fs::symlink_metadata(path) {
        Ok(_) => parent_path(path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(path.to_path_buf()),
        Err(_) => Err("The application data folder cannot be accessed.".into()),
    }
}

fn managed_directory(parent: &Path, name: &str, create: bool) -> Result<PathBuf, String> {
    let path = parent.join(name);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && create => {
            // Do not recursively create through an unchecked namespace/profile.
            match fs::create_dir(&path) {
                Ok(()) => (),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => (),
                Err(_) => {
                    return Err(
                        "The browser data folder cannot be created. Check its permissions.".into(),
                    )
                }
            }
            fs::symlink_metadata(&path)
                .map_err(|_| "The browser data folder cannot be accessed.")?
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(path),
        Err(_) => return Err("The browser data folder cannot be accessed.".into()),
    };
    if is_link(&metadata) || !metadata.is_dir() {
        return Err(
            "A browser data subfolder is a link or not a folder. Choose another parent folder."
                .into(),
        );
    }
    let canonical = parent_path(&path)?;
    if canonical != path {
        return Err(
            "A browser data subfolder aliases another location. Choose another parent folder."
                .into(),
        );
    }
    Ok(canonical)
}

fn read_location(app_data: &Path) -> Result<Location, String> {
    let path = app_data_path(app_data, false)?.join(CONFIG_FILE);
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.is_file() && !is_link(&metadata) => (),
        Ok(_) => {
            return Err(
                "The saved browser data location is not a regular file. Choose a folder again."
                    .into(),
            )
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Location {
                version: 1,
                parent_directory: None,
            });
        }
        Err(_) => return Err("The saved browser data location cannot be read.".into()),
    }
    // Only an absent entry means default. A dangling config link is corruption,
    // not permission to silently switch the browser to a different directory.
    let file =
        fs::File::open(path).map_err(|_| "The saved browser data location cannot be read.")?;
    let mut bytes = Vec::new();
    file.take((CONFIG_MAX_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "The saved browser data location cannot be read.")?;
    if bytes.len() > CONFIG_MAX_BYTES {
        return Err("The saved browser data location is invalid. Choose a folder again.".into());
    }
    let location: Location = serde_json::from_slice(&bytes)
        .map_err(|_| "The saved browser data location is invalid. Choose a folder again.")?;
    if location.version != 1 {
        return Err("The saved browser data location has an unsupported version.".into());
    }
    Ok(location)
}

fn resolve_root(app_data: &Path, identifier: &str, location: &Location) -> Result<PathBuf, String> {
    resolve_root_inner(app_data, identifier, location, false)
}

fn resolve_root_inner(
    app_data: &Path,
    identifier: &str,
    location: &Location,
    create: bool,
) -> Result<PathBuf, String> {
    sorng_core::app_identity::validate_identifier(identifier)
        .map_err(|_| "The browser data profile identifier is invalid.")?;
    let app_data = app_data_path(app_data, create)?;
    match &location.parent_directory {
        Some(parent) => {
            let parent = parent_path(parent)?;
            let namespace = managed_directory(&parent, "sorng-browser", create)?;
            // The prefix avoids Windows device names; the full identifier digest
            // separates even case-only build identifiers on case-folding disks.
            let name = format!(
                "profile-{identifier}-{:x}",
                Sha256::digest(identifier.as_bytes())
            );
            managed_directory(&namespace, &name, create)
        }
        None => managed_directory(&app_data, "native-browser", create),
    }
}

fn prepare_root(app_data: &Path, identifier: &str, location: &Location) -> Result<PathBuf, String> {
    let root = resolve_root_inner(app_data, identifier, location, true)?;
    // Test write access without modifying any pre-existing browser data.
    let probe = root.join(format!(".write-probe-{}", uuid::Uuid::new_v4()));
    let file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&probe)
        .map_err(|_| "The browser data folder is not writable.".to_string())?;
    drop(file);
    fs::remove_file(probe).map_err(|_| {
        "The browser data folder does not allow temporary-file cleanup.".to_string()
    })?;
    Ok(root)
}

fn view(
    app_data: &Path,
    identifier: &str,
    location: &Location,
    active: Option<&Path>,
) -> Result<BrowserDataDirectory, String> {
    let root = resolve_root(app_data, identifier, location)?;
    let comparable = root.canonicalize().unwrap_or_else(|_| root.clone());
    Ok(BrowserDataDirectory {
        parent_directory: location
            .parent_directory
            .as_deref()
            .map(path_text)
            .transpose()?,
        effective_directory: path_text(&root)?,
        active_directory: active.map(path_text).transpose()?,
        restart_required: active.is_some_and(|active| active != comparable),
    })
}

fn encode_location(location: &Location) -> Result<Vec<u8>, String> {
    let bytes = serde_json::to_vec(location)
        .map_err(|_| "The browser data location could not be encoded.")?;
    if bytes.len() > CONFIG_MAX_BYTES {
        return Err(
            "The browser data location is too long to save. Choose a shorter folder path.".into(),
        );
    }
    Ok(bytes)
}

fn save_location(
    app_data: &Path,
    identifier: &str,
    parent: Option<PathBuf>,
    active: Option<&Path>,
) -> Result<BrowserDataDirectory, String> {
    let location = Location {
        version: 1,
        parent_directory: parent.as_deref().map(parent_path).transpose()?,
    };
    let bytes = encode_location(&location)?;
    prepare_root(app_data, identifier, &location)?;
    // Resolve/encode every fallible response field before committing. A failed
    // response must not conceal an already changed next-startup location.
    let state = view(app_data, identifier, &location, active)?;
    let app_data = app_data_path(app_data, false)?;
    let temporary = app_data.join(format!(".{CONFIG_FILE}.{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|_| "The browser data location could not be saved.")?;
        file.write_all(&bytes)
            .and_then(|()| file.sync_all())
            .map_err(|_| "The browser data location could not be saved.")?;
        drop(file);
        fs::rename(&temporary, app_data.join(CONFIG_FILE))
            .map_err(|_| "The browser data location could not be committed.")?;
        Ok::<_, String>(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result?;
    #[cfg(unix)]
    {
        // Best effort directory durability after atomic replacement. Reporting
        // failure now would incorrectly promise that the old config survived.
        if let Ok(directory) = fs::File::open(&app_data) {
            let _ = directory.sync_all();
        }
    }
    Ok(state)
}

/// Main-thread startup only, before CefInitialize. Never changes a live root.
pub fn prepare_for_startup(app_data: &Path, identifier: &str) -> Result<PathBuf, String> {
    let _guard = ACCESS
        .lock()
        .map_err(|_| "The browser data settings are unavailable.")?;
    let location = read_location(app_data)?;
    let root = prepare_root(app_data, identifier, &location)?;
    if ACTIVE_ROOT.get_or_init(|| root.clone()) != &root {
        return Err("The browser data location changed during startup. Restart the app.".into());
    }
    Ok(root)
}

#[tauri::command]
pub fn get_browser_data_directory(app: tauri::AppHandle) -> Result<BrowserDataDirectory, String> {
    let _guard = ACCESS
        .lock()
        .map_err(|_| "The browser data settings are unavailable.")?;
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "The application data folder could not be resolved.")?;
    view(
        &root,
        &app.config().identifier,
        &read_location(&root)?,
        ACTIVE_ROOT.get().map(PathBuf::as_path),
    )
}

#[tauri::command]
pub fn set_browser_data_directory(
    app: tauri::AppHandle,
    parent_directory: Option<String>,
) -> Result<BrowserDataDirectory, String> {
    let _guard = ACCESS
        .lock()
        .map_err(|_| "The browser data settings are unavailable.")?;
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "The application data folder could not be resolved.")?;
    save_location(
        &root,
        &app.config().identifier,
        parent_directory.map(PathBuf::from),
        ACTIVE_ROOT.get().map(PathBuf::as_path),
    )
}

#[tauri::command]
pub fn open_browser_data_directory(app: tauri::AppHandle) -> Result<(), String> {
    let _guard = ACCESS
        .lock()
        .map_err(|_| "The browser data settings are unavailable.")?;
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "The application data folder could not be resolved.")?;
    // Open the configured location, not an IPC-supplied executable or URI.
    let path = prepare_root(&root, &app.config().identifier, &read_location(&root)?)?;
    sorng_app_shell::commands::open_folder(path_text(&path)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_app_local_not_a_shared_cef_profile() {
        let temp = tempfile::tempdir().unwrap();
        let location = read_location(temp.path()).unwrap();
        let state = view(temp.path(), "test.app", &location, None).unwrap();
        assert!(state.effective_directory.ends_with("native-browser"));
        assert!(state.parent_directory.is_none());
        assert!(!state.restart_required);
        assert!(!temp.path().join("native-browser").exists()); // Reading is not creation.
        let root = prepare_root(temp.path(), "test.app", &location).unwrap();
        assert_eq!(fs::read_dir(root).unwrap().count(), 0); // No probe/profile remains.
    }

    #[test]
    fn custom_parent_round_trips_and_isolates_build_profiles() {
        let data = tempfile::tempdir().unwrap();
        let chosen = tempfile::tempdir().unwrap();
        save_location(data.path(), "test.app", Some(chosen.path().into()), None).unwrap();
        let location = read_location(data.path()).unwrap();
        let root = resolve_root(data.path(), "test.app", &location).unwrap();
        assert!(root.is_dir());
        assert_ne!(
            root,
            resolve_root(data.path(), "other.app", &location).unwrap()
        );
        assert_eq!(
            read_location(data.path()).unwrap().parent_directory,
            location.parent_directory
        );
        let old = data.path().join("native-browser");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("existing-data"), b"keep").unwrap();
        assert!(
            view(data.path(), "test.app", &location, Some(&old))
                .unwrap()
                .restart_required
        );
        save_location(data.path(), "test.app", None, None).unwrap();
        assert!(old.join("existing-data").is_file());
        assert!(root.is_dir()); // Reset never deletes or migrates directories.
    }

    #[test]
    fn invalid_or_unavailable_paths_do_not_replace_saved_location() {
        let data = tempfile::tempdir().unwrap();
        save_location(data.path(), "test.app", None, None).unwrap();
        let before = fs::read(data.path().join(CONFIG_FILE)).unwrap();
        for path in [
            PathBuf::from("relative"),
            data.path().join("missing"),
            data.path().join(CONFIG_FILE),
        ] {
            assert!(save_location(data.path(), "test.app", Some(path), None).is_err());
            assert!(read_location(data.path())
                .unwrap()
                .parent_directory
                .is_none());
            assert_eq!(fs::read(data.path().join(CONFIG_FILE)).unwrap(), before);
        }
        assert!(resolve_root(
            data.path(),
            "../escape",
            &read_location(data.path()).unwrap()
        )
        .is_err());
    }

    #[test]
    fn malformed_config_is_not_silently_replaced_with_another_folder() {
        let data = tempfile::tempdir().unwrap();
        for text in [
            "{}",
            "{\"version\":2}",
            "{\"version\":1,\"cachePath\":\"shared\"}",
        ] {
            fs::write(data.path().join(CONFIG_FILE), text).unwrap();
            assert!(read_location(data.path()).is_err());
        }
        fs::write(data.path().join(CONFIG_FILE), vec![b' '; 16_385]).unwrap();
        assert!(read_location(data.path()).is_err());
        save_location(data.path(), "test.app", None, None).unwrap();
        assert!(read_location(data.path()).is_ok());
    }

    #[test]
    fn app_data_may_be_created_but_a_missing_custom_parent_is_never_recreated() {
        let temp = tempfile::tempdir().unwrap();
        let app_data = temp.path().join("app-data");
        let location = read_location(&app_data).unwrap();
        assert!(!app_data.exists());
        let root = prepare_root(&app_data, "test.app", &location).unwrap();
        assert!(root.is_dir());
        let missing = temp.path().join("removed-device");
        let location = Location {
            version: 1,
            parent_directory: Some(missing.clone()),
        };
        fs::write(
            app_data.join(CONFIG_FILE),
            encode_location(&location).unwrap(),
        )
        .unwrap();
        let saved = fs::read(app_data.join(CONFIG_FILE)).unwrap();
        let loaded = read_location(&app_data).unwrap();
        assert!(view(&app_data, "test.app", &loaded, Some(&root)).is_err());
        assert!(prepare_root(&app_data, "test.app", &loaded).is_err());
        assert!(!missing.exists());
        assert_eq!(fs::read(app_data.join(CONFIG_FILE)).unwrap(), saved);
        // Explicit UI reset repairs it, without an automatic alternate path.
        assert!(
            !save_location(&app_data, "test.app", None, Some(&root))
                .unwrap()
                .restart_required
        );
    }

    #[test]
    fn identifiers_are_validated_and_case_variants_cannot_alias_custom_profiles() {
        let data = tempfile::tempdir().unwrap();
        let chosen = tempfile::tempdir().unwrap();
        let location = Location {
            version: 1,
            parent_directory: Some(chosen.path().into()),
        };
        for id in [
            "",
            ".",
            "..",
            "../escape",
            "test/app",
            "test\\app",
            "test.app.",
            "test_app",
        ] {
            assert!(resolve_root(data.path(), id, &location).is_err(), "{id}");
        }
        let lower = prepare_root(data.path(), "test.app", &location).unwrap();
        let upper = prepare_root(data.path(), "TEST.APP", &location).unwrap();
        assert_ne!(
            lower.to_string_lossy().to_lowercase(),
            upper.to_string_lossy().to_lowercase()
        );
        fs::write(lower.join("owner"), b"lower").unwrap();
        assert!(!upper.join("owner").exists());
        // Valid app identifiers that are Windows device names remain safe children.
        let reserved = prepare_root(data.path(), "CON", &location).unwrap();
        assert!(reserved
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .starts_with("profile-CON-"));
        assert!(reserved.starts_with(chosen.path().canonicalize().unwrap()));
    }

    #[test]
    fn traversal_is_rejected_in_both_chosen_and_app_data_paths() {
        let data = tempfile::tempdir().unwrap();
        let child = data.path().join("child");
        fs::create_dir(&child).unwrap();
        let traversal = child.join("..");
        assert!(save_location(data.path(), "test.app", Some(traversal.clone()), None).is_err());
        let location = Location {
            version: 1,
            parent_directory: None,
        };
        assert!(resolve_root(&traversal, "test.app", &location).is_err());
        assert!(prepare_root(Path::new("relative"), "test.app", &location).is_err());
        assert!(!data.path().join(CONFIG_FILE).exists());
    }

    #[test]
    fn managed_file_collisions_leave_the_previous_config_untouched() {
        for collision in ["namespace", "profile", "default"] {
            let data = tempfile::tempdir().unwrap();
            let chosen = tempfile::tempdir().unwrap();
            save_location(data.path(), "test.app", Some(chosen.path().into()), None).unwrap();
            let before = fs::read(data.path().join(CONFIG_FILE)).unwrap();
            let next = tempfile::tempdir().unwrap();
            let location = Location {
                version: 1,
                parent_directory: Some(next.path().into()),
            };
            let (path, parent) = match collision {
                "namespace" => (
                    next.path().join("sorng-browser"),
                    Some(next.path().to_path_buf()),
                ),
                "profile" => {
                    let root = resolve_root(data.path(), "test.app", &location).unwrap();
                    fs::create_dir(root.parent().unwrap()).unwrap();
                    (root, Some(next.path().to_path_buf()))
                }
                _ => (data.path().join("native-browser"), None),
            };
            fs::write(&path, b"not a folder").unwrap();
            assert!(
                save_location(data.path(), "test.app", parent, None).is_err(),
                "{collision}"
            );
            assert_eq!(fs::read(data.path().join(CONFIG_FILE)).unwrap(), before);
            assert_eq!(fs::read(path).unwrap(), b"not a folder");
        }
    }

    #[test]
    fn repeated_atomic_saves_leave_no_temporary_config_or_probe_files() {
        let data = tempfile::tempdir().unwrap();
        let chosen = tempfile::tempdir().unwrap();
        let active = prepare_root(
            data.path(),
            "test.app",
            &Location {
                version: 1,
                parent_directory: None,
            },
        )
        .unwrap();
        for _ in 0..3 {
            let custom = save_location(
                data.path(),
                "test.app",
                Some(chosen.path().into()),
                Some(&active),
            )
            .unwrap();
            assert!(custom.restart_required);
            assert_eq!(custom.active_directory.as_deref(), active.to_str());
            let custom_root = PathBuf::from(&custom.effective_directory);
            assert_eq!(fs::read_dir(custom_root).unwrap().count(), 0);
            let default = save_location(data.path(), "test.app", None, Some(&active)).unwrap();
            assert!(!default.restart_required);
        }
        let mut entries = fs::read_dir(data.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        entries.sort();
        assert_eq!(entries, vec!["native-browser", CONFIG_FILE]);
        assert_eq!(fs::read_dir(active).unwrap().count(), 0);
        let json: serde_json::Value =
            serde_json::from_slice(&fs::read(data.path().join(CONFIG_FILE)).unwrap()).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"version": 1, "parentDirectory": null})
        );
    }

    #[test]
    fn commit_failure_preserves_existing_entry_and_cleans_temporary_file() {
        let data = tempfile::tempdir().unwrap();
        let config = data.path().join(CONFIG_FILE);
        fs::create_dir(&config).unwrap();
        fs::write(config.join("keep"), b"existing").unwrap();
        assert!(read_location(data.path()).is_err());
        assert!(save_location(data.path(), "test.app", None, None).is_err());
        assert_eq!(fs::read(config.join("keep")).unwrap(), b"existing");
        assert!(fs::read_dir(data.path()).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".tmp")
        }));
    }

    #[test]
    fn writer_cannot_persist_a_location_larger_than_the_reader_accepts() {
        let location = Location {
            version: 1,
            parent_directory: Some(PathBuf::from("a".repeat(CONFIG_MAX_BYTES))),
        };
        assert!(encode_location(&location).is_err());
    }

    #[cfg(any(unix, windows))]
    fn make_link(target: &Path, link: &Path, directory: bool) -> bool {
        #[cfg(unix)]
        let result = {
            let _ = directory;
            std::os::unix::fs::symlink(target, link)
        };
        #[cfg(windows)]
        let result = if directory {
            std::os::windows::fs::symlink_dir(target, link)
        } else {
            std::os::windows::fs::symlink_file(target, link)
        };
        #[cfg(windows)]
        if result
            .as_ref()
            .err()
            .is_some_and(|error| error.raw_os_error() == Some(1314))
        {
            eprintln!("symlink fixture unavailable: Windows Developer Mode or symlink privilege is required");
            return false;
        }
        result.unwrap();
        true
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn managed_links_cannot_redirect_into_another_profile_or_outside_the_parent() {
        for collision in ["namespace", "profile", "default"] {
            let data = tempfile::tempdir().unwrap();
            let chosen = tempfile::tempdir().unwrap();
            let outside = tempfile::tempdir().unwrap();
            let location = Location {
                version: 1,
                parent_directory: Some(chosen.path().into()),
            };
            let (link, candidate) = match collision {
                "namespace" => (chosen.path().join("sorng-browser"), location),
                "profile" => {
                    let path = resolve_root(data.path(), "test.app", &location).unwrap();
                    fs::create_dir(path.parent().unwrap()).unwrap();
                    (path, location)
                }
                _ => (
                    data.path().join("native-browser"),
                    Location {
                        version: 1,
                        parent_directory: None,
                    },
                ),
            };
            if !make_link(outside.path(), &link, true) {
                return;
            }
            assert!(
                resolve_root(data.path(), "test.app", &candidate).is_err(),
                "{collision}"
            );
            assert!(
                prepare_root(data.path(), "test.app", &candidate).is_err(),
                "{collision}"
            );
            assert!(
                save_location(data.path(), "test.app", candidate.parent_directory, None).is_err(),
                "{collision}"
            );
            assert!(!data.path().join(CONFIG_FILE).exists());
            assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
        }
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn explicitly_chosen_parent_links_are_canonicalized_before_storage() {
        let data = tempfile::tempdir().unwrap();
        let chosen = tempfile::tempdir().unwrap();
        let link = data.path().join("chosen-link");
        if !make_link(chosen.path(), &link, true) {
            return;
        }
        save_location(data.path(), "test.app", Some(link), None).unwrap();
        assert_eq!(
            read_location(data.path()).unwrap().parent_directory,
            Some(chosen.path().canonicalize().unwrap())
        );
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn linked_and_dangling_configs_are_not_defaults_and_explicit_reset_preserves_targets() {
        for existing_target in [true, false] {
            let data = tempfile::tempdir().unwrap();
            let external = tempfile::tempdir().unwrap();
            let target = external.path().join("other-profile.json");
            if existing_target {
                fs::write(&target, br#"{"version":1,"parentDirectory":null}"#).unwrap();
            }
            if !make_link(&target, &data.path().join(CONFIG_FILE), false) {
                return;
            }
            assert!(read_location(data.path()).is_err());
            assert!(!data.path().join("native-browser").exists());
            save_location(data.path(), "test.app", None, None).unwrap();
            assert!(!is_link(
                &fs::symlink_metadata(data.path().join(CONFIG_FILE)).unwrap()
            ));
            assert!(read_location(data.path())
                .unwrap()
                .parent_directory
                .is_none());
            if existing_target {
                assert_eq!(
                    fs::read(target).unwrap(),
                    br#"{"version":1,"parentDirectory":null}"#
                );
            } else {
                assert!(!target.exists());
            }
        }
    }

    #[test]
    fn data_directory_commands_are_publicly_routed_and_use_the_ui_response_shape() {
        for command in [
            "get_browser_data_directory",
            "set_browser_data_directory",
            "open_browser_data_directory",
        ] {
            assert!(crate::is_command(command), "{command}");
        }
        let data = tempfile::tempdir().unwrap();
        let state = view(
            data.path(),
            "test.app",
            &read_location(data.path()).unwrap(),
            None,
        )
        .unwrap();
        let json = serde_json::to_value(state).unwrap();
        assert!(json.get("parentDirectory").unwrap().is_null());
        assert!(json.get("effectiveDirectory").unwrap().is_string());
        assert!(json.get("activeDirectory").unwrap().is_null());
        assert_eq!(
            json.get("restartRequired"),
            Some(&serde_json::Value::Bool(false))
        );
        assert_eq!(json.as_object().unwrap().len(), 4);
    }
}
