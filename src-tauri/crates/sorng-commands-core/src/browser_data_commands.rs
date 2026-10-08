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
static ACTIVE_ROOT: OnceLock<StartupDirectory> = OnceLock::new();

struct StartupDirectory {
    root: PathBuf,
    // Fixed messages only: never include a path, account name or storage error
    // supplied by a website. The saved preference is not overwritten.
    fallback_reason: Option<&'static str>,
    // An OS lock, not a stale PID file. A crash releases it automatically.
    // Two app instances must never initialize Chromium's parent profile at
    // the same working root, even though website contexts are in memory.
    _lease: fs::File,
}

const LOCATION_UNAVAILABLE: &str = "The selected browser working-data folder is unavailable. This run uses an application-local fallback; your saved folder and encrypted database sessions are unchanged.";
const SETTINGS_UNAVAILABLE: &str = "The browser working-data location settings could not be read. This run uses an application-local fallback; the original settings and encrypted database sessions are unchanged.";
const NO_WRITABLE_ROOT: &str = "No safe writable browser working-data folder is available. The app can still be used. Choose an accessible folder in Settings > Web Browser and restart; no database or retained sign-in data was changed.";

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
    pub fallback_reason: Option<String>,
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
    // Only an absent entry means the default preference. An unreadable entry is
    // reported to startup recovery, which exposes its fallback without replacing
    // the saved configuration or misreporting it as the user's chosen default.
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
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&probe)
        .map_err(|_| "The browser data folder is not writable.".to_string())?;
    // Creating an empty file alone does not detect a full volume or broken IO.
    let written = file
        .write_all(b"browser working-data probe\n")
        .and_then(|()| file.sync_all());
    drop(file);
    let removed = fs::remove_file(probe)
        .map_err(|_| "The browser data folder does not allow temporary-file cleanup.".to_string());
    written.map_err(|_| "The browser data folder could not write and flush data.".to_string())?;
    removed?;
    Ok(root)
}

fn lease_root(
    root: PathBuf,
    fallback_reason: Option<&'static str>,
) -> Result<StartupDirectory, String> {
    let path = root.join(".sorng-browser.lock");
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.is_file() && !is_link(&metadata) => (),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
        _ => return Err("The browser working-data lock is not a regular file.".into()),
    }
    let lease = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&path)
        .map_err(|_| "The browser working-data lock cannot be opened.")?;
    lease
        .try_lock()
        .map_err(|_| "The browser working-data folder is already in use or cannot be locked.")?;
    Ok(StartupDirectory {
        root,
        fallback_reason,
        _lease: lease,
    })
}

/// Working storage only. Never search another database, cookie jar or profile
/// for credentials. All candidates undergo the same path and write checks.
fn prepare_with_fallbacks(
    app_data: &Path,
    identifier: &str,
    alternatives: &[PathBuf],
) -> Result<StartupDirectory, String> {
    // Writers serialize and atomically replace the settings file. Reading one
    // bounded, owned snapshot needs no ACCESS lock: a concurrent edit selects
    // either complete version and cannot retarget the provisional root guard.
    let location = read_location(app_data);
    prepare_with_location(app_data, identifier, alternatives, location)
}

fn prepare_with_location(
    app_data: &Path,
    identifier: &str,
    alternatives: &[PathBuf],
    location: Result<Location, String>,
) -> Result<StartupDirectory, String> {
    sorng_core::app_identity::validate_identifier(identifier)
        .map_err(|_| "The browser data profile identifier is invalid.")?;
    if let Ok(location) = &location {
        match prepare_root(app_data, identifier, location).and_then(|root| lease_root(root, None)) {
            Ok(prepared) => return Ok(prepared),
            // Helpers return fixed diagnostic strings, never paths or page data.
            Err(error) => {
                log::warn!("Native browser preferred working-data preparation failed: {error}")
            }
        }
    } else {
        log::warn!("Native browser working-data location settings are unavailable; trying application-local recovery");
    }
    let reason = if location.is_err() {
        SETTINGS_UNAVAILABLE
    } else {
        LOCATION_UNAVAILABLE
    };
    let default = Location {
        version: 1,
        parent_directory: None,
    };
    // App-local data first (Windows LocalAppData, Linux XDG data, macOS
    // Application Support). Native callers may then supply their app-scoped
    // cache directory. No current-directory, shared /tmp or network fallback.
    let mut seen = Vec::new();
    for candidate in std::iter::once(app_data).chain(alternatives.iter().map(PathBuf::as_path)) {
        if seen.contains(&candidate) {
            continue;
        }
        seen.push(candidate);
        match prepare_root(candidate, identifier, &default)
            .and_then(|root| lease_root(root, Some(reason)))
        {
            Ok(prepared) => return Ok(prepared),
            Err(error) => {
                log::warn!("Native browser working-data recovery candidate rejected: {error}")
            }
        }
    }
    Err(NO_WRITABLE_ROOT.into())
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
        fallback_reason: None,
    })
}

fn recovery_view(
    app_data: &Path,
    identifier: &str,
    active: Option<&StartupDirectory>,
) -> Result<BrowserDataDirectory, String> {
    let location = read_location(app_data);
    let state = location
        .as_ref()
        .map_err(Clone::clone)
        .and_then(|location| {
            view(
                app_data,
                identifier,
                location,
                active.map(|entry| entry.root.as_path()),
            )
        });
    match (state, active) {
        (Ok(mut state), active) => {
            state.fallback_reason = active
                .and_then(|entry| entry.fallback_reason)
                .map(str::to_owned);
            Ok(state)
        }
        // The unavailable selected drive must not break the settings screen
        // used to repair it. Keep its original parent visible in the input.
        (Err(_), Some(active)) => Ok(BrowserDataDirectory {
            parent_directory: location
                .ok()
                .and_then(|location| location.parent_directory)
                .as_deref()
                .and_then(|path| path_text(path).ok()),
            effective_directory: path_text(&active.root)?,
            active_directory: Some(path_text(&active.root)?),
            restart_required: false,
            fallback_reason: Some(
                active
                    .fallback_reason
                    .unwrap_or(LOCATION_UNAVAILABLE)
                    .into(),
            ),
        }),
        (Err(error), None) => Err(error),
    }
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

/// A checked working directory whose OS lock is provisional until native entry.
/// Dropping an uncommitted preparation releases only its own lock. It never
/// deletes files, publishes an active root, or changes another startup's root.
#[must_use = "retain the preparation through native entry; dropping it releases the provisional lock"]
pub struct PreparedStartupDirectory<'a> {
    active: &'a OnceLock<StartupDirectory>,
    root: PathBuf,
    pending: Option<StartupDirectory>,
}

impl PreparedStartupDirectory<'_> {
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Commit inside the final native-entry callback, after authorization and
    /// cancellation checks. Retains the root and lock for the process lifetime.
    /// Reusing an already committed root (or committing this guard twice) is a
    /// no-op. There is no filesystem I/O or blocking lock acquisition here.
    ///
    /// Callers serialize preparation/native entry with StartupGate. A competing
    /// commit is an invariant failure: it leaves both roots untouched, and must
    /// be treated as terminal if the caller already consumed its startup permit.
    /// A saved directory edit does not retarget this guard; the settings response
    /// reports restart_required when that preference differs from the active root.
    pub fn commit(&mut self) -> Result<(), String> {
        let Some(prepared) = self.pending.take() else {
            return Ok(());
        };
        let fallback_reason = prepared.fallback_reason;
        if let Err(prepared) = self.active.set(prepared) {
            // Keep ownership of our provisional lock until this guard drops.
            // Never clear, replace or unlock the root that won the commit.
            self.pending = Some(prepared);
            return Err("Browser working data was committed by another startup.".into());
        }
        if let Some(reason) = fallback_reason {
            log::warn!("Native browser working-data recovery: {reason}");
        }
        Ok(())
    }
}

fn prepare_startup_directory<'a>(
    active: &'a OnceLock<StartupDirectory>,
    app_data: &Path,
    identifier: &str,
    alternatives: &[PathBuf],
) -> Result<PreparedStartupDirectory<'a>, String> {
    prepare_startup_directory_with(active, || {
        prepare_with_fallbacks(app_data, identifier, alternatives)
    })
}

fn prepare_startup_directory_with(
    active: &OnceLock<StartupDirectory>,
    prepare: impl FnOnce() -> Result<StartupDirectory, String>,
) -> Result<PreparedStartupDirectory<'_>, String> {
    if let Some(directory) = active.get() {
        return Ok(PreparedStartupDirectory {
            active,
            root: directory.root.clone(),
            pending: None,
        });
    }
    let prepared = prepare()?;
    Ok(PreparedStartupDirectory {
        active,
        root: prepared.root.clone(),
        pending: Some(prepared),
    })
}

/// Blocking preflight only, before CefInitialize. Retain the returned guard in
/// the worker result and queued UI callback; cancellation/timeout must drop it.
/// Only commit at native entry. Never changes an already committed live root.
/// A cancelled blocking worker may outlive its caller. It must never hold the
/// settings mutex while reading configuration, probing storage or taking a lease.
pub fn prepare_for_startup(
    app_data: &Path,
    identifier: &str,
    alternatives: &[PathBuf],
) -> Result<PreparedStartupDirectory<'static>, String> {
    prepare_startup_directory(&ACTIVE_ROOT, app_data, identifier, alternatives)
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
    recovery_view(&root, &app.config().identifier, ACTIVE_ROOT.get())
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
        ACTIVE_ROOT.get().map(|entry| entry.root.as_path()),
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
    // During recovery open the directory actually in use, never recreate a
    // disconnected drive or resolve an IPC-supplied executable or URI.
    let path = match ACTIVE_ROOT.get() {
        Some(active) => parent_path(&active.root)?,
        None => prepare_with_fallbacks(&root, &app.config().identifier, &[])?.root,
    };
    sorng_app_shell::commands::open_folder(path_text(&path)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancelled_blocked_preparation_does_not_block_settings_or_retarget_snapshot() {
        use std::sync::mpsc;
        use std::time::Duration;

        let data = tempfile::tempdir().unwrap();
        let chosen = tempfile::tempdir().unwrap();
        let active = OnceLock::new();
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let (reply, caller) = mpsc::channel();
        std::thread::scope(|scope| {
            let data_path = data.path();
            let active_ref = &active;
            let worker = scope.spawn(move || {
                let prepared = prepare_startup_directory_with(active_ref, || {
                    let snapshot = read_location(data_path);
                    started_tx.send(()).unwrap();
                    release_rx.recv_timeout(Duration::from_secs(5)).unwrap(); // A filesystem probe is stalled.
                    prepare_with_location(data_path, "test.app", &[], snapshot)
                })
                .unwrap();
                let root = prepared.root().to_path_buf();
                assert!(reply.send(prepared).is_err());
                root
            });
            started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            drop(caller); // Timeout abandons the result, not the blocking worker.
            let access = ACCESS.try_lock();
            let updated = match access {
                Ok(_guard) => {
                    let state = recovery_view(data.path(), "test.app", active.get()).unwrap();
                    assert!(state.active_directory.is_none());
                    Some(
                        save_location(data.path(), "test.app", Some(chosen.path().into()), None)
                            .unwrap(),
                    )
                }
                Err(_) => None,
            };
            // Always release before asserting so a failed regression cannot hang.
            release_tx.send(()).unwrap();
            let old_root = worker.join().unwrap();
            let updated = updated.expect("cancelled preflight must not hold settings ACCESS");
            assert_ne!(old_root, Path::new(&updated.effective_directory));
            assert!(active.get().is_none());
            assert!(lease_root(old_root, None).is_ok());
            let next = prepare_startup_directory(&active, data.path(), "test.app", &[]).unwrap();
            assert_eq!(next.root(), Path::new(&updated.effective_directory));
        });
    }

    #[test]
    fn dropped_preparation_releases_only_its_lock_and_is_not_active() {
        let data = tempfile::tempdir().unwrap();
        let active = OnceLock::new();
        let prepared = prepare_startup_directory(&active, data.path(), "test.app", &[]).unwrap();
        let root = prepared.root().to_path_buf();
        fs::write(root.join("keep-existing-data"), b"keep").unwrap();
        assert!(active.get().is_none());
        let state = recovery_view(data.path(), "test.app", active.get()).unwrap();
        assert!(state.active_directory.is_none());
        assert!(!state.restart_required);
        assert!(lease_root(root.clone(), None).is_err());

        drop(prepared);

        assert!(active.get().is_none());
        assert_eq!(fs::read(root.join("keep-existing-data")).unwrap(), b"keep");
        assert!(root.join(".sorng-browser.lock").is_file());
        assert!(lease_root(root, None).is_ok());
    }

    #[tokio::test]
    async fn timed_out_preparation_releases_lock_without_committing() {
        let data = tempfile::tempdir().unwrap();
        let active = OnceLock::new();
        let prepared = prepare_startup_directory(&active, data.path(), "test.app", &[]).unwrap();
        let root = prepared.root().to_path_buf();
        let result = tokio::time::timeout(std::time::Duration::from_millis(1), async move {
            std::future::pending::<()>().await;
            drop(prepared);
        })
        .await;

        assert!(result.is_err());
        assert!(active.get().is_none());
        assert!(lease_root(root, None).is_ok());
    }

    #[test]
    fn abandoned_worker_result_drops_provisional_lock() {
        let data = tempfile::tempdir().unwrap();
        let active = OnceLock::new();
        let (sender, receiver) = std::sync::mpsc::channel();
        drop(receiver); // The caller timed out before blocking preflight finished.
        std::thread::scope(|scope| {
            scope
                .spawn(|| {
                    let prepared =
                        prepare_startup_directory(&active, data.path(), "test.app", &[]).unwrap();
                    assert!(sender.send(prepared).is_err());
                })
                .join()
                .unwrap();
        });

        assert!(active.get().is_none());
        let root = data.path().canonicalize().unwrap().join("native-browser");
        assert!(lease_root(root, None).is_ok());
    }

    #[test]
    fn cancelled_preparation_allows_repaired_location_on_next_startup() {
        let data = tempfile::tempdir().unwrap();
        let chosen = tempfile::tempdir().unwrap();
        let active = OnceLock::new();
        let prepared = prepare_startup_directory(&active, data.path(), "test.app", &[]).unwrap();
        let old_root = prepared.root().to_path_buf();
        drop(prepared);
        let state =
            save_location(data.path(), "test.app", Some(chosen.path().into()), None).unwrap();
        let mut next = prepare_startup_directory(&active, data.path(), "test.app", &[]).unwrap();
        assert_eq!(next.root(), Path::new(&state.effective_directory));
        assert_ne!(next.root(), old_root);
        assert!(lease_root(old_root, None).is_ok());
        next.commit().unwrap();
        assert_eq!(active.get().unwrap().root, next.root());
    }

    #[test]
    fn committed_root_and_lock_survive_guard_drop_and_reuse() {
        let data = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let active = OnceLock::new();
        let mut prepared =
            prepare_startup_directory(&active, data.path(), "test.app", &[]).unwrap();
        let root = prepared.root().to_path_buf();
        prepared.commit().unwrap();
        prepared.commit().unwrap();
        drop(prepared);
        assert_eq!(active.get().unwrap().root, root);
        assert!(lease_root(root.clone(), None).is_err());

        let reused = prepare_startup_directory(&active, other.path(), "test.app", &[]).unwrap();
        assert_eq!(reused.root(), root);
        assert!(reused.pending.is_none());
        drop(reused); // Even an abandoned borrower cannot release a committed lock.
        let mut reused = prepare_startup_directory(&active, other.path(), "test.app", &[]).unwrap();
        reused.commit().unwrap();
        drop(reused);
        assert!(!other.path().join("native-browser").exists());
        assert!(lease_root(root, None).is_err());
    }

    #[test]
    fn losing_preparation_never_changes_or_unlocks_another_committed_root() {
        let data = tempfile::tempdir().unwrap();
        let fallback = tempfile::tempdir().unwrap();
        let active = OnceLock::new();
        let mut first = prepare_startup_directory(&active, data.path(), "test.app", &[]).unwrap();
        let mut other =
            prepare_startup_directory(&active, data.path(), "test.app", &[fallback.path().into()])
                .unwrap();
        let first_root = first.root().to_path_buf();
        let other_root = other.root().to_path_buf();
        assert_ne!(first_root, other_root);
        fs::write(other_root.join("keep-existing-data"), b"keep").unwrap();
        first.commit().unwrap();
        assert!(other.commit().is_err());
        assert!(other.commit().is_err());
        assert!(lease_root(other_root.clone(), None).is_err());
        drop(other);
        drop(first);

        assert_eq!(active.get().unwrap().root, first_root);
        assert!(lease_root(first_root, None).is_err());
        assert_eq!(
            fs::read(other_root.join("keep-existing-data")).unwrap(),
            b"keep"
        );
        assert!(other_root.join(".sorng-browser.lock").is_file());
        assert!(lease_root(other_root, None).is_ok());
    }

    #[test]
    fn location_edit_during_preparation_is_reported_as_restart_after_commit() {
        let data = tempfile::tempdir().unwrap();
        let chosen = tempfile::tempdir().unwrap();
        let active = OnceLock::new();
        let mut prepared =
            prepare_startup_directory(&active, data.path(), "test.app", &[]).unwrap();
        let root = prepared.root().to_path_buf();
        let state =
            save_location(data.path(), "test.app", Some(chosen.path().into()), None).unwrap();
        assert!(!state.restart_required);
        assert!(state.active_directory.is_none());
        prepared.commit().unwrap();
        drop(prepared);

        let state = recovery_view(data.path(), "test.app", active.get()).unwrap();
        assert!(state.restart_required);
        assert_eq!(state.active_directory.as_deref(), root.to_str());
        assert_ne!(Path::new(&state.effective_directory), root);
        assert!(lease_root(root, None).is_err());
    }

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
        // Strict preparation still fails; startup recovery alone may choose a
        // working-data fallback without rewriting this saved preference.
        let recovered = prepare_with_fallbacks(&app_data, "test.app", &[]).unwrap();
        assert_eq!(recovered.root, root);
        assert_eq!(recovered.fallback_reason, Some(LOCATION_UNAVAILABLE));
        let state = recovery_view(&app_data, "test.app", Some(&recovered)).unwrap();
        assert_eq!(state.parent_directory.as_deref(), missing.to_str());
        assert!(state.fallback_reason.is_some());
        assert_eq!(state.active_directory.as_deref(), root.to_str());
        assert!(!missing.exists());
        assert_eq!(fs::read(app_data.join(CONFIG_FILE)).unwrap(), saved);
        assert!(
            !save_location(&app_data, "test.app", None, Some(&root))
                .unwrap()
                .restart_required
        );
    }

    #[test]
    fn startup_tries_app_local_then_app_scoped_alternatives_without_touching_collisions() {
        let data = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let collision = data.path().join("native-browser");
        fs::write(&collision, b"keep existing data").unwrap();
        let recovered =
            prepare_with_fallbacks(data.path(), "test.app", &[cache.path().into()]).unwrap();
        assert_eq!(
            recovered.root,
            cache.path().canonicalize().unwrap().join("native-browser")
        );
        assert!(recovered.fallback_reason.is_some());
        assert_eq!(fs::read(collision).unwrap(), b"keep existing data");
        assert!(!data.path().join(CONFIG_FILE).exists());
        assert_eq!(fs::read_dir(recovered.root).unwrap().count(), 1); // OS lease only.
    }

    #[test]
    fn corrupt_location_uses_checked_working_storage_without_replacing_the_config() {
        let data = tempfile::tempdir().unwrap();
        let corrupt = b"not valid location settings";
        fs::write(data.path().join(CONFIG_FILE), corrupt).unwrap();
        let recovered = prepare_with_fallbacks(data.path(), "test.app", &[]).unwrap();
        assert_eq!(recovered.fallback_reason, Some(SETTINGS_UNAVAILABLE));
        assert!(recovery_view(data.path(), "test.app", Some(&recovered)).is_ok());
        assert_eq!(fs::read(data.path().join(CONFIG_FILE)).unwrap(), corrupt);
    }

    #[test]
    fn exhausted_fallbacks_disable_browsing_without_deleting_or_panicking() {
        let data = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        for path in [data.path(), cache.path()] {
            fs::write(path.join("native-browser"), b"keep").unwrap();
        }
        let result = prepare_with_fallbacks(data.path(), "test.app", &[cache.path().into()]);
        assert_eq!(result.err().as_deref(), Some(NO_WRITABLE_ROOT));
        for path in [data.path(), cache.path()] {
            assert_eq!(fs::read(path.join("native-browser")).unwrap(), b"keep");
        }
    }

    #[test]
    fn healthy_custom_folder_wins_and_other_databases_are_never_searched() {
        let data = tempfile::tempdir().unwrap();
        let chosen = tempfile::tempdir().unwrap();
        let unused = data.path().join("unused-fallback");
        save_location(data.path(), "test.app", Some(chosen.path().into()), None).unwrap();
        let expected = prepare_root(
            data.path(),
            "test.app",
            &read_location(data.path()).unwrap(),
        )
        .unwrap();
        let prepared =
            prepare_with_fallbacks(data.path(), "test.app", std::slice::from_ref(&unused)).unwrap();
        assert_eq!(prepared.root, expected);
        assert_eq!(prepared.fallback_reason, None);
        assert!(!unused.exists());
        assert!(!data.path().join("native-browser").exists());
    }

    #[test]
    fn concurrent_startups_cannot_share_a_chromium_root_and_os_lease_is_released() {
        let data = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let first = prepare_with_fallbacks(data.path(), "test.app", &[]).unwrap();
        let second =
            prepare_with_fallbacks(data.path(), "test.app", &[cache.path().into()]).unwrap();
        assert_ne!(first.root, second.root);
        assert!(second.fallback_reason.is_some());
        assert!(prepare_with_fallbacks(data.path(), "test.app", &[cache.path().into()]).is_err());
        drop(first);
        let next = prepare_with_fallbacks(data.path(), "test.app", &[]).unwrap();
        assert_eq!(
            next.root,
            data.path().canonicalize().unwrap().join("native-browser")
        );
        assert!(next.fallback_reason.is_none());
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
        assert!(json.get("fallbackReason").unwrap().is_null());
        assert_eq!(json.as_object().unwrap().len(), 5);
    }
}
