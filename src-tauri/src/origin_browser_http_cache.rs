//! Per-connection HTTP disk cache directories for native browser attempts
//! (t-cefiso C-H4). Chromium owns the cache contents and follows the sites'
//! cache headers; this module owns only where a connection's cache lives,
//! whether it may be used, and when it is deleted.
//!
//! Layout under the committed browser root (never synced, backed up or
//! exported; see `CACHEDIR.TAG`):
//!
//! ```text
//! <root>/http-cache/CACHEDIR.TAG
//! <root>/http-cache/<dbKey>/<connKey>/binding.v1      JSON {v, bindingDigest, createdAt, lastUsedAt}
//! <root>/http-cache/<dbKey>/<connKey>/net/Cache/...   Chromium-owned
//! <root>/http-cache/<dbKey>/<connKey>.delete-pending  tombstone while leased
//! <root>/http-cache/.trash-*                          deletion in progress
//! ```
//!
//! Keys are truncated SHA-256 digests of the authorised database and
//! connection ids, so no saved identifier appears on disk. One live attempt
//! per connection holds the directory (a lease); the lease ends only when the
//! engine reports that the NetworkContext holding it is gone (state 7).
//! Housekeeping never follows links and never touches anything outside
//! `<root>/http-cache`.

use sha2::{Digest, Sha256};
use sorng_browser_host::cef_http_cache::{
    HttpCacheReleaseSignal, HttpDiskCacheSpec, HTTP_CACHE_DIRECTORY_NAME,
};
use std::collections::HashMap;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const KEY_DOMAIN: &[u8] = b"sorng-http-cache-v1\0";
const KEY_HEX: usize = 32;
const MAX_ID_BYTES: usize = 1024;
pub(crate) const BINDING: &str = "binding.v1";
const BINDING_TEMPORARY: &str = "binding.v1.tmp";
const BINDING_MAX_BYTES: u64 = 4096;
pub(crate) const NET: &str = "net";
pub(crate) const TAG_NAME: &str = "CACHEDIR.TAG";
const TAG: &[u8] = b"Signature: 8a477f597d28d172789f06886806bc55\n\
# This directory holds sortOfRemoteNG device-local browser HTTP caches.\n\
# It is never synced or backed up. See https://bford.info/cachedir/\n";
pub(crate) const TOMBSTONE: &str = ".delete-pending";
const TRASH: &str = ".trash-";
/// Unleased caches unused for this long are deleted (the cookie max age).
pub(crate) const IDLE_LIMIT: Duration = Duration::from_secs(30 * 24 * 60 * 60);
/// Periodic housekeeping cadence; it also runs at start and after a release.
pub(crate) const HOUSEKEEPING_INTERVAL: Duration = Duration::from_secs(60 * 60);
const MIB: u64 = 1024 * 1024;
const DEFAULT_TOTAL_BYTES: u64 = 1024 * MIB;
const MAX_DEPTH: usize = 32;

/// Why no disk cache is available, in the C-H5 `reason` spelling.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Unavailable {
    Disabled,
    NotLocal,
    EngineUnsupported,
    Runtime,
}

impl Unavailable {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::NotLocal => "cache-location-not-local",
            Self::EngineUnsupported => "engine-unsupported",
            Self::Runtime => "unavailable",
        }
    }
}

/// Why an attempt was refused the disk cache; it then uses memory.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Refusal {
    Unavailable(Unavailable),
    /// Another live attempt of this connection holds the directory.
    InUse,
    /// A clear is waiting for the previous holder to release it.
    DeletePending,
    /// The directory could not be prepared safely (IO, links, ACL).
    Storage,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct ClearOutcome {
    /// Cache data existed and was deleted.
    pub cleared: bool,
    /// A leased directory is marked and is deleted when released or on start.
    pub pending: bool,
}

impl ClearOutcome {
    fn merge(&mut self, other: Self) {
        self.cleared |= other.cleared;
        self.pending |= other.pending;
    }
}

fn key(parts: &[&str]) -> Option<String> {
    if parts
        .iter()
        .any(|part| part.is_empty() || part.len() > MAX_ID_BYTES || part.contains('\0'))
    {
        return None;
    }
    let mut digest = Sha256::new();
    digest.update(KEY_DOMAIN);
    for (index, part) in parts.iter().enumerate() {
        if index > 0 {
            digest.update([0]);
        }
        digest.update(part.as_bytes());
    }
    let mut text = format!("{:x}", digest.finalize());
    text.truncate(KEY_HEX);
    Some(text)
}

/// `hex(sha256("sorng-http-cache-v1\0" || databaseId))[..32]`; None for an
/// empty, oversized or NUL-bearing id (NUL is the field separator).
pub(crate) fn database_key(database: &str) -> Option<String> {
    key(&[database])
}

/// `hex(sha256("sorng-http-cache-v1\0" || databaseId || "\0" || connectionId))[..32]`.
pub(crate) fn connection_key(database: &str, connection: &str) -> Option<String> {
    key(&[database, connection])
}

fn is_key(name: &str) -> bool {
    name.len() == KEY_HEX && name.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

pub(crate) fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs())
}

#[derive(serde::Serialize, serde::Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Binding {
    v: u8,
    binding_digest: String,
    created_at: u64,
    last_used_at: u64,
}

fn is_link(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // FILE_ATTRIBUTE_REPARSE_POINT: junctions, mount points, placeholders.
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    false
}

fn plain_dir(path: &Path) -> io::Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => Ok(metadata.is_dir() && !is_link(&metadata)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

fn plain_file(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|metadata| metadata.is_file() && !is_link(&metadata))
}

fn refused() -> io::Error {
    io::Error::other("http cache entry is a link, not a directory, or not private")
}

/// Creates (owner-only on Unix) or accepts an existing plain directory.
fn ensure_dir(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() && !is_link(&metadata) => return Ok(()),
        Ok(_) => return Err(refused()),
        Err(error) if error.kind() != io::ErrorKind::NotFound => return Err(error),
        Err(_) => (),
    }
    #[cfg(unix)]
    let created = {
        use std::os::unix::fs::DirBuilderExt;
        fs::DirBuilder::new().mode(0o700).create(path)
    };
    #[cfg(not(unix))]
    let created = fs::create_dir(path);
    match created {
        Ok(()) => (),
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => (),
        Err(error) => return Err(error),
    }
    if plain_dir(path)? {
        Ok(())
    } else {
        Err(refused())
    }
}

/// Size of a tree in bytes, counting no link targets.
fn tree_bytes(path: &Path) -> u64 {
    fn walk(path: &Path, depth: usize) -> u64 {
        let Ok(metadata) = fs::symlink_metadata(path) else {
            return 0;
        };
        if is_link(&metadata) {
            return 0;
        }
        if metadata.is_file() {
            return metadata.len();
        }
        if !metadata.is_dir() || depth >= MAX_DEPTH {
            return 0;
        }
        fs::read_dir(path).map_or(0, |entries| {
            entries
                .flatten()
                .map(|entry| walk(&entry.path(), depth + 1))
                .fold(0u64, u64::saturating_add)
        })
    }
    walk(path, 0)
}

/// Windows paths at the CEF boundary are ordinary drive paths: the engine
/// rejects verbatim (`\\?\`) and UNC spellings of the cache directory.
fn ordinary(path: &Path) -> Option<PathBuf> {
    #[cfg(windows)]
    {
        let text = path.to_str()?;
        let plain = text.strip_prefix(r"\\?\").unwrap_or(text);
        let bytes = plain.as_bytes();
        if plain.contains('/')
            || bytes.len() < 3
            || !bytes[0].is_ascii_alphabetic()
            || bytes[1] != b':'
            || bytes[2] != b'\\'
        {
            return None;
        }
        Some(PathBuf::from(plain))
    }
    #[cfg(not(windows))]
    {
        path.is_absolute().then(|| path.to_path_buf())
    }
}

#[cfg(windows)]
mod acl {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;

    #[link(name = "advapi32")]
    extern "system" {
        fn GetNamedSecurityInfoW(
            name: *const u16,
            object_type: u32,
            information: u32,
            owner: *mut *mut c_void,
            group: *mut *mut c_void,
            dacl: *mut *mut c_void,
            sacl: *mut *mut c_void,
            descriptor: *mut *mut c_void,
        ) -> u32;
        fn GetAce(acl: *const c_void, index: u32, ace: *mut *mut c_void) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn LocalFree(memory: *mut c_void) -> *mut c_void;
    }

    const SE_FILE_OBJECT: u32 = 1;
    const DACL_SECURITY_INFORMATION: u32 = 4;
    const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;
    // S-1-1-0 Everyone, S-1-5-11 Authenticated Users, S-1-5-32-545 Users.
    const BROAD: [&[u8]; 3] = [
        &[1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
        &[1, 1, 0, 0, 0, 0, 0, 5, 11, 0, 0, 0],
        &[1, 2, 0, 0, 0, 0, 0, 5, 32, 0, 0, 0, 0x21, 0x02, 0, 0],
    ];

    /// True when an allow ACE names Everyone, Authenticated Users or Users.
    /// Capability SIDs (such as the network sandbox's LPAC grant on
    /// `net/Cache`) and the user's own SIDs are not broad.
    pub(super) fn broad(aces: &[Vec<u8>]) -> bool {
        aces.iter().any(|ace| {
            ace.len() >= 8
                && ace[0] == ACCESS_ALLOWED_ACE_TYPE
                && BROAD.iter().any(|sid| ace[8..].starts_with(sid))
        })
    }

    /// The DACL's ACEs, or None for a NULL DACL (everyone has full access).
    fn aces(path: &Path) -> Result<Option<Vec<Vec<u8>>>, ()> {
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let mut dacl = std::ptr::null_mut();
        let mut descriptor = std::ptr::null_mut();
        // SAFETY: valid NUL-terminated path and out-pointers; the descriptor
        // owns the DACL and is released with LocalFree below.
        let status = unsafe {
            GetNamedSecurityInfoW(
                wide.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut dacl,
                std::ptr::null_mut(),
                &mut descriptor,
            )
        };
        if status != 0 {
            return Err(());
        }
        let result = if dacl.is_null() {
            Ok(None)
        } else {
            // SAFETY: an ACL header is 8 bytes; AceCount is the u16 at 4.
            let count = unsafe { std::ptr::read_unaligned(dacl.cast::<u8>().add(4).cast::<u16>()) };
            let mut list = Vec::with_capacity(count.into());
            let mut failed = false;
            for index in 0..u32::from(count) {
                let mut ace = std::ptr::null_mut();
                // SAFETY: index < AceCount of this DACL.
                if unsafe { GetAce(dacl, index, &mut ace) } == 0 || ace.is_null() {
                    failed = true;
                    break;
                }
                // SAFETY: ACE_HEADER.AceSize (u16 at 2) bounds the ACE.
                let size = unsafe { std::ptr::read_unaligned(ace.cast::<u8>().add(2).cast::<u16>()) };
                // SAFETY: GetAce returned an ACE of `size` bytes inside the DACL.
                list.push(unsafe { std::slice::from_raw_parts(ace.cast::<u8>(), size.into()) }.to_vec());
            }
            if failed {
                Err(())
            } else {
                Ok(Some(list))
            }
        };
        // SAFETY: allocated by GetNamedSecurityInfoW.
        unsafe { LocalFree(descriptor) };
        result
    }

    pub(super) fn private(path: &Path) -> bool {
        matches!(aces(path), Ok(Some(list)) if !broad(&list))
    }
}

/// The directory grants no broad access: on Windows no allow ACE for
/// Everyone, Authenticated Users or Users (created directories inherit the
/// local-data owner-only ACL); on Unix mode 0700, tightened if needed.
fn private_dir(path: &Path) -> bool {
    #[cfg(windows)]
    {
        acl::private(path)
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let Ok(metadata) = fs::symlink_metadata(path) else {
            return false;
        };
        if metadata.permissions().mode() & 0o077 == 0 {
            return true;
        }
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).is_ok()
            && fs::symlink_metadata(path).is_ok_and(|m| m.permissions().mode() & 0o077 == 0)
    }
    #[cfg(not(any(windows, unix)))]
    {
        let _ = path;
        false
    }
}

fn read_binding(directory: &Path) -> Option<Binding> {
    let path = directory.join(BINDING);
    if !plain_file(&path) {
        return None;
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .ok()?
        .take(BINDING_MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > BINDING_MAX_BYTES {
        return None;
    }
    let binding: Binding = serde_json::from_slice(&bytes).ok()?;
    (binding.v == 1
        && binding.binding_digest.len() == 64
        && binding.binding_digest.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')))
    .then_some(binding)
}

fn write_binding(directory: &Path, binding: &Binding) -> io::Result<()> {
    let temporary = directory.join(BINDING_TEMPORARY);
    match fs::symlink_metadata(&temporary) {
        Ok(metadata) if metadata.is_file() && !is_link(&metadata) => fs::remove_file(&temporary)?,
        Ok(_) => return Err(refused()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => (),
        Err(error) => return Err(error),
    }
    let bytes = serde_json::to_vec(binding).map_err(io::Error::other)?;
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    drop(file);
    let target = directory.join(BINDING);
    if fs::symlink_metadata(&target).is_ok_and(|metadata| !metadata.is_file() || is_link(&metadata)) {
        let _ = fs::remove_file(&temporary);
        return Err(refused());
    }
    fs::rename(&temporary, target)
}

type Released = Box<dyn Fn() -> bool + Send>;

struct LeaseEntry {
    id: u64,
    released: Option<Released>,
}

/// The leases of one cache root. This is the only cache state the CEF UI
/// thread touches (lease attach and drop): a leaf lock that is never held
/// across filesystem IO, so those paths never wait on a directory walk.
#[derive(Default)]
pub(crate) struct LeaseTable {
    entries: HashMap<(String, String), LeaseEntry>,
    next: u64,
    /// A lease ended by drop (no engine signal): housekeeping is due.
    dropped: bool,
}

type Leases = Arc<Mutex<LeaseTable>>;

fn table(leases: &Leases) -> MutexGuard<'_, LeaseTable> {
    leases.lock().unwrap_or_else(|error| error.into_inner())
}

/// Filesystem state of one `<root>/http-cache`. Methods that delete return the
/// trash they renamed aside; the caller removes it outside any shared lock.
/// Callers serialize these methods (`&mut self`); the lease table inside is
/// shared with live `CacheLease`s and locked only briefly, never across IO.
pub(crate) struct CacheStore {
    root: PathBuf,
    leases: Leases,
    trash: u64,
    total_limit: u64,
    #[cfg(test)]
    pause: Option<Box<dyn Fn() + Send>>,
}

impl CacheStore {
    /// Opens (creating) `<data_root>/http-cache` with its CACHEDIR.TAG. The
    /// directory must be a plain, private directory.
    pub(crate) fn open(data_root: &Path) -> io::Result<Self> {
        let data_root = ordinary(data_root).ok_or_else(refused)?;
        if !plain_dir(&data_root)? {
            return Err(refused());
        }
        let root = data_root.join(HTTP_CACHE_DIRECTORY_NAME);
        ensure_dir(&root)?;
        if !private_dir(&root) {
            return Err(refused());
        }
        let store = Self {
            root,
            leases: Arc::default(),
            trash: 0,
            total_limit: DEFAULT_TOTAL_BYTES,
            #[cfg(test)]
            pause: None,
        };
        store.write_tag()?;
        #[cfg(target_os = "macos")]
        {
            // Best effort Time Machine exclusion (sticky xattr); never fatal.
            let _ = std::process::Command::new("/usr/bin/tmutil")
                .arg("addexclusion")
                .arg(&store.root)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();
        }
        Ok(store)
    }

    #[cfg(test)]
    pub(crate) fn root(&self) -> &Path {
        &self.root
    }

    fn write_tag(&self) -> io::Result<()> {
        let path = self.root.join(TAG_NAME);
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.is_file() && !is_link(&metadata) => {
                if fs::read(&path).is_ok_and(|bytes| bytes == TAG) {
                    return Ok(());
                }
                fs::remove_file(&path)?;
            }
            Ok(metadata) if metadata.is_dir() && !is_link(&metadata) => fs::remove_dir_all(&path)?,
            Ok(_) => fs::remove_file(&path).or_else(|_| fs::remove_dir(&path))?,
            Err(error) if error.kind() == io::ErrorKind::NotFound => (),
            Err(error) => return Err(error),
        }
        let mut file = fs::OpenOptions::new().create_new(true).write(true).open(&path)?;
        file.write_all(TAG)?;
        file.sync_all()
    }

    fn keys(database: &str, connection: &str) -> Option<(String, String)> {
        Some((database_key(database)?, connection_key(database, connection)?))
    }

    fn directory(&self, key: &(String, String)) -> PathBuf {
        self.root.join(&key.0).join(&key.1)
    }

    fn tombstone(&self, key: &(String, String)) -> PathBuf {
        self.root.join(&key.0).join(format!("{}{TOMBSTONE}", key.1))
    }

    /// Renames an entry aside for deletion; a link is removed, never followed.
    fn discard(&mut self, path: &Path, trash: &mut Vec<PathBuf>) -> io::Result<bool> {
        let metadata = match fs::symlink_metadata(path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error),
        };
        if is_link(&metadata) {
            fs::remove_dir(path).or_else(|_| fs::remove_file(path))?;
            return Ok(true);
        }
        if !metadata.is_dir() {
            fs::remove_file(path)?;
            return Ok(true);
        }
        self.trash += 1;
        let aside = self.root.join(format!(
            "{TRASH}{}-{}-{}",
            std::process::id(),
            now_seconds(),
            self.trash
        ));
        match fs::rename(path, &aside) {
            Ok(()) => trash.push(aside),
            // Not renameable (another volume, a busy handle): delete in place.
            Err(_) => fs::remove_dir_all(path)?,
        }
        Ok(true)
    }

    fn is_leased(&self, key: &(String, String)) -> bool {
        table(&self.leases).entries.contains_key(key)
    }

    #[cfg(test)]
    pub(crate) fn leased(&self, database: &str, connection: &str) -> bool {
        Self::keys(database, connection).is_some_and(|key| self.is_leased(&key))
    }

    /// The lease handle for an `acquire` result. It shares only the lease
    /// table, so attaching or dropping it never waits for this store's IO.
    pub(crate) fn lease(&self, key: (String, String), id: u64, spec: HttpDiskCacheSpec) -> CacheLease {
        CacheLease {
            leases: self.leases.clone(),
            key,
            id,
            spec,
            attached: false,
        }
    }

    /// Prepares the connection directory and takes its lease. A binding
    /// mismatch (security, trust or route change) wipes `net/` first.
    pub(crate) fn acquire(
        &mut self,
        database: &str,
        connection: &str,
        binding: &[u8; 32],
        total_bytes: u64,
        now: u64,
        trash: &mut Vec<PathBuf>,
    ) -> Result<((String, String), u64, PathBuf), Refusal> {
        let key = Self::keys(database, connection).ok_or(Refusal::Storage)?;
        if self.is_leased(&key) {
            return Err(Refusal::InUse);
        }
        if fs::symlink_metadata(self.tombstone(&key)).is_ok() {
            return Err(Refusal::DeletePending);
        }
        self.total_limit = total_bytes;
        let storage = |_| Refusal::Storage;
        ensure_dir(&self.root.join(&key.0)).map_err(storage)?;
        let directory = self.directory(&key);
        ensure_dir(&directory).map_err(storage)?;
        if !private_dir(&directory) {
            return Err(Refusal::Storage);
        }
        let digest = hex::encode(binding);
        let created_at = match read_binding(&directory) {
            Some(existing) if existing.binding_digest == digest => existing.created_at,
            _ => {
                // Never reuse content cached under another trust/route binding.
                self.discard(&directory.join(NET), trash).map_err(storage)?;
                now
            }
        };
        // Chromium must never be handed a linked or non-directory net/.
        let net = directory.join(NET);
        if fs::symlink_metadata(&net).is_ok() && !plain_dir(&net).map_err(storage)? {
            self.discard(&net, trash).map_err(storage)?;
        }
        write_binding(
            &directory,
            &Binding {
                v: 1,
                binding_digest: digest,
                created_at,
                last_used_at: now,
            },
        )
        .map_err(storage)?;
        let mut leases = table(&self.leases);
        leases.next += 1;
        let id = leases.next;
        leases.entries.insert(key.clone(), LeaseEntry { id, released: None });
        Ok((key, id, directory))
    }

    /// Keeps the lease until the engine's release signal fires.
    #[cfg(test)]
    pub(crate) fn attach(&self, key: &(String, String), id: u64, released: Released) {
        attach_lease(&self.leases, key, id, released);
    }

    /// Ends a lease that never reached the engine, or whose context fell back
    /// to memory. Returns whether that exact lease was held.
    pub(crate) fn release(&self, key: &(String, String), id: u64) -> bool {
        release_lease(&self.leases, key, id)
    }

    /// Removes leases whose engine release signal fired and stamps their use.
    /// Returns how many leases ended since the last call, including drops.
    pub(crate) fn take_released(&mut self, now: u64) -> usize {
        let (released, dropped) = {
            let mut leases = table(&self.leases);
            let released: Vec<_> = leases
                .entries
                .iter()
                .filter(|(_, entry)| entry.released.as_ref().is_some_and(|released| released()))
                .map(|(key, _)| key.clone())
                .collect();
            for key in &released {
                leases.entries.remove(key);
            }
            (released, std::mem::take(&mut leases.dropped))
        };
        // Lease table unlocked: binding IO never blocks attach or drop.
        for key in &released {
            let directory = self.directory(key);
            if let Some(mut binding) = read_binding(&directory) {
                binding.last_used_at = binding.last_used_at.max(now);
                let _ = write_binding(&directory, &binding);
            }
        }
        released.len() + usize::from(dropped)
    }

    fn clear_key(&mut self, key: &(String, String), trash: &mut Vec<PathBuf>) -> io::Result<ClearOutcome> {
        let tombstone = self.tombstone(key);
        if self.is_leased(key) {
            if !plain_file(&tombstone) {
                self.discard(&tombstone, trash)?;
                fs::OpenOptions::new().create_new(true).write(true).open(&tombstone)?;
            }
            return Ok(ClearOutcome { cleared: false, pending: true });
        }
        let cleared = self.discard(&self.directory(key), trash)?;
        self.discard(&tombstone, trash)?;
        Ok(ClearOutcome { cleared, pending: false })
    }

    pub(crate) fn clear_connection(
        &mut self,
        database: &str,
        connection: &str,
        trash: &mut Vec<PathBuf>,
    ) -> io::Result<ClearOutcome> {
        let Some(key) = Self::keys(database, connection) else {
            return Ok(ClearOutcome::default());
        };
        if !plain_dir(&self.root.join(&key.0))? {
            return Ok(ClearOutcome::default());
        }
        let outcome = self.clear_key(&key, trash)?;
        let _ = fs::remove_dir(self.root.join(&key.0));
        Ok(outcome)
    }

    fn clear_database_key(&mut self, database: &str, trash: &mut Vec<PathBuf>) -> io::Result<ClearOutcome> {
        let path = self.root.join(database);
        if !plain_dir(&path)? {
            return Ok(ClearOutcome {
                cleared: self.discard(&path, trash)?,
                pending: false,
            });
        }
        if !table(&self.leases).entries.keys().any(|(owner, _)| owner == database) {
            return Ok(ClearOutcome {
                cleared: self.discard(&path, trash)?,
                pending: false,
            });
        }
        let mut outcome = ClearOutcome::default();
        for entry in fs::read_dir(&path)?.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let connection = name.strip_suffix(TOMBSTONE).unwrap_or(&name);
            if is_key(connection) {
                let key = (database.to_owned(), connection.to_owned());
                outcome.merge(self.clear_key(&key, trash)?);
            } else {
                outcome.cleared |= self.discard(&entry.path(), trash)?;
            }
        }
        Ok(outcome)
    }

    pub(crate) fn clear_database(&mut self, database: &str, trash: &mut Vec<PathBuf>) -> io::Result<ClearOutcome> {
        let Some(key) = database_key(database) else {
            return Ok(ClearOutcome::default());
        };
        self.clear_database_key(&key, trash)
    }

    pub(crate) fn clear_all(&mut self, trash: &mut Vec<PathBuf>) -> io::Result<ClearOutcome> {
        let mut outcome = ClearOutcome::default();
        for entry in fs::read_dir(&self.root)?.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == TAG_NAME {
                continue;
            }
            if is_key(&name) {
                outcome.merge(self.clear_database_key(&name, trash)?);
            } else {
                outcome.cleared |= self.discard(&entry.path(), trash)?;
            }
        }
        self.write_tag()?;
        Ok(outcome)
    }

    pub(crate) fn usage(&self, entry: Option<(&str, &str)>) -> u64 {
        match entry {
            None => tree_bytes(&self.root),
            Some((database, connection)) => Self::keys(database, connection)
                .map_or(0, |key| tree_bytes(&self.directory(&key))),
        }
    }

    /// Retries tombstones, deletes idle (30 d), malformed and unknown entries,
    /// then evicts the least recently used unleased caches above the global
    /// limit. Never follows links; never leaves `<root>/http-cache`.
    pub(crate) fn housekeeping(&mut self, now: u64, trash: &mut Vec<PathBuf>) -> io::Result<()> {
        if !plain_dir(&self.root)? {
            return Err(refused());
        }
        #[cfg(test)]
        if let Some(pause) = &self.pause {
            pause();
        }
        self.write_tag()?;
        let idle = IDLE_LIMIT.as_secs();
        let mut candidates = Vec::new();
        let mut total = 0u64;
        for entry in fs::read_dir(&self.root)?.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = entry.path();
            if name == TAG_NAME {
                continue;
            }
            if !is_key(&name) || !plain_dir(&path)? {
                self.discard(&path, trash)?;
                continue;
            }
            let database = name;
            let children: Vec<_> = fs::read_dir(&path)?.flatten().collect();
            // Tombstones first: their directories must not be counted below.
            for child in &children {
                let child_name = child.file_name().to_string_lossy().into_owned();
                if let Some(connection) = child_name.strip_suffix(TOMBSTONE) {
                    let key = (database.clone(), connection.to_owned());
                    if !is_key(connection) || !plain_file(&child.path()) {
                        self.discard(&child.path(), trash)?;
                    } else if !self.is_leased(&key) {
                        self.discard(&self.directory(&key), trash)?;
                        self.discard(&child.path(), trash)?;
                    }
                }
            }
            for child in children {
                let child_name = child.file_name().to_string_lossy().into_owned();
                let child_path = child.path();
                if child_name.ends_with(TOMBSTONE) {
                    continue;
                }
                if !is_key(&child_name) || !plain_dir(&child_path)? {
                    self.discard(&child_path, trash)?;
                    continue;
                }
                let key = (database.clone(), child_name);
                let leased = self.is_leased(&key);
                if !leased {
                    // Only the binding and Chromium's net/ belong here.
                    for inner in fs::read_dir(&child_path)?.flatten() {
                        let inner_name = inner.file_name();
                        let kept = inner_name == BINDING
                            || (inner_name == NET && plain_dir(&inner.path())?);
                        if !kept {
                            self.discard(&inner.path(), trash)?;
                        }
                    }
                }
                let binding = read_binding(&child_path);
                match binding {
                    _ if leased => total = total.saturating_add(tree_bytes(&child_path)),
                    None => {
                        self.discard(&child_path, trash)?;
                    }
                    Some(binding) if now.saturating_sub(binding.last_used_at) > idle => {
                        self.discard(&child_path, trash)?;
                    }
                    Some(binding) => {
                        let bytes = tree_bytes(&child_path);
                        total = total.saturating_add(bytes);
                        candidates.push((binding.last_used_at, key, bytes));
                    }
                }
            }
            let _ = fs::remove_dir(&path);
        }
        candidates.sort();
        for (_, key, bytes) in candidates {
            if total <= self.total_limit {
                break;
            }
            let path = self.directory(&key);
            self.discard(&path, trash)?;
            total = total.saturating_sub(bytes);
            let _ = fs::remove_dir(self.root.join(&key.0));
        }
        Ok(())
    }
}

/// Deletes renamed-aside trash. Std's recursive removal does not follow links.
pub(crate) fn empty_trash(trash: Vec<PathBuf>) {
    for path in trash {
        let _ = fs::remove_dir_all(path);
    }
}

fn attach_lease(leases: &Leases, key: &(String, String), id: u64, released: Released) {
    if let Some(entry) = table(leases).entries.get_mut(key).filter(|entry| entry.id == id) {
        entry.released = Some(released);
    }
}

fn release_lease(leases: &Leases, key: &(String, String), id: u64) -> bool {
    let mut leases = table(leases);
    if leases.entries.get(key).is_some_and(|entry| entry.id == id) {
        leases.entries.remove(key);
        leases.dropped = true;
        true
    } else {
        false
    }
}

/// Engine and root status: a leaf lock with no IO, safe on any thread.
#[derive(Default)]
struct Status {
    pending: Option<(PathBuf, bool)>,
    opened: bool,
    blocked: Option<Unavailable>,
    engine: Option<bool>,
}

impl Status {
    fn engine(&self) -> Result<(), Unavailable> {
        match self.engine {
            Some(true) => Ok(()),
            Some(false) => Err(Unavailable::EngineUnsupported),
            None => Err(Unavailable::Runtime),
        }
    }
}

fn status_lock() -> MutexGuard<'static, Status> {
    static STATUS: std::sync::OnceLock<Mutex<Status>> = std::sync::OnceLock::new();
    STATUS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|error| error.into_inner())
}

/// The opened store. Held across filesystem IO (acquire, housekeeping,
/// clears), so it is only ever taken off the CEF UI thread.
#[derive(Default)]
struct Disk {
    store: Option<CacheStore>,
    last_housekeeping: Option<u64>,
}

fn disk() -> MutexGuard<'static, Disk> {
    static DISK: std::sync::OnceLock<Mutex<Disk>> = std::sync::OnceLock::new();
    DISK.get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|error| error.into_inner())
}

/// Opens the configured root on first use (IO under the disk lock only).
fn open_store(disk: &mut Disk) -> Result<&mut CacheStore, Unavailable> {
    if disk.store.is_none() {
        let pending = {
            let status = status_lock();
            if let Some(blocked) = status.blocked {
                return Err(blocked);
            }
            status.pending.clone()
        };
        let outcome = match pending {
            None => return Err(Unavailable::Runtime),
            Some((_, false)) => Err(Unavailable::NotLocal),
            Some((data_root, true)) => CacheStore::open(&data_root).map_err(|error| {
                log::warn!("Native browser HTTP cache root is unavailable: {}", error.kind());
                Unavailable::Runtime
            }),
        };
        let mut status = status_lock();
        status.pending = None;
        match outcome {
            Ok(store) => {
                disk.store = Some(store);
                status.opened = true;
            }
            Err(blocked) => {
                status.blocked = Some(blocked);
                return Err(blocked);
            }
        }
    }
    disk.store.as_mut().ok_or(Unavailable::Runtime)
}

/// Records the committed browser root and whether it is device-local (F6).
/// No IO here; the root is opened lazily off the UI thread.
pub(crate) fn configure(data_root: &Path, local: bool) {
    let mut status = status_lock();
    if !status.opened && status.blocked.is_none() {
        status.pending = Some((data_root.to_path_buf(), local));
    }
}

/// Whether the loaded engine reports HTTP_DISK_CACHE (C-H1 bit 10).
pub(crate) fn set_engine_support(supported: bool) {
    status_lock().engine = Some(supported);
}

/// Whether a disk cache could be used at all now (not per connection). May
/// open the root: never call it on the UI thread.
pub(crate) fn status() -> Result<(), Unavailable> {
    status_lock().engine()?;
    open_store(&mut disk()).map(|_| ())
}

/// Cheap, IO-free gate before an attempt computes its binding.
pub(crate) fn may_acquire() -> Result<(), Unavailable> {
    let status = status_lock();
    status.engine()?;
    if let Some(blocked) = status.blocked {
        return Err(blocked);
    }
    if status.opened || status.pending.is_some() {
        Ok(())
    } else {
        Err(Unavailable::Runtime)
    }
}

/// A held cache directory. Dropping it before `attach` releases it at once
/// (context creation failed or fell back to memory). Attach and drop lock
/// only the lease table, never the store, so the CEF UI thread never waits
/// on cache IO.
pub(crate) struct CacheLease {
    leases: Leases,
    key: (String, String),
    id: u64,
    spec: HttpDiskCacheSpec,
    attached: bool,
}

impl CacheLease {
    pub(crate) fn spec(&self) -> HttpDiskCacheSpec {
        self.spec.clone()
    }

    /// Hands the lease to the engine's release signal (state 7). It then ends
    /// only on the housekeeping tick that observes the signal.
    pub(crate) fn attach(mut self, signal: HttpCacheReleaseSignal) {
        attach_lease(&self.leases, &self.key, self.id, Box::new(move || signal.is_released()));
        self.attached = true;
    }
}

impl Drop for CacheLease {
    fn drop(&mut self) {
        if !self.attached {
            release_lease(&self.leases, &self.key, self.id);
        }
    }
}

/// Blocking: takes the connection's lease. `None` inputs are never IPC: the
/// ids come from the authorised attempt identity, sizes from saved settings.
pub(crate) fn acquire(
    database: &str,
    connection: &str,
    binding: &[u8; 32],
    per_connection_bytes: u64,
    total_bytes: u64,
) -> Result<CacheLease, Refusal> {
    status_lock().engine().map_err(Refusal::Unavailable)?;
    let mut trash = Vec::new();
    let result = (|| {
        let mut disk = disk();
        let store = open_store(&mut disk).map_err(Refusal::Unavailable)?;
        let (key, id, directory) = store.acquire(
            database,
            connection,
            binding,
            total_bytes,
            now_seconds(),
            &mut trash,
        )?;
        match HttpDiskCacheSpec::new(directory, per_connection_bytes) {
            Ok(spec) => Ok(store.lease(key, id, spec)),
            Err(_) => {
                store.release(&key, id);
                Err(Refusal::Storage)
            }
        }
    })();
    empty_trash(trash);
    result
}

/// Background tick (about once a second, never on the UI thread): ends leases
/// whose engine release fired, then runs housekeeping at start, after a
/// release or drop, and hourly.
pub(crate) fn tick() {
    let mut trash = Vec::new();
    {
        let mut disk = disk();
        let last = disk.last_housekeeping;
        let now = now_seconds();
        let Ok(store) = open_store(&mut disk) else {
            return;
        };
        let released = store.take_released(now);
        let due = released > 0
            || last.map_or(true, |last| now.saturating_sub(last) >= HOUSEKEEPING_INTERVAL.as_secs());
        if due {
            if let Err(error) = store.housekeeping(now, &mut trash) {
                log::warn!("Native browser HTTP cache housekeeping failed: {}", error.kind());
            }
            disk.last_housekeeping = Some(now);
        }
    }
    empty_trash(trash);
}

/// Blocking. Deletes a connection's cache now, or marks it for deletion when
/// a previous attempt still holds it.
pub(crate) fn clear_connection(database: &str, connection: &str) -> Result<ClearOutcome, Unavailable> {
    let mut trash = Vec::new();
    let result = open_store(&mut disk())
        .and_then(|store| store.clear_connection(database, connection, &mut trash).map_err(|_| Unavailable::Runtime));
    empty_trash(trash);
    result
}

/// Blocking. Every cache of one database (database deletion, lock clear).
pub(crate) fn clear_database(database: &str) -> Result<ClearOutcome, Unavailable> {
    let mut trash = Vec::new();
    let result = open_store(&mut disk())
        .and_then(|store| store.clear_database(database, &mut trash).map_err(|_| Unavailable::Runtime));
    empty_trash(trash);
    result
}

/// Blocking. Every cache of this profile.
pub(crate) fn clear_all() -> Result<ClearOutcome, Unavailable> {
    let mut trash = Vec::new();
    let result = open_store(&mut disk())
        .and_then(|store| store.clear_all(&mut trash).map_err(|_| Unavailable::Runtime));
    empty_trash(trash);
    result
}

/// Blocking. Bytes on disk for one connection or the whole cache.
pub(crate) fn usage(entry: Option<(&str, &str)>) -> Result<u64, Unavailable> {
    open_store(&mut disk()).map(|store| store.usage(entry))
}

/// Binding over the security-bound connection projection, the authorised
/// certificate/trust policy and the route class (C-H4).
pub(crate) fn binding_digest(row: &[u8; 32], trust: &[u8; 32], settings: &[u8; 32], route: &str) -> [u8; 32] {
    let mut digest = Sha256::new();
    digest.update(b"sorng-http-cache-binding-v1\0");
    digest.update(row);
    digest.update(trust);
    digest.update(settings);
    digest.update(route.as_bytes());
    digest.finalize().into()
}

/// Error string the shell maps to "Close this connection's tab first".
pub(crate) const SESSION_OPEN: &str = "browser-session-open";
const DATA_UNAVAILABLE: &str =
    "Browser data is unavailable: unlock this connection's database in this window first.";
const DATA_FAILED: &str = "Browser data could not be cleared; nothing else was changed.";

/// The C-H5 refusal: exactly `browser-session-open` while an attempt of the
/// connection is live in any of the window's unlocked databases.
pub(crate) fn refuse_open_session<'a>(
    databases: impl IntoIterator<Item = &'a str>,
    connection: &str,
    open: impl Fn(&str, &str) -> bool,
) -> Result<(), String> {
    if databases.into_iter().any(|database| open(database, connection)) {
        Err(SESSION_OPEN.into())
    } else {
        Ok(())
    }
}

/// A cookie clear refused because a retention attempt is still live (it can
/// start between the session check and the clear) is the same refusal.
/// Other errors are failures the caller reports after finishing its work.
pub(crate) fn cookie_clear_refusal(
    error: sorng_commands_core::database_protection::native_browser_owner::ClearError,
) -> Result<(), String> {
    use sorng_commands_core::database_protection::native_browser_owner::ClearError;
    match error {
        ClearError::SessionOpen => Err(SESSION_OPEN.into()),
        ClearError::Unavailable | ClearError::WrongConnection => Ok(()),
    }
}

/// IO-free capability for settings: whether a disk cache can be used now.
pub(crate) fn capability() -> Result<(), Unavailable> {
    may_acquire()
}

/// C-H5 `origin_browser_clear_connection_data`. The databases are the ones
/// this window holds unlocked (native witnesses), never an IPC argument;
/// refuses while any attempt of the connection is live in one of them.
pub(crate) async fn clear_connection_data(
    window: &tauri::WebviewWindow,
    state: &sorng_encryption::EncryptionState,
    connection: &str,
    cookies: bool,
    cache: bool,
) -> Result<(bool, ClearOutcome), String> {
    use sorng_commands_core::database_protection::native_browser_owner::read_unlocked;
    use tauri::{Emitter, Manager};
    let owners = read_unlocked(window, state, connection)
        .await
        .map_err(|_| DATA_UNAVAILABLE.to_owned())?;
    if owners.is_empty() {
        return Err(DATA_UNAVAILABLE.into());
    }
    refuse_open_session(
        owners.iter().map(|owner| owner.database.as_str()),
        connection,
        super::connection_open,
    )?;
    let mut failed = false;
    let mut cookies_cleared = false;
    if cookies {
        for owner in &owners {
            // No saved row (deleted connection): its record went with the row.
            let Some((_, lease)) = &owner.owner else {
                continue;
            };
            match super::retention::clear_connection_cookies(lease, connection).await {
                Ok(true) => {
                    cookies_cleared = true;
                    let _ = window.app_handle().emit(
                        "database-protection:browser-sessions-changed",
                        serde_json::json!({"databaseId": owner.database}),
                    );
                }
                Ok(false) => (),
                Err(error) => {
                    cookie_clear_refusal(error)?;
                    failed = true;
                }
            }
        }
    }
    let mut outcome = ClearOutcome::default();
    if cache {
        for owner in &owners {
            let database = owner.database.clone();
            let id = connection.to_owned();
            match tauri::async_runtime::spawn_blocking(move || clear_connection(&database, &id)).await {
                Ok(Ok(cleared)) => outcome.merge(cleared),
                // No cache root this run (never started, not local): nothing to clear.
                Ok(Err(_)) => (),
                Err(_) => failed = true,
            }
        }
    }
    if failed {
        return Err(DATA_FAILED.into());
    }
    Ok((cookies_cleared, outcome))
}

/// C-H5 `origin_browser_http_cache_usage`: (available, reason, bytes, limit).
pub(crate) async fn usage_report(
    window: &tauri::WebviewWindow,
    state: &sorng_encryption::EncryptionState,
    connection: Option<&str>,
) -> Result<(Option<&'static str>, u64, u64), String> {
    use sorng_commands_core::database_protection::native_browser_owner::{profile_root_for, read_unlocked};
    use sorng_commands_core::origin_browser_authority::NativeBrowserPreferences;
    const MIB: u64 = 1024 * 1024;
    let root = profile_root_for(window, state).map_err(|_| DATA_UNAVAILABLE.to_owned())?;
    let settings = crate::app_settings_commands::read_app_settings_inner(&root, state)
        .await
        .map_err(|_| DATA_UNAVAILABLE.to_owned())?
        .unwrap_or(serde_json::Value::Null);
    let global = NativeBrowserPreferences::http_cache_from_settings(&settings)
        .map_err(|_| DATA_UNAVAILABLE.to_owned())?;
    let (enabled, limit, entries) = match connection {
        None => (global.enabled, global.total_mb.saturating_mul(MIB), None),
        Some(connection) => {
            let owners = read_unlocked(window, state, connection)
                .await
                .map_err(|_| DATA_UNAVAILABLE.to_owned())?;
            let mut resolved = None;
            let mut databases = Vec::new();
            for owner in owners {
                let Some((row, _)) = &owner.owner else {
                    continue;
                };
                if resolved.is_none() {
                    resolved = Some(
                        NativeBrowserPreferences::from_saved(row, &settings)
                            .map_err(|_| DATA_UNAVAILABLE.to_owned())?
                            .http_cache,
                    );
                }
                databases.push(owner.database);
            }
            let preferences = resolved.ok_or_else(|| DATA_UNAVAILABLE.to_owned())?;
            (
                preferences.enabled,
                preferences.per_connection_mb.saturating_mul(MIB),
                Some((databases, connection.to_owned())),
            )
        }
    };
    let bytes = tauri::async_runtime::spawn_blocking(move || match &entries {
        None => usage(None).unwrap_or(0),
        Some((databases, connection)) => databases
            .iter()
            .map(|database| usage(Some((database, connection))).unwrap_or(0))
            .fold(0u64, u64::saturating_add),
    })
    .await
    .map_err(|_| DATA_UNAVAILABLE.to_owned())?;
    let reason = if enabled {
        tauri::async_runtime::spawn_blocking(status)
            .await
            .map_err(|_| DATA_UNAVAILABLE.to_owned())?
            .err()
            .map(Unavailable::code)
    } else {
        Some(Unavailable::Disabled.code())
    };
    Ok((reason, bytes, limit))
}

/// C-H5 `origin_browser_clear_all_http_cache`: every cache of this profile;
/// held directories are tombstoned and deleted on release or next start.
pub(crate) async fn clear_all_report() -> Result<ClearOutcome, String> {
    match tauri::async_runtime::spawn_blocking(clear_all).await {
        Ok(Ok(outcome)) => Ok(outcome),
        Ok(Err(reason)) => Err(format!("Page cache is unavailable ({}).", reason.code())),
        Err(_) => Err(DATA_FAILED.into()),
    }
}

/// Global trust settings that select the certificate policy and CA mode for
/// every connection (`saved_policy`, `httpsCaTrustMode`).
pub(crate) fn trust_settings_digest(settings: &serde_json::Value) -> [u8; 32] {
    let projection = serde_json::json!([
        settings.get("httpsTrustPolicy"),
        settings.get("trustPolicy"),
        settings.get("tlsTrustPolicy"),
        settings.get("httpsCaTrustMode"),
    ]);
    Sha256::digest(projection.to_string().as_bytes()).into()
}

fn scope_component(value: &str) -> String {
    // Same encoding as the native certificate authority's connection scope.
    let mut result = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            result.push(byte as char);
        } else {
            result.push_str(&format!("%{byte:02X}"));
        }
    }
    result
}

/// The owning database's trust policy plus every certificate record that a
/// certificate lookup for this connection can resolve: its own
/// connection-scoped records and the database-wide host-level fallbacks.
/// Volatile bookkeeping (last seen, statistics, history, nicknames, tags) is
/// excluded, so ordinary visits never invalidate the cache.
pub(crate) async fn trust_store_digest(database: &str, connection: &str) -> Result<[u8; 32], ()> {
    use sorng_storage::trust_store::TrustStoreService;
    let shared = TrustStoreService::shared();
    let mut service = shared
        .lock()
        .await
        .scoped_to_database(Some(database.into()))
        .map_err(|_| ())?;
    service.reload_from_disk().map_err(|_| ())?;
    Ok(trust_projection(
        &service.get_all_trust_records().await,
        &service.get_trust_policy().await,
        &service.get_trust_policy_config().await,
        connection,
    ))
}

/// Pure projection behind `trust_store_digest`.
pub(crate) fn trust_projection(
    records: &[sorng_storage::trust_store::TrustRecord],
    policy: &sorng_storage::trust_store::TrustPolicy,
    config: &sorng_storage::trust_store::TrustPolicyConfig,
    connection: &str,
) -> [u8; 32] {
    use sorng_storage::trust_store::{Identity, CONNECTION_SCOPE_PREFIX};
    let prefix = format!("{CONNECTION_SCOPE_PREFIX}{}/", scope_component(connection));
    let mut rows: Vec<String> = records
        .iter()
        // Certificate lookup (`trust_scope::effective_key`) resolves this
        // connection's endpoint to its own scoped record or, when none
        // exists, to the database-wide `host:port` record. Bind every
        // database-wide record (a superset of the endpoints this connection
        // can resolve): approving, revoking, pinning or re-policing a
        // host-level record changes the binding.
        .filter(|record| {
            record.host.starts_with(&prefix) || !record.host.starts_with(CONNECTION_SCOPE_PREFIX)
        })
        .map(|record| {
            let identity = match &record.identity {
                Identity::Tls(tls) => serde_json::json!([tls.fingerprint, tls.chain_fingerprints]),
                Identity::Ssh(_) => serde_json::Value::Null,
            };
            serde_json::json!([
                record.host,
                record.record_type,
                identity,
                record.user_approved,
                record.host_policy,
                record.host_policy_config,
                record.revoked,
                record.trust_expires,
            ])
            .to_string()
        })
        .collect();
    rows.sort();
    let projection = serde_json::json!({
        "records": rows,
        "policy": policy,
        "config": config,
    });
    Sha256::digest(projection.to_string().as_bytes()).into()
}

#[cfg(test)]
#[path = "origin_browser_http_cache_tests.rs"]
mod tests;
