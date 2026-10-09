//! Bounded, read-only diagnostics under roots supplied by trusted native code.
//! Filenames, never paths, cross the IPC boundary. No profile discovery here.
use serde::{Deserialize, Serialize};
use sorng_encryption::{database_protection::Zeroizing, envelope, EncryptionState};
use std::{
    fs::{self, File, Metadata, OpenOptions},
    io::{Read, Seek, SeekFrom},
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

const MAX_FILES: usize = 100;
const MAX_ENTRIES: usize = 20_000;
const TAIL_BYTES: usize = 256 * 1024;
const TAIL_LINES: usize = 2000;
const MAX_ENCRYPTED_BYTES: u64 = 64 * 1024 * 1024;
const INVALID: &str = "Log file is unavailable or is not an allowed regular file.";
const CHANGED: &str = "Log file changed while reading. Refresh and try again.";
const PROTECTION_CHANGED: &str =
    "Log protection changed while reading. Refresh after unlocking the app.";

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum LogSource {
    Application,
    Browser,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LogFile {
    pub id: String,
    pub name: String,
    pub modified_unix_ms: u64,
    pub size_bytes: u64,
    pub encrypted: bool,
}

#[derive(Debug, Serialize)]
pub(crate) struct LogList {
    pub files: Vec<LogFile>,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
pub(crate) struct LogRead {
    pub text: String,
    pub truncated: bool,
}

fn allowed_name(source: LogSource, name: &str) -> bool {
    match source {
        LogSource::Application => {
            let Some(date) = name.strip_prefix("encrypted-").and_then(|s| {
                s.strip_suffix(".log.enc")
                    .or_else(|| s.strip_suffix(".log"))
            }) else {
                return false;
            };
            let b = date.as_bytes();
            if b.len() != 10
                || b[4] != b'-'
                || b[7] != b'-'
                || !b
                    .iter()
                    .enumerate()
                    .all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit())
            {
                return false;
            }
            let year = date[..4].parse::<u32>().unwrap_or(0);
            let month = date[5..7].parse::<u32>().unwrap_or(0);
            let day = date[8..].parse::<u32>().unwrap_or(0);
            let days = match month {
                4 | 6 | 9 | 11 => 30,
                2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
                2 => 28,
                1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
                _ => 0,
            };
            year != 0 && day != 0 && day <= days
        }
        LogSource::Browser => name
            .strip_prefix("browser-startup-")
            .and_then(|s| s.strip_suffix(".jsonl"))
            .is_some_and(|id| id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit())),
    }
}

fn no_links(metadata: &Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return false;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // FILE_ATTRIBUTE_REPARSE_POINT, including junctions and cloud placeholders.
        if metadata.file_attributes() & 0x400 != 0 {
            return false;
        }
    }
    true
}

fn validate_log_path(root: &Path, path: &Path, allow_missing: bool) -> Result<(), String> {
    if !root.is_absolute()
        || !path.is_absolute()
        || path.strip_prefix(root).map_or(true, |relative| {
            relative
                .components()
                .any(|c| !matches!(c, Component::Normal(_)))
        })
        || path
            .components()
            .any(|c| matches!(c, Component::CurDir | Component::ParentDir))
    {
        return Err(INVALID.into());
    }
    #[cfg(windows)]
    {
        use std::path::Prefix;
        // Native roots may use canonical verbatim disk/UNC paths, but never
        // device namespaces. Preserve the path rather than changing its meaning
        // by stripping the verbatim prefix or normalizing names.
        match path.components().next() {
            Some(Component::Prefix(prefix))
                if matches!(
                    prefix.kind(),
                    Prefix::Disk(_)
                        | Prefix::VerbatimDisk(_)
                        | Prefix::UNC(_, _)
                        | Prefix::VerbatimUNC(_, _)
                ) => {}
            _ => return Err(INVALID.into()),
        }
    }
    // Inspect actual filesystem ancestors, not incremental path components:
    // canonical Windows paths start with `\\?\C:` which is NOT a stat-able
    // directory until the root separator is present. `ancestors()` includes
    // `\\?\C:\` and every real directory, never that incomplete prefix.
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(metadata) => {
                if !no_links(&metadata)
                    || if ancestor == path && path != root {
                        !metadata.is_file()
                    } else {
                        !metadata.is_dir()
                    }
                {
                    return Err(INVALID.into());
                }
            }
            Err(error)
                if allow_missing
                    && ancestor == path
                    && error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(INVALID.into()),
        }
    }
    Ok(())
}

fn checked_path(root: &Path, name: &str) -> Result<PathBuf, String> {
    let path = root.join(name);
    validate_log_path(root, &path, false)?;
    let canonical_root = fs::canonicalize(root).map_err(|_| INVALID)?;
    let canonical_file = fs::canonicalize(&path).map_err(|_| INVALID)?;
    if canonical_file.parent() != Some(canonical_root.as_path()) {
        return Err(INVALID.into());
    }
    Ok(path)
}

fn open_regular(path: &Path) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // Inspect the link itself, never follow a final-component reparse point.
        options.custom_flags(0x0020_0000); // FILE_FLAG_OPEN_REPARSE_POINT
    }
    let file = options.open(path).map_err(|_| INVALID)?;
    let metadata = file.metadata().map_err(|_| INVALID)?;
    if !metadata.is_file() || !no_links(&metadata) || identity(&file)?.2 != 1 {
        return Err(INVALID.into());
    }
    Ok(file)
}

#[cfg(unix)]
fn identity(file: &File) -> Result<(u64, u64, u64), String> {
    use std::os::unix::fs::MetadataExt;
    let m = file.metadata().map_err(|_| INVALID)?;
    Ok((m.dev(), m.ino(), m.nlink()))
}

#[cfg(windows)]
fn identity(file: &File) -> Result<(u64, u64, u64), String> {
    use std::{ffi::c_void, os::windows::io::AsRawHandle};
    // BY_HANDLE_FILE_INFORMATION. Using the native handle avoids pathname
    // metadata following a replacement link and also detects hard links.
    #[repr(C)]
    struct Information {
        attributes: u32,
        times: [u32; 6],
        volume: u32,
        size_high: u32,
        size_low: u32,
        links: u32,
        index_high: u32,
        index_low: u32,
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetFileInformationByHandle(handle: *mut c_void, info: *mut Information) -> i32;
    }
    let mut info = std::mem::MaybeUninit::<Information>::uninit();
    // SAFETY: File retains a valid handle; the OS initializes this correctly
    // sized C-layout output on success. No ownership passes to the OS.
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), info.as_mut_ptr()) } == 0 {
        return Err(INVALID.into());
    }
    let info = unsafe { info.assume_init() };
    Ok((
        u64::from(info.volume),
        (u64::from(info.index_high) << 32) | u64::from(info.index_low),
        u64::from(info.links),
    ))
}

fn verify_handle(root: &Path, name: &str, file: &File) -> Result<(), String> {
    let current = open_regular(&checked_path(root, name)?)?;
    if identity(file)? != identity(&current)? {
        return Err(CHANGED.into());
    }
    Ok(())
}

fn encrypted_header(file: &mut File, name: &str) -> Result<bool, String> {
    let mut prefix = Vec::with_capacity(envelope::MAGIC.len());
    (&mut *file)
        .take(envelope::MAGIC.len() as u64)
        .read_to_end(&mut prefix)
        .map_err(|_| INVALID)?;
    file.seek(SeekFrom::Start(0)).map_err(|_| INVALID)?;
    Ok(name.ends_with(".enc") || prefix.as_slice() == envelope::MAGIC)
}

/// Caller runs listing on a blocking worker. Missing log directories are empty;
/// malformed roots and path/link entries never become IPC-readable IDs.
pub(crate) fn list(root: &Path, source: LogSource) -> Result<LogList, String> {
    let mut result = LogList {
        files: Vec::new(),
        truncated: false,
    };
    validate_log_path(root, root, true)?;
    let metadata = match fs::symlink_metadata(root) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(result),
        other => other.map_err(|_| INVALID)?,
    };
    if !metadata.is_dir() || !no_links(&metadata) {
        return Err(INVALID.into());
    }
    for (index, entry) in fs::read_dir(root).map_err(|_| INVALID)?.enumerate() {
        if index == MAX_ENTRIES {
            result.truncated = true;
            break;
        }
        let entry = entry.map_err(|_| INVALID)?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if !allowed_name(source, &name) {
            continue;
        }
        let Ok(path) = checked_path(root, &name) else {
            continue;
        };
        let Ok(mut file) = open_regular(&path) else {
            continue;
        };
        if verify_handle(root, &name, &file).is_err() {
            continue;
        }
        let metadata = file.metadata().map_err(|_| INVALID)?;
        let modified_unix_ms = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis().min(u128::from(u64::MAX)) as u64)
            .unwrap_or(0);
        let encrypted = encrypted_header(&mut file, &name)?;
        result.files.push(LogFile {
            id: name.clone(),
            name,
            modified_unix_ms,
            size_bytes: metadata.len(),
            encrypted,
        });
        result.files.sort_by(|a, b| {
            b.modified_unix_ms
                .cmp(&a.modified_unix_ms)
                .then_with(|| b.id.cmp(&a.id))
        });
        if result.files.len() > MAX_FILES {
            result.files.pop();
            result.truncated = true;
        }
    }
    validate_log_path(root, root, false)?;
    Ok(result)
}

fn tail(bytes: &[u8], already_truncated: bool) -> Result<LogRead, String> {
    let mut start = bytes.len().saturating_sub(TAIL_BYTES);
    // A byte tail may start within a UTF-8 scalar; skip continuation bytes.
    if start != 0 || already_truncated {
        while start < bytes.len() && bytes[start] & 0xc0 == 0x80 {
            start += 1;
        }
    }
    let mut lines = 0;
    for i in (start..bytes.len()).rev() {
        if bytes[i] == b'\n' && i + 1 < bytes.len() {
            lines += 1;
            if lines == TAIL_LINES {
                start = i + 1;
                break;
            }
        }
    }
    let text = std::str::from_utf8(&bytes[start..])
        .map_err(|_| "Log file is not valid UTF-8 text.")?
        .to_owned();
    Ok(LogRead {
        text,
        truncated: already_truncated || start != 0,
    })
}

pub(crate) async fn read(
    root: &Path,
    source: LogSource,
    id: &str,
    state: &EncryptionState,
) -> Result<LogRead, String> {
    if !allowed_name(source, id) {
        return Err(INVALID.into());
    }
    let generation = state.key_generation();
    let owned_state = state.clone();
    let root = root.to_path_buf();
    let name = id.to_owned();
    let runtime = tokio::runtime::Handle::current();
    let (result, encrypted) = tokio::task::spawn_blocking(move || -> Result<_, String> {
        if owned_state.key_generation() != generation {
            return Err(PROTECTION_CHANGED.into());
        }
        let mut file = open_regular(&checked_path(&root, &name)?)?;
        verify_handle(&root, &name, &file)?;
        let before = file.metadata().map_err(|_| INVALID)?;
        let encrypted = encrypted_header(&mut file, &name)?;
        let offset = if encrypted {
            if before.len() > MAX_ENCRYPTED_BYTES {
                return Err("Encrypted log exceeds the 64 MiB read limit.".into());
            }
            if !runtime.block_on(owned_state.is_unlocked()) {
                return Err("Unlock the app to read encrypted logs.".into());
            }
            0
        } else {
            before.len().saturating_sub(TAIL_BYTES as u64 + 3)
        };
        file.seek(SeekFrom::Start(offset)).map_err(|_| INVALID)?;
        let mut bytes = Zeroizing::new(Vec::new());
        (&mut file)
            .take(before.len() - offset)
            .read_to_end(&mut bytes)
            .map_err(|_| INVALID)?;
        if bytes.len() as u64 != before.len() - offset {
            return Err(CHANGED.into());
        }
        let result = if encrypted {
            if !bytes.starts_with(envelope::MAGIC) {
                return Err("Encrypted log authentication failed.".into());
            }
            let plaintext = Zeroizing::new(
                runtime
                    .block_on(crate::artifact_storage_adapters::decode_logs(
                        &owned_state,
                        &bytes,
                    ))
                    .map_err(|error| {
                        if error == "log has too many envelope boundaries to inspect safely" {
                            "Encrypted log exceeds the safe envelope-boundary read limit."
                        } else {
                            "Encrypted log authentication failed or the log is incomplete."
                        }
                    })?,
            );
            tail(&plaintext, false)?
        } else {
            tail(&bytes, offset != 0)?
        };
        verify_handle(&root, &name, &file)?;
        let after = file.metadata().map_err(|_| INVALID)?;
        if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
            return Err(CHANGED.into());
        }
        let locked = encrypted && !runtime.block_on(owned_state.is_unlocked());
        if locked || owned_state.key_generation() != generation {
            return Err(PROTECTION_CHANGED.into());
        }
        Ok((result, encrypted))
    })
    .await
    .map_err(|_| "Log reading could not complete.".to_owned())??;
    let locked = encrypted && !state.is_unlocked().await;
    if locked || state.key_generation() != generation {
        return Err(PROTECTION_CHANGED.into());
    }
    Ok(result)
}
