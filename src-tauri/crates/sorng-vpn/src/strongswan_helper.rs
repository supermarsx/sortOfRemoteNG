//! Linux/macOS strongSwan helper for IPsec-based VPN protocols.
//! Provides shared functions for IKEv2, IPsec, and L2TP/IPsec connections.

#[cfg(not(windows))]
use crate::validation;
#[cfg(not(windows))]
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
#[cfg(not(windows))]
use std::ffi::CString;
#[cfg(not(windows))]
use std::fs::File;
#[cfg(not(windows))]
use std::io::{Read, Write};
#[cfg(not(windows))]
use std::os::fd::{AsRawFd, FromRawFd};
#[cfg(not(windows))]
use std::os::unix::ffi::OsStrExt;
#[cfg(not(windows))]
use std::os::unix::fs::{FileExt, MetadataExt};
#[cfg(not(windows))]
use std::os::unix::process::CommandExt as _;
#[cfg(not(windows))]
use std::path::{Path, PathBuf};
#[cfg(not(windows))]
use std::process::{ExitStatus, Stdio};
#[cfg(not(windows))]
use std::time::Duration;
#[cfg(not(windows))]
use tokio::io::{AsyncRead, AsyncReadExt};
#[cfg(not(windows))]
use tokio::process::{Child, Command};
#[cfg(not(windows))]
use uuid::Uuid;
#[cfg(not(windows))]
use zeroize::{Zeroize, Zeroizing};

/// Validated inputs for one managed strongSwan tunnel. Keeping the local and
/// remote authentication roles named prevents positional call-site mixups.
pub struct IpsecConnectionSpec<'a> {
    pub conn_name: &'a str,
    pub server: &'a str,
    pub local_id: Option<&'a str>,
    pub remote_id: Option<&'a str>,
    pub local_auth: &'a str,
    pub remote_auth: &'a str,
    pub eap_identity: Option<&'a str>,
    pub phase1: Option<&'a str>,
    pub phase2: Option<&'a str>,
    pub remote_subnets: &'a [String],
}

#[cfg(not(windows))]
const TRUSTED_INSTALL_BINARIES: &[&str] = &["/usr/bin/install", "/bin/install"];
#[cfg(not(windows))]
const TRUSTED_MKDIR_BINARIES: &[&str] = &["/usr/bin/mkdir", "/bin/mkdir"];
#[cfg(not(windows))]
const TRUSTED_RM_BINARIES: &[&str] = &["/usr/bin/rm", "/bin/rm"];
#[cfg(not(windows))]
const TRUSTED_GREP_BINARIES: &[&str] = &["/usr/bin/grep", "/bin/grep"];
#[cfg(all(not(windows), target_os = "linux"))]
const TRUSTED_PKEXEC_BINARIES: &[&str] = &["/usr/bin/pkexec", "/bin/pkexec"];
#[cfg(not(windows))]
const PROCESS_OUTPUT_LIMIT: usize = 64 * 1024;
#[cfg(not(windows))]
const INCLUDE_LINE_LIMIT: usize = 8 * 1024;
#[cfg(not(windows))]
const MANAGED_CONFIG_LIMIT: usize = 512 * 1024;
#[cfg(not(windows))]
const IPSEC_FILE_LIMIT: usize = 256 * 1024;
#[cfg(not(windows))]
const IPSEC_SECRET_LIMIT: usize = 64 * 1024;
#[cfg(not(windows))]
const REMOTE_SUBNET_COUNT_LIMIT: usize = 1024;
#[cfg(not(windows))]
const REMOTE_SUBNET_BYTES_LIMIT: usize = 64 * 1024;
#[cfg(not(windows))]
const FILE_PROCESS_TIMEOUT: Duration = Duration::from_secs(20);
#[cfg(not(windows))]
const PRIVILEGED_FILE_TIMEOUT: Duration = Duration::from_secs(120);
#[cfg(not(windows))]
const PRIVILEGED_INSPECTION_TIMEOUT: Duration = Duration::from_secs(90);
#[cfg(not(windows))]
const IPSEC_STATUS_TIMEOUT: Duration = Duration::from_secs(15);
#[cfg(not(windows))]
const IPSEC_CONTROL_TIMEOUT: Duration = Duration::from_secs(30);
#[cfg(not(windows))]
const IPSEC_DOWN_TIMEOUT: Duration = Duration::from_secs(45);
#[cfg(not(windows))]
const IPSEC_UP_TIMEOUT: Duration = Duration::from_secs(120);
#[cfg(not(windows))]
const ELEVATION_PROMPT_ALLOWANCE: Duration = Duration::from_secs(90);
#[cfg(not(windows))]
const PROCESS_REAP_TIMEOUT: Duration = Duration::from_secs(5);

#[cfg(target_os = "macos")]
const TRUSTED_EXEC_PATH: &str =
    "/opt/homebrew/bin:/usr/local/bin:/usr/local/sbin:/usr/bin:/bin:/usr/sbin:/sbin";
#[cfg(all(not(windows), not(target_os = "macos")))]
const TRUSTED_EXEC_PATH: &str = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

#[cfg(not(windows))]
struct BoundedOutput {
    status: ExitStatus,
    stdout: Zeroizing<Vec<u8>>,
    stderr: Zeroizing<Vec<u8>>,
    stdout_truncated: bool,
    stderr_truncated: bool,
}
#[cfg(not(windows))]
#[derive(Debug, Clone, PartialEq, Eq)]
struct IpsecLayout {
    binary: PathBuf,
    config_root: PathBuf,
    allow_elevation: bool,
}

#[cfg(not(windows))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct LayoutCandidate {
    binary: &'static str,
    config_root: &'static str,
    allow_user_owned: bool,
}

#[cfg(not(windows))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FileIdentity {
    device: u64,
    inode: u64,
    length: u64,
    modified_seconds: i64,
    modified_nanoseconds: i64,
    changed_seconds: i64,
    changed_nanoseconds: i64,
}

#[cfg(not(windows))]
impl FileIdentity {
    fn from_metadata(metadata: &std::fs::Metadata) -> Self {
        Self {
            device: metadata.dev(),
            inode: metadata.ino(),
            length: metadata.len(),
            modified_seconds: metadata.mtime(),
            modified_nanoseconds: metadata.mtime_nsec(),
            changed_seconds: metadata.ctime(),
            changed_nanoseconds: metadata.ctime_nsec(),
        }
    }
}

/// An opened private staging directory and payload. The parent and directory
/// descriptors keep cleanup attached to the objects that were created rather
/// than to pathnames that may later be replaced. Drop is the cancellation and
/// panic backstop; normal completion always calls `cleanup` so failures can be
/// returned to the caller instead of reporting a false success.
#[cfg(not(windows))]
struct PrivateStagingFile {
    parent: File,
    directory: File,
    directory_name: CString,
    payload_name: CString,
    payload_path: PathBuf,
    payload_present: bool,
    armed: bool,
}

#[cfg(not(windows))]
impl PrivateStagingFile {
    fn create(content: Zeroizing<String>) -> Result<Self, String> {
        if content.len() > IPSEC_FILE_LIMIT {
            return Err(format!(
                "IPsec file content exceeds the {IPSEC_FILE_LIMIT}-byte safety limit"
            ));
        }

        let staging_root = std::env::temp_dir();
        let parent = open_verified_directory(&staging_root).map_err(|error| {
            format!(
                "Refusing unsafe IPsec staging directory {}: {error}",
                staging_root.display()
            )
        })?;
        let (directory_name_text, directory_name) = (0..16)
            .find_map(|_| {
                let text = format!("sortofremoteng-ipsec-{}", Uuid::new_v4().simple());
                let name = CString::new(text.as_bytes()).ok()?;
                // SAFETY: parent is a verified directory descriptor and name
                // is a single NUL-free component. mkdirat creates atomically.
                let result = unsafe { libc::mkdirat(parent.as_raw_fd(), name.as_ptr(), 0o700) };
                if result == 0 {
                    Some(Ok((text, name)))
                } else {
                    let error = std::io::Error::last_os_error();
                    if error.kind() == std::io::ErrorKind::AlreadyExists {
                        None
                    } else {
                        Some(Err(format!(
                            "Failed to create private IPsec staging directory: {error}"
                        )))
                    }
                }
            })
            .transpose()?
            .ok_or_else(|| "Failed to allocate a unique IPsec staging directory".to_string())?;
        // SAFETY: the component was created above beneath the held parent and
        // O_NOFOLLOW prevents replacement with a symlink before this open.
        let directory_fd = unsafe {
            libc::openat(
                parent.as_raw_fd(),
                directory_name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if directory_fd < 0 {
            // SAFETY: remove only the exact entry beneath the held parent.
            let _ = unsafe {
                libc::unlinkat(
                    parent.as_raw_fd(),
                    directory_name.as_ptr(),
                    libc::AT_REMOVEDIR,
                )
            };
            return Err(format!(
                "Failed to open private IPsec staging directory: {}",
                std::io::Error::last_os_error()
            ));
        }
        // SAFETY: directory_fd is a newly returned owned descriptor.
        let directory = unsafe { File::from_raw_fd(directory_fd) };
        validate_private_directory_descriptor(&directory).map_err(|error| {
            // The guard is not constructed yet, so remove this empty directory
            // through the held parent before returning the validation error.
            // SAFETY: both descriptors/components remain valid here.
            let _ = unsafe {
                libc::unlinkat(
                    parent.as_raw_fd(),
                    directory_name.as_ptr(),
                    libc::AT_REMOVEDIR,
                )
            };
            format!("Unsafe IPsec staging directory: {error}")
        })?;

        let directory_path = staging_root.join(&directory_name_text);
        let payload_name = CString::new("payload").expect("static payload name has no NUL");
        let payload_path = directory_path.join("payload");
        let mut staging = Self {
            parent,
            directory,
            directory_name,
            payload_name,
            payload_path,
            payload_present: false,
            armed: true,
        };
        // SAFETY: directory is private, verified, and held open. O_EXCL and
        // O_NOFOLLOW make creation immune to final-component replacement.
        let payload_fd = unsafe {
            libc::openat(
                staging.directory.as_raw_fd(),
                staging.payload_name.as_ptr(),
                libc::O_WRONLY
                    | libc::O_CREAT
                    | libc::O_EXCL
                    | libc::O_NOFOLLOW
                    | libc::O_NONBLOCK
                    | libc::O_CLOEXEC,
                0o600,
            )
        };
        if payload_fd < 0 {
            return Err(format!(
                "Failed to create private IPsec staging file: {}",
                std::io::Error::last_os_error()
            ));
        }
        staging.payload_present = true;
        // SAFETY: payload_fd is a newly returned owned descriptor.
        let mut payload = unsafe { File::from_raw_fd(payload_fd) };
        validate_regular_descriptor(&payload, true, IPSEC_FILE_LIMIT)
            .map_err(|error| format!("Unsafe private IPsec staging file: {error}"))?;
        payload
            .write_all(content.as_bytes())
            .map_err(|error| format!("Failed to write private IPsec staging file: {error}"))?;
        payload
            .sync_all()
            .map_err(|error| format!("Failed to sync private IPsec staging file: {error}"))?;
        staging
            .directory
            .sync_all()
            .map_err(|error| format!("Failed to sync private IPsec staging directory: {error}"))?;
        Ok(staging)
    }

    fn cleanup(mut self) -> Result<(), String> {
        self.cleanup_inner()
    }

    fn cleanup_inner(&mut self) -> Result<(), String> {
        if !self.armed {
            return Ok(());
        }
        let mut errors = Vec::new();
        if self.payload_present {
            // SAFETY: unlink the fixed payload beneath the held private
            // directory descriptor, independent of pathname replacement.
            if unsafe { libc::unlinkat(self.directory.as_raw_fd(), self.payload_name.as_ptr(), 0) }
                == 0
            {
                self.payload_present = false;
            } else {
                errors.push(format!(
                    "failed to remove private IPsec staging payload: {}",
                    std::io::Error::last_os_error()
                ));
            }
        }
        if let Err(error) = self.directory.sync_all() {
            errors.push(format!(
                "failed to sync private IPsec staging cleanup: {error}"
            ));
        }
        // SAFETY: remove the exact directory entry beneath the held staging
        // root. A renamed/replaced entry fails closed instead of deleting it.
        if unsafe {
            libc::unlinkat(
                self.parent.as_raw_fd(),
                self.directory_name.as_ptr(),
                libc::AT_REMOVEDIR,
            )
        } != 0
        {
            errors.push(format!(
                "failed to remove private IPsec staging directory: {}",
                std::io::Error::last_os_error()
            ));
        }
        if errors.is_empty() {
            self.armed = false;
            Ok(())
        } else {
            Err(errors.join("; "))
        }
    }
}

#[cfg(not(windows))]
impl Drop for PrivateStagingFile {
    fn drop(&mut self) {
        let _ = self.cleanup_inner();
    }
}

#[cfg(not(windows))]
fn open_verified_directory(path: &Path) -> std::io::Result<File> {
    if !path.is_absolute() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "security-sensitive directory path must be absolute",
        ));
    }
    // SAFETY: this opens the static root path and returns a new descriptor.
    let root_fd = unsafe {
        libc::open(
            c"/".as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_CLOEXEC,
        )
    };
    if root_fd < 0 {
        return Err(std::io::Error::last_os_error());
    }
    // SAFETY: root_fd is a newly returned owned descriptor.
    let mut current = unsafe { File::from_raw_fd(root_fd) };
    validate_directory_descriptor(&current)?;

    for component in path.components() {
        let std::path::Component::Normal(component) = component else {
            if matches!(component, std::path::Component::RootDir) {
                continue;
            }
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "directory path must not contain relative components",
            ));
        };
        let component = CString::new(component.as_bytes()).map_err(|_| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "directory component contains NUL",
            )
        })?;
        // SAFETY: each component is opened relative to the already verified
        // parent. O_NOFOLLOW prevents a symlink from entering the chain.
        let next_fd = unsafe {
            libc::openat(
                current.as_raw_fd(),
                component.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if next_fd < 0 {
            return Err(std::io::Error::last_os_error());
        }
        // SAFETY: next_fd is a newly returned owned descriptor.
        let next = unsafe { File::from_raw_fd(next_fd) };
        validate_directory_descriptor(&next)?;
        current = next;
    }
    Ok(current)
}

#[cfg(not(windows))]
fn validate_directory_descriptor(directory: &File) -> std::io::Result<()> {
    let metadata = directory.metadata()?;
    if !metadata.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "opened path is not a directory",
        ));
    }
    // SAFETY: geteuid has no preconditions and only returns process state.
    let current_uid = unsafe { libc::geteuid() };
    if metadata.uid() != 0 && metadata.uid() != current_uid {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "directory is not owned by root or the current user",
        ));
    }
    let mode = metadata.mode();
    let trusted_sticky_directory = metadata.uid() == 0 && mode & 0o1000 != 0;
    if mode & 0o022 != 0 && !trusted_sticky_directory {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "directory is group/world writable without root-owned sticky protection",
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
fn validate_private_directory_descriptor(directory: &File) -> std::io::Result<()> {
    let metadata = directory.metadata()?;
    // SAFETY: geteuid has no preconditions and only returns process state.
    let current_uid = unsafe { libc::geteuid() };
    if !metadata.is_dir() || metadata.uid() != current_uid || metadata.mode() & 0o077 != 0 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "private directory must be current-user-owned with mode 0700 or stricter",
        ));
    }
    Ok(())
}

#[cfg(not(windows))]
fn open_regular_file_no_follow(
    path: &Path,
    access_flags: libc::c_int,
    create_mode: Option<libc::mode_t>,
    require_private: bool,
    size_limit: usize,
) -> std::io::Result<Option<File>> {
    let parent_path = path.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "file path has no parent directory",
        )
    })?;
    let parent = open_verified_directory(parent_path)?;
    let file_name = path.file_name().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "file path has no name")
    })?;
    let file_name = CString::new(file_name.as_bytes()).map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "file name contains NUL")
    })?;
    let mut flags = access_flags | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC;
    let mode = if let Some(mode) = create_mode {
        flags |= libc::O_CREAT;
        mode
    } else {
        0
    };
    // SAFETY: parent is a verified directory descriptor and file_name is one
    // NUL-free component. O_NOFOLLOW and O_NONBLOCK reject link/FIFO hazards.
    // `openat` is variadic when O_CREAT is present. On platforms where
    // `mode_t` is narrower than `c_uint` (notably macOS), C's default argument
    // promotions require the mode to be passed as `c_uint`.
    let file_fd = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            file_name.as_ptr(),
            flags,
            mode as libc::c_uint,
        )
    };
    if file_fd < 0 {
        let error = std::io::Error::last_os_error();
        if create_mode.is_none() && error.kind() == std::io::ErrorKind::NotFound {
            return Ok(None);
        }
        return Err(error);
    }
    // SAFETY: file_fd is a newly returned owned descriptor.
    let file = unsafe { File::from_raw_fd(file_fd) };
    validate_regular_descriptor(&file, require_private, size_limit)?;
    Ok(Some(file))
}

#[cfg(not(windows))]
fn validate_regular_descriptor(
    file: &File,
    require_private: bool,
    size_limit: usize,
) -> std::io::Result<std::fs::Metadata> {
    let metadata = file.metadata()?;
    // SAFETY: geteuid has no preconditions and only returns process state.
    let current_uid = unsafe { libc::geteuid() };
    if !metadata.is_file() || metadata.nlink() != 1 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "opened path is not a single-link regular file",
        ));
    }
    if metadata.uid() != 0 && metadata.uid() != current_uid {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "file is not owned by root or the current user",
        ));
    }
    if metadata.mode() & 0o022 != 0 || (require_private && metadata.mode() & 0o077 != 0) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "file permissions are unsafe",
        ));
    }
    if metadata.len() > size_limit as u64 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("file exceeds the {size_limit}-byte safety limit"),
        ));
    }
    Ok(metadata)
}

#[cfg(not(windows))]
fn read_bounded_open_file(
    file: &mut File,
    size_limit: usize,
) -> std::io::Result<Zeroizing<Vec<u8>>> {
    let before = validate_regular_descriptor(file, false, size_limit)?;
    let capacity = usize::try_from(before.len())
        .unwrap_or(size_limit)
        .min(size_limit);
    let mut bytes = Zeroizing::new(Vec::with_capacity(capacity));
    (&mut *file)
        .take(size_limit as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > size_limit {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("file exceeds the {size_limit}-byte safety limit"),
        ));
    }
    let after = file.metadata()?;
    if FileIdentity::from_metadata(&before) != FileIdentity::from_metadata(&after) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Interrupted,
            "file changed while it was being read",
        ));
    }
    Ok(bytes)
}

#[cfg(not(windows))]
fn read_bounded_regular_file(
    path: &Path,
    size_limit: usize,
) -> std::io::Result<Option<(Zeroizing<Vec<u8>>, FileIdentity)>> {
    let Some(mut file) =
        open_regular_file_no_follow(path, libc::O_RDONLY, None, false, size_limit)?
    else {
        return Ok(None);
    };
    let identity = FileIdentity::from_metadata(&file.metadata()?);
    let bytes = read_bounded_open_file(&mut file, size_limit)?;
    Ok(Some((bytes, identity)))
}

#[cfg(not(windows))]
const SYSTEM_LAYOUTS: &[LayoutCandidate] = &[
    LayoutCandidate {
        binary: "/usr/sbin/ipsec",
        config_root: "/etc",
        allow_user_owned: false,
    },
    LayoutCandidate {
        binary: "/sbin/ipsec",
        config_root: "/etc",
        allow_user_owned: false,
    },
    LayoutCandidate {
        binary: "/usr/local/sbin/ipsec",
        config_root: "/usr/local/etc",
        allow_user_owned: false,
    },
];

#[cfg(not(windows))]
#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
const HOMEBREW_LAYOUTS: &[LayoutCandidate] = &[
    LayoutCandidate {
        binary: "/opt/homebrew/bin/ipsec",
        config_root: "/opt/homebrew/etc",
        allow_user_owned: true,
    },
    LayoutCandidate {
        binary: "/usr/local/bin/ipsec",
        config_root: "/usr/local/etc",
        allow_user_owned: true,
    },
];

#[cfg(not(windows))]
fn resolve_ipsec_layout() -> Result<IpsecLayout, String> {
    for candidate in SYSTEM_LAYOUTS {
        if let Some(layout) = validate_layout_candidate(candidate) {
            return Ok(layout);
        }
    }

    #[cfg(target_os = "macos")]
    for candidate in HOMEBREW_LAYOUTS {
        if let Some(layout) = validate_layout_candidate(candidate) {
            return Ok(layout);
        }
    }

    #[cfg(target_os = "macos")]
    return Err(
        "No trusted strongSwan installation was found. Supported macOS Homebrew locations are /opt/homebrew/bin/ipsec (Apple Silicon) and /usr/local/bin/ipsec (Intel); reinstall strongSwan if either executable is group/world writable"
            .to_string(),
    );

    #[cfg(not(target_os = "macos"))]
    Err("No trusted root-owned, non-writable strongSwan ipsec binary was found".to_string())
}

#[cfg(not(windows))]
fn validate_layout_candidate(candidate: &LayoutCandidate) -> Option<IpsecLayout> {
    let configured_binary = Path::new(candidate.binary);
    let canonical_binary = if candidate.allow_user_owned {
        std::fs::canonicalize(configured_binary).ok()?
    } else {
        resolve_trusted_root_executable(configured_binary)?
    };
    let metadata = std::fs::metadata(&canonical_binary).ok()?;
    if !metadata.is_file() || metadata.mode() & 0o022 != 0 || metadata.mode() & 0o111 == 0 {
        return None;
    }

    if candidate.allow_user_owned {
        let expected_prefix = Path::new(candidate.config_root).parent()?;
        // SAFETY: geteuid has no preconditions and only returns process state.
        let current_uid = unsafe { libc::geteuid() };
        if !canonical_binary.starts_with(expected_prefix)
            || (metadata.uid() != 0 && metadata.uid() != current_uid)
        {
            return None;
        }
    } else if metadata.uid() != 0 {
        return None;
    }

    let layout = IpsecLayout {
        binary: canonical_binary,
        config_root: PathBuf::from(candidate.config_root),
        // Homebrew prefixes are controlled by the login user. Executing or
        // writing through them as root would cross an unsafe trust boundary;
        // those layouts are therefore direct-access only.
        allow_elevation: !candidate.allow_user_owned,
    };
    if layout.allow_elevation && validate_privileged_path(&layout, &layout.config_root).is_err() {
        return None;
    }
    Some(layout)
}

#[cfg(not(windows))]
fn require_elevation_allowed(layout: &IpsecLayout, operation: &str) -> Result<(), String> {
    if layout.allow_elevation {
        Ok(())
    } else {
        Err(format!(
            "Cannot {operation} with administrator privileges from a user-owned Homebrew prefix. Run strongSwan through a separately installed root-owned service/helper, or grant the current user the required direct access; SortOfRemoteNG will not elevate a user-owned executable"
        ))
    }
}

#[cfg(not(windows))]
fn validate_privileged_path(layout: &IpsecLayout, destination: &Path) -> Result<(), String> {
    if !destination.starts_with(&layout.config_root) {
        return Err(
            "Refusing privileged access outside the strongSwan configuration root".to_string(),
        );
    }
    let canonical_root = std::fs::canonicalize(&layout.config_root).map_err(|error| {
        format!(
            "Failed to resolve strongSwan configuration root {}: {error}",
            layout.config_root.display()
        )
    })?;
    let root_metadata = std::fs::metadata(&canonical_root).map_err(|error| {
        format!(
            "Failed to inspect strongSwan configuration root {}: {error}",
            canonical_root.display()
        )
    })?;
    if !root_metadata.is_dir() || root_metadata.uid() != 0 || root_metadata.mode() & 0o022 != 0 {
        return Err(format!(
            "Refusing privileged strongSwan access because {} is not a root-owned, non-group/world-writable directory",
            canonical_root.display()
        ));
    }

    let parent_search_root = if destination == layout.config_root {
        destination
    } else {
        destination.parent().unwrap_or(destination)
    };
    let existing_parent = parent_search_root
        .ancestors()
        .find(|candidate| candidate.exists())
        .ok_or_else(|| "No existing parent for strongSwan destination".to_string())?;
    let canonical_parent = std::fs::canonicalize(existing_parent).map_err(|error| {
        format!(
            "Failed to resolve strongSwan destination parent {}: {error}",
            existing_parent.display()
        )
    })?;
    let parent_metadata = std::fs::metadata(&canonical_parent).map_err(|error| {
        format!(
            "Failed to inspect strongSwan destination parent {}: {error}",
            canonical_parent.display()
        )
    })?;
    if !canonical_parent.starts_with(&canonical_root)
        || !parent_metadata.is_dir()
        || parent_metadata.uid() != 0
        || parent_metadata.mode() & 0o022 != 0
    {
        return Err("Refusing an unsafe strongSwan destination parent".to_string());
    }

    if let Ok(metadata) = std::fs::symlink_metadata(destination) {
        if metadata.file_type().is_symlink() || metadata.uid() != 0 || metadata.mode() & 0o022 != 0
        {
            return Err(format!(
                "Refusing privileged access to unsafe strongSwan path {}",
                destination.display()
            ));
        }
    }
    Ok(())
}

#[cfg(not(windows))]
async fn ensure_managed_includes(layout: &IpsecLayout) -> Result<(), String> {
    let fragment_directory = layout.config_root.join("ipsec.d");
    ensure_directory(layout, &fragment_directory).await?;

    let config_include = format!("include {}/sorng_*.conf", fragment_directory.display());
    let secrets_include = format!("include {}/sorng_*.secrets", fragment_directory.display());
    ensure_managed_include(
        layout,
        &layout.config_root.join("ipsec.conf"),
        &config_include,
        "644",
    )
    .await?;
    ensure_sensitive_managed_include(
        layout,
        &layout.config_root.join("ipsec.secrets"),
        &secrets_include,
    )
    .await
}

#[cfg(not(windows))]
async fn ensure_directory(layout: &IpsecLayout, path: &Path) -> Result<(), String> {
    match tokio::fs::create_dir_all(path).await {
        Ok(()) => {
            if layout.allow_elevation {
                validate_privileged_path(layout, path)?;
            }
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
            require_elevation_allowed(layout, "create the strongSwan fragment directory")?;
            validate_privileged_path(layout, path)?;
            let mkdir = trusted_binary(TRUSTED_MKDIR_BINARIES, "mkdir")?;
            let arguments = vec!["-p".to_string(), path.to_string_lossy().into_owned()];
            let output = run_elevated(
                &mkdir,
                &arguments,
                "create IPsec configuration directory",
                PRIVILEGED_FILE_TIMEOUT,
            )
            .await?;
            if output.status.success() {
                Ok(())
            } else {
                Err(command_failure(
                    "create privileged IPsec configuration directory",
                    &output,
                ))
            }
        }
        Err(error) => Err(format!(
            "Failed to create IPsec configuration directory {}: {error}",
            path.display()
        )),
    }
}

#[cfg(not(windows))]
async fn ensure_managed_include(
    layout: &IpsecLayout,
    path: &Path,
    include_line: &str,
    mode: &str,
) -> Result<(), String> {
    let read_path = path.to_path_buf();
    let read_task = tokio::task::spawn_blocking(move || {
        read_bounded_regular_file(&read_path, MANAGED_CONFIG_LIMIT)
    });
    let read_result = tokio::time::timeout(FILE_PROCESS_TIMEOUT, read_task)
        .await
        .map_err(|_| format!("Timed out while safely reading {}", path.display()))?
        .map_err(|error| format!("Managed include read task failed: {error}"))?;
    let (existing, initial_identity) = match read_result {
        Ok(Some((bytes, identity))) => (
            String::from_utf8(bytes.to_vec())
                .map(Zeroizing::new)
                .map_err(|_| format!("{} is not valid UTF-8", path.display()))?,
            Some(identity),
        ),
        Ok(None) => (Zeroizing::new(String::new()), None),
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
            if verify_managed_include_elevated(layout, path, include_line).await? {
                return Ok(());
            }
            return Err(format!(
                "The protected strongSwan file {} does not contain the required managed include. Ask an administrator to add this exact line once: {include_line}",
                path.display()
            ));
        }
        Err(error) => return Err(format!("Failed to read {}: {error}", path.display())),
    };
    verify_file_unchanged(path, initial_identity).await?;
    let Some(updated) = append_managed_include(&existing, include_line)? else {
        return Ok(());
    };
    verify_file_unchanged(path, initial_identity).await?;
    install_private_file(layout, path, Zeroizing::new(updated), mode).await
}

#[cfg(not(windows))]
async fn verify_file_unchanged(path: &Path, initial: Option<FileIdentity>) -> Result<(), String> {
    let verify_path = path.to_path_buf();
    let verify_task =
        tokio::task::spawn_blocking(move || -> std::io::Result<Option<FileIdentity>> {
            let current = open_regular_file_no_follow(
                &verify_path,
                libc::O_RDONLY,
                None,
                false,
                MANAGED_CONFIG_LIMIT,
            )?;
            match current {
                Some(file) => Ok(Some(FileIdentity::from_metadata(&file.metadata()?))),
                None => Ok(None),
            }
        });
    let current = tokio::time::timeout(FILE_PROCESS_TIMEOUT, verify_task)
        .await
        .map_err(|_| format!("Timed out while revalidating {}", path.display()))?
        .map_err(|error| format!("Managed include validation task failed: {error}"))?
        .map_err(|error| format!("Failed to revalidate {}: {error}", path.display()))?;
    let unchanged = initial == current;
    if unchanged {
        Ok(())
    } else {
        Err(format!(
            "{} changed while SortOfRemoteNG was preparing the managed include; retry the operation",
            path.display()
        ))
    }
}

#[cfg(not(windows))]
async fn verify_managed_include_elevated(
    layout: &IpsecLayout,
    path: &Path,
    include_line: &str,
) -> Result<bool, String> {
    require_elevation_allowed(layout, "verify the protected strongSwan include")?;
    validate_privileged_path(layout, path)?;
    let grep = trusted_binary(TRUSTED_GREP_BINARIES, "grep")?;
    let arguments = vec![
        "-Fqx".to_string(),
        "--".to_string(),
        include_line.to_string(),
        path.to_string_lossy().into_owned(),
    ];
    let output = run_elevated(
        &grep,
        &arguments,
        "verify strongSwan managed include",
        PRIVILEGED_INSPECTION_TIMEOUT,
    )
    .await?;
    if output.status.success() {
        Ok(true)
    } else if output.status.code() == Some(1) {
        Ok(false)
    } else {
        Err(command_failure(
            "verify strongSwan managed include",
            &output,
        ))
    }
}

#[cfg(not(windows))]
fn append_managed_include(existing: &str, include_line: &str) -> Result<Option<String>, String> {
    if existing.len() > MANAGED_CONFIG_LIMIT {
        return Err(format!(
            "Existing strongSwan configuration exceeds the {MANAGED_CONFIG_LIMIT}-byte safety limit"
        ));
    }
    if include_line.len() > INCLUDE_LINE_LIMIT {
        return Err("Managed include line exceeds the safety limit".to_string());
    }
    if managed_include_present(existing, include_line) {
        return Ok(None);
    }

    const MANAGED_BLOCK_PREFIX: &str = "# SortOfRemoteNG managed connection fragments\n";
    let separator_bytes = usize::from(!existing.is_empty() && !existing.ends_with('\n'))
        + usize::from(!existing.is_empty());
    let capacity = existing
        .len()
        .checked_add(separator_bytes)
        .and_then(|size| size.checked_add(MANAGED_BLOCK_PREFIX.len()))
        .and_then(|size| size.checked_add(include_line.len()))
        .and_then(|size| size.checked_add(1))
        .filter(|size| *size <= MANAGED_CONFIG_LIMIT)
        .ok_or_else(|| {
            format!(
                "Updated strongSwan configuration would exceed the {MANAGED_CONFIG_LIMIT}-byte safety limit"
            )
        })?;
    let mut updated = String::with_capacity(capacity);
    updated.push_str(existing);
    if !updated.is_empty() && !updated.ends_with('\n') {
        updated.push('\n');
    }
    if !updated.is_empty() {
        updated.push('\n');
    }
    updated.push_str(MANAGED_BLOCK_PREFIX);
    updated.push_str(include_line);
    updated.push('\n');
    Ok(Some(updated))
}

#[cfg(not(windows))]
fn managed_include_present(existing: &str, include_line: &str) -> bool {
    let accepted = covering_include_lines(include_line);
    existing
        .lines()
        .map(str::trim)
        .any(|line| accepted.iter().any(|candidate| line == candidate))
}

#[cfg(not(windows))]
fn covering_include_lines(include_line: &str) -> Vec<String> {
    let mut lines = vec![include_line.to_string()];
    if let Some((prefix, extension)) = include_line.rsplit_once("sorng_*.") {
        lines.push(format!("{prefix}*.{extension}"));
        lines.push(format!("{prefix}*"));
    }
    lines
}

/// Ensure the global secrets file references our fragments without ever
/// reading or rewriting its contents. Direct access uses a locked O_APPEND
/// write of a fixed literal; protected files are only probed with grep and
/// require a one-time administrator edit when the line is absent.
#[cfg(not(windows))]
async fn ensure_sensitive_managed_include(
    layout: &IpsecLayout,
    path: &Path,
    include_line: &str,
) -> Result<(), String> {
    if layout.allow_elevation {
        validate_privileged_path(layout, path)?;
    }
    let path_owned = path.to_path_buf();
    let accepted = covering_include_lines(include_line);
    let include_owned = include_line.to_string();
    let direct_task = tokio::task::spawn_blocking(move || {
        append_sensitive_include_locked(&path_owned, &accepted, &include_owned)
    });
    let direct = tokio::time::timeout(FILE_PROCESS_TIMEOUT, direct_task)
        .await
        .map_err(|_| "Timed out while safely updating the sensitive include".to_string())?
        .map_err(|_| "Sensitive include task did not complete".to_string())??;
    if direct {
        return Ok(());
    }

    for candidate in covering_include_lines(include_line) {
        if verify_managed_include_elevated(layout, path, &candidate).await? {
            return Ok(());
        }
    }
    Err(format!(
        "The protected strongSwan file {} does not contain an include covering SortOfRemoteNG secrets. Ask an administrator to add this exact line once: {include_line}",
        path.display()
    ))
}

#[cfg(not(windows))]
fn append_sensitive_include_locked(
    path: &Path,
    accepted_lines: &[String],
    include_line: &str,
) -> Result<bool, String> {
    if include_line.len() > INCLUDE_LINE_LIMIT
        || accepted_lines
            .iter()
            .any(|line| line.len() > INCLUDE_LINE_LIMIT)
    {
        return Err("Sensitive include line exceeds the safety limit".to_string());
    }
    let mut file = match open_regular_file_no_follow(
        path,
        libc::O_RDWR | libc::O_APPEND,
        Some(0o600),
        true,
        MANAGED_CONFIG_LIMIT,
    ) {
        Ok(Some(file)) => file,
        Ok(None) => return Err("Sensitive include file unexpectedly disappeared".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => return Ok(false),
        Err(error) => return Err(format!("Failed to open {}: {error}", path.display())),
    };
    // SAFETY: file is a verified regular-file descriptor for this scope.
    if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) } != 0 {
        return Err(format!("Failed to lock {}", path.display()));
    }
    let result = (|| {
        let metadata = validate_regular_descriptor(&file, true, MANAGED_CONFIG_LIMIT)
            .map_err(|error| format!("Refusing unsafe {}: {error}", path.display()))?;
        if file_contains_exact_line(&file, accepted_lines, MANAGED_CONFIG_LIMIT)
            .map_err(|_| format!("Failed to inspect {}", path.display()))?
        {
            return Ok(());
        }
        const PREFIX: &str = "\n# SortOfRemoteNG managed connection fragments\n";
        let block_size = PREFIX
            .len()
            .checked_add(include_line.len())
            .and_then(|size| size.checked_add(1))
            .ok_or_else(|| "Sensitive include size overflowed".to_string())?;
        let final_size = usize::try_from(metadata.len())
            .ok()
            .and_then(|size| size.checked_add(block_size))
            .filter(|size| *size <= MANAGED_CONFIG_LIMIT)
            .ok_or_else(|| {
                format!(
                    "Sensitive include append would exceed the {MANAGED_CONFIG_LIMIT}-byte safety limit"
                )
            })?;
        let mut block = String::with_capacity(block_size.min(final_size));
        block.push_str(PREFIX);
        block.push_str(include_line);
        block.push('\n');
        file.write_all(block.as_bytes())
            .map_err(|error| format!("Failed to append {}: {error}", path.display()))?;
        file.sync_data()
            .map_err(|error| format!("Failed to sync {}: {error}", path.display()))
    })();
    // SAFETY: releasing a lock held on the same valid descriptor.
    let unlock_result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_UN) };
    match (result, unlock_result) {
        (Ok(()), 0) => Ok(true),
        (Ok(()), _) => Err(format!("Failed to unlock {}", path.display())),
        (Err(error), _) => Err(error),
    }
}

#[cfg(not(windows))]
fn file_contains_exact_line(
    file: &std::fs::File,
    accepted_lines: &[String],
    size_limit: usize,
) -> std::io::Result<bool> {
    let mut offset = 0_u64;
    let mut chunk = [0_u8; 4096];
    let mut line = Zeroizing::new(Vec::with_capacity(INCLUDE_LINE_LIMIT.min(1024)));
    let mut line_overflowed = false;

    loop {
        if offset >= size_limit as u64 {
            let mut extra = [0_u8; 1];
            return if file.read_at(&mut extra, offset)? == 0 {
                Ok(!line_overflowed && exact_line_matches(&line, accepted_lines))
            } else {
                Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("file exceeds the {size_limit}-byte safety limit"),
                ))
            };
        }
        let remaining = (size_limit as u64 - offset) as usize;
        let chunk_length = remaining.min(chunk.len());
        let count = file.read_at(&mut chunk[..chunk_length], offset)?;
        if count == 0 {
            return Ok(!line_overflowed && exact_line_matches(&line, accepted_lines));
        }
        offset = offset.saturating_add(count as u64);
        for byte in &chunk[..count] {
            if *byte == b'\n' {
                if !line_overflowed && exact_line_matches(&line, accepted_lines) {
                    return Ok(true);
                }
                line.zeroize();
                line.clear();
                line_overflowed = false;
            } else if !line_overflowed {
                if line.len() < INCLUDE_LINE_LIMIT {
                    line.push(*byte);
                } else {
                    line.zeroize();
                    line.clear();
                    line_overflowed = true;
                }
            }
        }
    }
}

#[cfg(not(windows))]
fn exact_line_matches(line: &[u8], accepted_lines: &[String]) -> bool {
    let line = line.strip_suffix(b"\r").unwrap_or(line);
    accepted_lines
        .iter()
        .any(|accepted| line == accepted.as_bytes())
}

/// Write a validated ipsec.conf connection block. The rendered file is first
/// created as a private 0600 temporary file and then installed into /etc. When
/// the direct install is not permitted, Linux may use the trusted `pkexec`
/// broker instead of attempting to embed data in a privileged shell command.
#[cfg(not(windows))]
pub async fn write_ipsec_conf(spec: IpsecConnectionSpec<'_>) -> Result<String, String> {
    let config = render_ipsec_conf(&spec)?;
    let layout = resolve_ipsec_layout()?;
    ensure_managed_includes(&layout).await?;
    let config_path = protected_path(&layout, spec.conn_name, "conf")?;
    install_private_file(&layout, &config_path, Zeroizing::new(config), "600").await?;
    Ok(config_path.to_string_lossy().into_owned())
}

/// Write the transport-mode IKEv1 policy required by L2TP/IPsec. L2TP must
/// not reuse an IKEv2 tunnel-mode policy: its protected traffic is UDP/1701
/// between the two IPsec peers.
#[cfg(not(windows))]
pub async fn write_l2tp_ipsec_conf(
    conn_name: &str,
    server: &str,
    phase1: Option<&str>,
    phase2: Option<&str>,
) -> Result<String, String> {
    let config = render_l2tp_ipsec_conf(conn_name, server, phase1, phase2)?;
    let layout = resolve_ipsec_layout()?;
    ensure_managed_includes(&layout).await?;
    let config_path = protected_path(&layout, conn_name, "conf")?;
    install_private_file(&layout, &config_path, Zeroizing::new(config), "600").await?;
    Ok(config_path.to_string_lossy().into_owned())
}

/// Write a validated ipsec.secrets entry. Secret content is kept out of child
/// process arguments and is zeroized after the private temporary file is
/// written.
#[cfg(not(windows))]
pub async fn write_ipsec_secrets(
    conn_name: &str,
    local_id: Option<&str>,
    remote_id: &str,
    secret_type: &str,
    secret_value: &str,
) -> Result<String, String> {
    let content = render_ipsec_secrets(conn_name, local_id, remote_id, secret_type, secret_value)?;
    let layout = resolve_ipsec_layout()?;
    ensure_managed_includes(&layout).await?;
    let secrets_path = protected_path(&layout, conn_name, "secrets")?;
    install_private_file(&layout, &secrets_path, content, "600").await?;
    Ok(secrets_path.to_string_lossy().into_owned())
}

#[cfg(not(windows))]
fn render_remote_subnets(remote_subnets: &[String]) -> Result<String, String> {
    if remote_subnets.is_empty() {
        return Err("At least one remote subnet is required".to_string());
    }
    if remote_subnets.len() > REMOTE_SUBNET_COUNT_LIMIT {
        return Err(format!(
            "Remote subnet count exceeds the {REMOTE_SUBNET_COUNT_LIMIT}-entry safety limit"
        ));
    }
    let mut rendered_size = remote_subnets.len().saturating_sub(1);
    for (index, subnet) in remote_subnets.iter().enumerate() {
        crate::routing::validate_cidr(subnet)
            .map_err(|reason| format!("remote subnet item {} is invalid: {reason}", index + 1))?;
        rendered_size = rendered_size
            .checked_add(subnet.len())
            .filter(|size| *size <= REMOTE_SUBNET_BYTES_LIMIT)
            .ok_or_else(|| {
                format!(
                    "Remote subnet input exceeds the {REMOTE_SUBNET_BYTES_LIMIT}-byte safety limit"
                )
            })?;
    }
    let mut rendered = String::with_capacity(rendered_size);
    for (index, subnet) in remote_subnets.iter().enumerate() {
        if index != 0 {
            rendered.push(',');
        }
        rendered.push_str(subnet);
    }
    Ok(rendered)
}

#[cfg(not(windows))]
fn render_ipsec_conf(spec: &IpsecConnectionSpec<'_>) -> Result<String, String> {
    validate_connection_name(spec.conn_name)?;
    validation::validate_hostname(spec.server)?;
    let local_auth = validate_auth_method(spec.local_auth)?;
    let remote_auth = validate_auth_method(spec.remote_auth)?;
    let local_id = quote_ipsec_value(spec.local_id.unwrap_or("%any"), "local identity")?;
    let remote_id = quote_ipsec_value(spec.remote_id.unwrap_or(spec.server), "remote identity")?;
    let eap_identity = spec
        .eap_identity
        .map(|value| quote_ipsec_value(value, "EAP identity"))
        .transpose()?;
    let phase1 = validate_proposal(spec.phase1.unwrap_or("aes256-sha256-modp2048"), "IKE")?;
    let phase2 = validate_proposal(spec.phase2.unwrap_or("aes256-sha256"), "ESP")?;
    let remote_subnets = render_remote_subnets(spec.remote_subnets)?;

    let eap_identity_line = eap_identity
        .map(|value| format!("    eap_identity={value}\n"))
        .unwrap_or_default();

    ensure_ipsec_content_limit(format!(
        "conn {}\n    type=tunnel\n    left=%defaultroute\n    leftsourceip=%config\n    leftid={local_id}\n    leftauth={local_auth}\n{eap_identity_line}    right={}\n    rightid={remote_id}\n    rightauth={remote_auth}\n    rightsubnet={remote_subnets}\n    ike={phase1}\n    esp={phase2}\n    keyexchange=ikev2\n    auto=add\n",
        spec.conn_name, spec.server
    ))
}

#[cfg(not(windows))]
fn render_l2tp_ipsec_conf(
    conn_name: &str,
    server: &str,
    phase1: Option<&str>,
    phase2: Option<&str>,
) -> Result<String, String> {
    validate_connection_name(conn_name)?;
    validation::validate_hostname(server)?;
    let phase1 = validate_proposal(phase1.unwrap_or("aes256-sha256-modp2048"), "IKE")?;
    let phase2 = validate_proposal(phase2.unwrap_or("aes256-sha256"), "ESP")?;
    ensure_ipsec_content_limit(format!(
        "conn {conn_name}\n    type=transport\n    left=%defaultroute\n    leftauth=psk\n    leftprotoport=17/%any\n    right={server}\n    rightauth=psk\n    rightprotoport=17/1701\n    ike={phase1}\n    esp={phase2}\n    keyexchange=ikev1\n    auto=add\n"
    ))
}

#[cfg(not(windows))]
fn render_ipsec_secrets(
    conn_name: &str,
    local_id: Option<&str>,
    remote_id: &str,
    secret_type: &str,
    secret_value: &str,
) -> Result<Zeroizing<String>, String> {
    validate_connection_name(conn_name)?;
    let local = quote_ipsec_secret_selector(local_id.unwrap_or("%any"), "local identity")?;
    let remote = quote_ipsec_secret_selector(remote_id, "remote identity")?;
    if secret_value.is_empty() {
        return Err("IPsec secret must not be empty".to_string());
    }
    if secret_value.len() > IPSEC_SECRET_LIMIT {
        return Err(format!(
            "IPsec secret exceeds the {IPSEC_SECRET_LIMIT}-byte safety limit"
        ));
    }

    let content = match secret_type {
        // strongSwan's stroke parser accepts RFC 4648 base64 after the `0s`
        // prefix. Unlike quoted ipsec.secrets values, this form is reversible
        // for every byte and cannot terminate the line or quoted token early.
        "PSK" => format!(
            "{local} {remote} : PSK 0s{}\n",
            BASE64_STANDARD.encode(secret_value.as_bytes())
        ),
        "EAP" => format!(
            "{local} : EAP 0s{}\n",
            BASE64_STANDARD.encode(secret_value.as_bytes())
        ),
        "RSA" => {
            validation::validate_path_safe(secret_value)?;
            format!(
                ": RSA {}\n",
                quote_ipsec_secret_selector(secret_value, "RSA private key path")?
            )
        }
        _ => return Err("Unsupported IPsec secret type".to_string()),
    };
    ensure_ipsec_content_limit(content).map(Zeroizing::new)
}

#[cfg(not(windows))]
fn ensure_ipsec_content_limit(content: String) -> Result<String, String> {
    if content.len() > IPSEC_FILE_LIMIT {
        Err(format!(
            "Rendered IPsec content exceeds the {IPSEC_FILE_LIMIT}-byte safety limit"
        ))
    } else {
        Ok(content)
    }
}

#[cfg(not(windows))]
fn validate_connection_name(value: &str) -> Result<&str, String> {
    if value.is_empty() || value.len() > 128 {
        return Err("IPsec connection name must contain 1-128 characters".to_string());
    }
    if value
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        Ok(value)
    } else {
        Err("IPsec connection name contains invalid characters".to_string())
    }
}

#[cfg(not(windows))]
fn validate_auth_method(value: &str) -> Result<&str, String> {
    match value {
        "psk" | "pubkey" | "eap-mschapv2" | "eap-tls" | "eap-peap" => Ok(value),
        _ => Err("Unsupported strongSwan authentication method".to_string()),
    }
}

#[cfg(not(windows))]
fn validate_proposal<'a>(value: &'a str, label: &str) -> Result<&'a str, String> {
    if value.is_empty() || value.len() > 512 {
        return Err(format!("{label} proposal must contain 1-512 characters"));
    }
    if value.chars().all(|character| {
        character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ',' | '+' | '!')
    }) {
        Ok(value)
    } else {
        Err(format!("{label} proposal contains invalid characters"))
    }
}

#[cfg(not(windows))]
fn quote_ipsec_value(value: &str, label: &str) -> Result<String, String> {
    if value.is_empty() || value.len() > 4096 {
        return Err(format!("{label} must contain 1-4096 characters"));
    }
    if value.chars().any(char::is_control) {
        return Err(format!("{label} must not contain control characters"));
    }
    Ok(format!(
        "\"{}\"",
        value.replace('\\', "\\\\").replace('"', "\\\"")
    ))
}

#[cfg(not(windows))]
fn quote_ipsec_secret_selector(value: &str, label: &str) -> Result<String, String> {
    if value.is_empty() || value.len() > 4096 {
        return Err(format!("{label} must contain 1-4096 characters"));
    }
    if value.chars().any(char::is_control) || value.contains('"') {
        return Err(format!(
            "{label} must not contain control characters or double quotes"
        ));
    }
    // ipsec.secrets' stroke parser does not unescape backslashes in quoted
    // selectors, so preserve them byte-for-byte and reject the only character
    // that could terminate the token.
    Ok(format!("\"{value}\""))
}

#[cfg(not(windows))]
fn protected_path(
    layout: &IpsecLayout,
    conn_name: &str,
    extension: &str,
) -> Result<PathBuf, String> {
    validate_connection_name(conn_name)?;
    Ok(layout
        .config_root
        .join("ipsec.d")
        .join(format!("sorng_{conn_name}.{extension}")))
}

#[cfg(not(windows))]
async fn install_private_file(
    layout: &IpsecLayout,
    destination: &Path,
    content: Zeroizing<String>,
    mode: &str,
) -> Result<(), String> {
    let create_task = tokio::task::spawn_blocking(move || PrivateStagingFile::create(content));
    let staging = tokio::time::timeout(FILE_PROCESS_TIMEOUT, create_task)
        .await
        .map_err(|_| "Timed out while creating private IPsec staging material".to_string())?
        .map_err(|error| format!("Private IPsec file task failed: {error}"))??;

    let install_result = install_file(layout, &staging.payload_path, destination, mode).await;
    let cleanup_task = tokio::task::spawn_blocking(move || staging.cleanup());
    let cleanup_result = match tokio::time::timeout(FILE_PROCESS_TIMEOUT, cleanup_task).await {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => Err(format!("Private IPsec cleanup task failed: {error}")),
        Err(_) => Err("Timed out while removing private IPsec staging material".to_string()),
    };
    finalize_install_result(install_result, cleanup_result)
}

#[cfg(not(windows))]
fn finalize_install_result(
    install_result: Result<(), String>,
    cleanup_result: Result<(), String>,
) -> Result<(), String> {
    match (install_result, cleanup_result) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(error), Ok(())) => Err(error),
        (Ok(()), Err(cleanup_error)) => Err(format!(
            "IPsec configuration was installed, but sensitive staging cleanup failed; refusing to report success: {cleanup_error}"
        )),
        (Err(error), Err(cleanup_error)) => Err(format!(
            "{error}; sensitive staging cleanup also failed: {cleanup_error}"
        )),
    }
}

#[cfg(not(windows))]
fn validate_install_destination(layout: &IpsecLayout, destination: &Path) -> Result<(), String> {
    if !destination.starts_with(&layout.config_root) {
        return Err("Refusing IPsec installation outside the configured root".to_string());
    }
    let parent = destination
        .parent()
        .ok_or_else(|| "IPsec installation destination has no parent".to_string())?;
    open_verified_directory(parent).map_err(|error| {
        format!(
            "Refusing unsafe IPsec installation parent {}: {error}",
            parent.display()
        )
    })?;
    match std::fs::symlink_metadata(destination) {
        Ok(metadata) => {
            // SAFETY: geteuid has no preconditions and only returns process state.
            let current_uid = unsafe { libc::geteuid() };
            if metadata.file_type().is_symlink()
                || !metadata.is_file()
                || (metadata.uid() != 0 && metadata.uid() != current_uid)
                || metadata.mode() & 0o022 != 0
            {
                return Err(format!(
                    "Refusing unsafe IPsec installation destination {}",
                    destination.display()
                ));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "Failed to inspect IPsec installation destination {}: {error}",
                destination.display()
            ))
        }
    }
    Ok(())
}

#[cfg(not(windows))]
async fn install_file(
    layout: &IpsecLayout,
    source: &Path,
    destination: &Path,
    mode: &str,
) -> Result<(), String> {
    let mode = match mode {
        "600" | "644" => mode,
        _ => return Err("Unsupported IPsec file mode".to_string()),
    };
    validate_install_destination(layout, destination)?;
    if layout.allow_elevation {
        validate_privileged_path(layout, destination)?;
    }
    let install = trusted_binary(TRUSTED_INSTALL_BINARIES, "install")?;
    let arguments = vec![
        "-m".to_string(),
        mode.to_string(),
        source.to_string_lossy().into_owned(),
        destination.to_string_lossy().into_owned(),
    ];
    let output = run_bounded_command(
        &install,
        &arguments,
        "install IPsec configuration",
        FILE_PROCESS_TIMEOUT,
    )
    .await?;
    if output.status.success() {
        return Ok(());
    }

    if looks_like_permission_failure(&output) {
        require_elevation_allowed(layout, "install strongSwan configuration")?;
        validate_install_destination(layout, destination)?;
        validate_privileged_path(layout, destination)?;
        let elevated = run_elevated(
            &install,
            &arguments,
            "install IPsec configuration",
            PRIVILEGED_FILE_TIMEOUT,
        )
        .await?;
        if elevated.status.success() {
            return Ok(());
        }
        return Err(command_failure(
            "Privileged IPsec configuration install",
            &elevated,
        ));
    }
    Err(command_failure("install IPsec configuration", &output))
}

/// Bring up an IPsec connection via `ipsec up`.
#[cfg(not(windows))]
pub async fn ipsec_up(conn_name: &str) -> Result<(), String> {
    validate_connection_name(conn_name)?;
    run_ipsec(&["reload"], "reload IPsec configuration").await?;
    run_ipsec(&["rereadsecrets"], "reload IPsec secrets").await?;
    run_ipsec(&["up", conn_name], "bring up IPsec connection").await?;
    Ok(())
}

/// Bring a connection up and attempt a down operation if startup reports an
/// error, since strongSwan may have installed a partial CHILD_SA before the
/// command failed. Managed files are also removed even when `ipsec down`
/// fails, and every rollback failure is surfaced to the caller.
#[cfg(not(windows))]
pub async fn ipsec_up_transactional(conn_name: &str) -> Result<(), String> {
    validate_connection_name(conn_name)?;
    run_ipsec_transaction(&SystemIpsecTransactionRunner, conn_name).await
}

#[cfg(not(windows))]
#[async_trait::async_trait]
trait IpsecTransactionRunner: Send + Sync {
    async fn setup(&self, conn_name: &str) -> Result<(), String>;
    async fn down(&self, conn_name: &str) -> Result<(), String>;
    async fn cleanup(&self, conn_name: &str) -> Result<(), String>;
}

#[cfg(not(windows))]
struct SystemIpsecTransactionRunner;

#[cfg(not(windows))]
#[async_trait::async_trait]
impl IpsecTransactionRunner for SystemIpsecTransactionRunner {
    async fn setup(&self, conn_name: &str) -> Result<(), String> {
        ipsec_up(conn_name).await
    }

    async fn down(&self, conn_name: &str) -> Result<(), String> {
        ipsec_down(conn_name).await
    }

    async fn cleanup(&self, conn_name: &str) -> Result<(), String> {
        cleanup_ipsec_files(conn_name).await
    }
}

#[cfg(not(windows))]
async fn run_ipsec_transaction<R: IpsecTransactionRunner + ?Sized>(
    runner: &R,
    conn_name: &str,
) -> Result<(), String> {
    let Err(setup_error) = runner.setup(conn_name).await else {
        return Ok(());
    };

    let down_error = runner.down(conn_name).await.err();
    let cleanup_error = runner.cleanup(conn_name).await.err();
    let mut errors = vec![setup_error];
    if let Some(error) = down_error {
        errors.push(format!(
            "additionally failed to tear down the partial IPsec security association: {error}"
        ));
    }
    if let Some(error) = cleanup_error {
        errors.push(format!(
            "additionally failed to clean up the partial IPsec configuration: {error}"
        ));
    }
    Err(errors.join("; "))
}

/// Bring down an IPsec connection via `ipsec down`.
#[cfg(not(windows))]
pub async fn ipsec_down(conn_name: &str) -> Result<(), String> {
    validate_connection_name(conn_name)?;
    run_ipsec(&["down", conn_name], "bring down IPsec connection").await?;
    Ok(())
}

#[cfg(not(windows))]
async fn run_ipsec(arguments: &[&str], operation: &str) -> Result<BoundedOutput, String> {
    let layout = resolve_ipsec_layout()?;
    let owned_arguments: Vec<String> = arguments.iter().map(|value| (*value).to_string()).collect();
    let deadline = ipsec_command_timeout(arguments);
    let output = run_bounded_command(&layout.binary, &owned_arguments, operation, deadline).await?;
    if output.status.success() {
        return Ok(output);
    }

    if looks_like_permission_failure(&output) {
        require_elevation_allowed(&layout, operation)?;
        validate_privileged_path(&layout, &layout.config_root)?;
        let elevated = run_elevated(
            &layout.binary,
            &owned_arguments,
            operation,
            deadline.saturating_add(ELEVATION_PROMPT_ALLOWANCE),
        )
        .await?;
        if elevated.status.success() {
            return Ok(elevated);
        }
        return Err(command_failure(operation, &elevated));
    }

    Err(command_failure(operation, &output))
}

#[cfg(not(windows))]
async fn run_elevated(
    binary: &Path,
    arguments: &[String],
    operation: &str,
    deadline: Duration,
) -> Result<BoundedOutput, String> {
    #[cfg(target_os = "linux")]
    {
        return run_pkexec(binary, arguments, operation, deadline).await;
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = (binary, arguments, deadline);
        Err(format!(
            "Administrator privileges are required to {operation}, but this build has no signed privileged-helper boundary; refusing to elevate strongSwan directly"
        ))
    }
}

#[cfg(all(not(windows), target_os = "linux"))]
async fn run_pkexec(
    binary: &Path,
    arguments: &[String],
    operation: &str,
    deadline: Duration,
) -> Result<BoundedOutput, String> {
    let pkexec = trusted_binary(TRUSTED_PKEXEC_BINARIES, "pkexec")?;
    let target = resolve_trusted_root_executable(binary)
        .ok_or_else(|| "Refusing to elevate an untrusted executable".to_string())?;
    let mut command = hardened_command(&pkexec);
    command.arg(target).args(arguments);
    collect_bounded_output(command, operation, deadline).await
}

#[cfg(not(windows))]
fn ipsec_command_timeout(arguments: &[&str]) -> Duration {
    match arguments.first().copied() {
        Some("status") => IPSEC_STATUS_TIMEOUT,
        Some("up") => IPSEC_UP_TIMEOUT,
        Some("down") => IPSEC_DOWN_TIMEOUT,
        _ => IPSEC_CONTROL_TIMEOUT,
    }
}

#[cfg(not(windows))]
async fn run_bounded_command(
    binary: &Path,
    arguments: &[String],
    operation: &str,
    deadline: Duration,
) -> Result<BoundedOutput, String> {
    let mut command = hardened_command(binary);
    command.args(arguments);
    collect_bounded_output(command, operation, deadline).await
}

#[cfg(not(windows))]
fn hardened_command(binary: &Path) -> Command {
    let mut command = Command::new(binary);
    command
        .kill_on_drop(true)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env_clear()
        .env("LC_ALL", "C")
        .env("PATH", TRUSTED_EXEC_PATH);
    command.as_std_mut().process_group(0);
    command
}

#[cfg(not(windows))]
async fn collect_bounded_output(
    mut command: Command,
    operation: &str,
    deadline: Duration,
) -> Result<BoundedOutput, String> {
    let mut child = command
        .spawn()
        .map_err(|_| format!("Failed to start {operation}"))?;
    let process_group = child.id();
    let Some(stdout) = child.stdout.take() else {
        terminate_and_reap(&mut child, process_group).await;
        return Err(format!("Failed to capture {operation} output"));
    };
    let Some(stderr) = child.stderr.take() else {
        terminate_and_reap(&mut child, process_group).await;
        return Err(format!("Failed to capture {operation} output"));
    };

    let completed = tokio::time::timeout(deadline, async {
        let (status, stdout, stderr) = tokio::join!(
            child.wait(),
            capture_bounded(stdout),
            capture_bounded(stderr)
        );
        let status = status?;
        let (stdout, stdout_truncated) = stdout?;
        let (stderr, stderr_truncated) = stderr?;
        Ok::<BoundedOutput, std::io::Error>(BoundedOutput {
            status,
            stdout,
            stderr,
            stdout_truncated,
            stderr_truncated,
        })
    })
    .await;

    match completed {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(_)) => {
            terminate_and_reap(&mut child, process_group).await;
            Err(format!("Failed while waiting for {operation}"))
        }
        Err(_) => {
            terminate_and_reap(&mut child, process_group).await;
            Err(format!("Timed out while attempting to {operation}"))
        }
    }
}

#[cfg(not(windows))]
async fn capture_bounded<R: AsyncRead + Unpin>(
    mut stream: R,
) -> std::io::Result<(Zeroizing<Vec<u8>>, bool)> {
    let mut captured = Zeroizing::new(Vec::with_capacity(PROCESS_OUTPUT_LIMIT.min(8192)));
    let mut chunk = [0_u8; 4096];
    let mut truncated = false;
    loop {
        let count = stream.read(&mut chunk).await?;
        if count == 0 {
            return Ok((captured, truncated));
        }
        let remaining = PROCESS_OUTPUT_LIMIT.saturating_sub(captured.len());
        let retained = remaining.min(count);
        captured.extend_from_slice(&chunk[..retained]);
        truncated |= retained < count;
    }
}

#[cfg(not(windows))]
async fn terminate_and_reap(child: &mut Child, process_group: Option<u32>) {
    if let Some(process_group) = process_group.filter(|value| *value <= i32::MAX as u32) {
        // SAFETY: the child was placed in a new process group whose id is its
        // pid. A negative id targets that group and cannot target this process.
        let _ = unsafe { libc::kill(-(process_group as i32), libc::SIGKILL) };
    }
    let _ = child.start_kill();
    let _ = tokio::time::timeout(PROCESS_REAP_TIMEOUT, child.wait()).await;
}

#[cfg(not(windows))]
fn trusted_binary(candidates: &[&str], name: &str) -> Result<PathBuf, String> {
    for candidate in candidates {
        if let Some(path) = resolve_trusted_root_executable(Path::new(candidate)) {
            return Ok(path);
        }
    }
    Err(format!(
        "No trusted root-owned, non-writable {name} binary was found"
    ))
}

#[cfg(not(windows))]
fn resolve_trusted_root_executable(path: &Path) -> Option<PathBuf> {
    if !path.is_absolute() {
        return None;
    }
    let canonical = std::fs::canonicalize(path).ok()?;
    let metadata = std::fs::metadata(&canonical).ok()?;
    if !metadata.is_file()
        || metadata.uid() != 0
        || metadata.mode() & 0o022 != 0
        || metadata.mode() & 0o111 == 0
    {
        return None;
    }
    for ancestor in canonical.parent()?.ancestors() {
        let metadata = std::fs::metadata(ancestor).ok()?;
        if !metadata.is_dir() || metadata.uid() != 0 || metadata.mode() & 0o022 != 0 {
            return None;
        }
    }
    Some(canonical)
}

#[cfg(not(windows))]
fn looks_like_permission_failure(output: &BoundedOutput) -> bool {
    let diagnostic = Zeroizing::new(
        format!(
            "{}\n{}",
            String::from_utf8_lossy(&output.stderr),
            String::from_utf8_lossy(&output.stdout)
        )
        .to_ascii_lowercase(),
    );
    diagnostic.contains("permission denied")
        || diagnostic.contains("operation not permitted")
        || diagnostic.contains("not authorized")
        || diagnostic.contains("must be root")
}

#[cfg(not(windows))]
fn command_failure(operation: &str, output: &BoundedOutput) -> String {
    let status = output
        .status
        .code()
        .map(|code| format!("exit code {code}"))
        .unwrap_or_else(|| "terminated by signal".to_string());
    let truncation = if output.stdout_truncated || output.stderr_truncated {
        "; diagnostic output exceeded the safety limit"
    } else {
        ""
    };
    format!("Failed to {operation} ({status}{truncation})")
}

/// Remove IPsec config and secrets files for a connection.
#[cfg(not(windows))]
pub async fn cleanup_ipsec_files(conn_name: &str) -> Result<(), String> {
    let layout = resolve_ipsec_layout()?;
    let config_path = protected_path(&layout, conn_name, "conf")?;
    let secrets_path = protected_path(&layout, conn_name, "secrets")?;
    let mut errors = Vec::new();
    if let Err(error) = remove_protected_file(&layout, &config_path).await {
        errors.push(error);
    }
    if let Err(error) = remove_protected_file(&layout, &secrets_path).await {
        errors.push(error);
    }
    if let Err(error) = run_ipsec(&["reload"], "reload IPsec configuration").await {
        errors.push(error);
    }
    if let Err(error) = run_ipsec(&["rereadsecrets"], "reload IPsec secrets").await {
        errors.push(error);
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

/// Reconcile a deterministic strongSwan connection and remove its managed
/// files. Every step is attempted and failures are returned together so a
/// caller never reports Disconnected after uncertain teardown.
#[cfg(not(windows))]
pub async fn teardown_ipsec_connection(conn_name: &str) -> Result<(), String> {
    validate_connection_name(conn_name)?;
    let mut errors = Vec::new();
    match is_ipsec_active(conn_name).await {
        Ok(true) => {
            if let Err(error) = ipsec_down(conn_name).await {
                errors.push(error);
            }
        }
        Ok(false) => {}
        Err(error) => errors.push(error),
    }
    if let Err(error) = cleanup_ipsec_files(conn_name).await {
        errors.push(error);
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

#[cfg(not(windows))]
async fn remove_protected_file(layout: &IpsecLayout, path: &Path) -> Result<(), String> {
    match tokio::fs::remove_file(path).await {
        Ok(()) => return Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) if error.kind() != std::io::ErrorKind::PermissionDenied => {
            return Err(format!("Failed to remove {}: {error}", path.display()))
        }
        Err(_) => {}
    }

    require_elevation_allowed(layout, "remove strongSwan configuration")?;
    validate_privileged_path(layout, path)?;
    let rm = trusted_binary(TRUSTED_RM_BINARIES, "rm")?;
    let arguments = vec![path.to_string_lossy().into_owned()];
    let output = run_elevated(
        &rm,
        &arguments,
        "remove IPsec configuration",
        PRIVILEGED_FILE_TIMEOUT,
    )
    .await?;
    if output.status.success() {
        return Ok(());
    }
    Err(command_failure(
        "remove privileged IPsec configuration",
        &output,
    ))
}

/// Check if an IPsec connection is active.
#[cfg(not(windows))]
pub async fn is_ipsec_active(conn_name: &str) -> Result<bool, String> {
    validate_connection_name(conn_name)?;
    let output = run_ipsec(&["status", conn_name], "query IPsec status").await?;
    if output.stdout_truncated {
        return Err("IPsec status output exceeded the safety limit".to_string());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.contains("ESTABLISHED") || stdout.contains("INSTALLED"))
}

// Windows stubs (strongSwan is unavailable; Windows uses RAS).
#[cfg(windows)]
pub async fn write_ipsec_conf(_: IpsecConnectionSpec<'_>) -> Result<String, String> {
    Err("strongSwan is not available on Windows. Use the Windows RAS API.".to_string())
}
#[cfg(windows)]
pub async fn write_l2tp_ipsec_conf(
    _: &str,
    _: &str,
    _: Option<&str>,
    _: Option<&str>,
) -> Result<String, String> {
    Err("strongSwan is not available on Windows. Use the Windows RAS API.".to_string())
}
#[cfg(windows)]
pub async fn write_ipsec_secrets(
    _: &str,
    _: Option<&str>,
    _: &str,
    _: &str,
    _: &str,
) -> Result<String, String> {
    Err("strongSwan is not available on Windows.".to_string())
}
#[cfg(windows)]
pub async fn ipsec_up(_: &str) -> Result<(), String> {
    Err("strongSwan is not available on Windows.".to_string())
}
#[cfg(windows)]
pub async fn ipsec_up_transactional(_: &str) -> Result<(), String> {
    Err("strongSwan is not available on Windows.".to_string())
}
#[cfg(windows)]
pub async fn ipsec_down(_: &str) -> Result<(), String> {
    Err("strongSwan is not available on Windows.".to_string())
}
#[cfg(windows)]
pub async fn cleanup_ipsec_files(_: &str) -> Result<(), String> {
    Ok(())
}
#[cfg(windows)]
pub async fn teardown_ipsec_connection(_: &str) -> Result<(), String> {
    Err("strongSwan is not available on Windows.".to_string())
}
#[cfg(windows)]
pub async fn is_ipsec_active(_: &str) -> Result<bool, String> {
    Ok(false)
}

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;

    fn full_tunnel_subnets() -> Vec<String> {
        vec!["0.0.0.0/0".to_string(), "::/0".to_string()]
    }

    #[test]
    fn config_renderer_rejects_directive_and_proposal_injection() {
        let remote_subnets = full_tunnel_subnets();
        assert!(render_ipsec_conf(&IpsecConnectionSpec {
            conn_name: "safe_name",
            server: "vpn.example.com\ninclude /tmp/evil.conf",
            local_id: None,
            remote_id: None,
            local_auth: "psk",
            remote_auth: "psk",
            eap_identity: None,
            phase1: None,
            phase2: None,
            remote_subnets: &remote_subnets,
        })
        .is_err());
        assert!(render_ipsec_conf(&IpsecConnectionSpec {
            conn_name: "safe_name",
            server: "vpn.example.com",
            local_id: None,
            remote_id: None,
            local_auth: "psk\nrightauth=pubkey",
            remote_auth: "psk",
            eap_identity: None,
            phase1: None,
            phase2: None,
            remote_subnets: &remote_subnets,
        })
        .is_err());
        assert!(render_ipsec_conf(&IpsecConnectionSpec {
            conn_name: "safe_name",
            server: "vpn.example.com",
            local_id: None,
            remote_id: None,
            local_auth: "psk",
            remote_auth: "psk",
            eap_identity: None,
            phase1: Some("aes256; include /tmp/evil.conf"),
            phase2: None,
            remote_subnets: &remote_subnets,
        })
        .is_err());
    }

    #[test]
    fn eap_renderer_separates_client_and_server_auth_and_requests_routes() {
        let remote_subnets = full_tunnel_subnets();
        let rendered = render_ipsec_conf(&IpsecConnectionSpec {
            conn_name: "safe_name",
            server: "vpn.example.com",
            local_id: Some("alice@example.com"),
            remote_id: Some("gateway.example.com"),
            local_auth: "eap-mschapv2",
            remote_auth: "pubkey",
            eap_identity: Some("alice@example.com"),
            phase1: None,
            phase2: None,
            remote_subnets: &remote_subnets,
        })
        .unwrap();
        assert!(rendered.contains("leftauth=eap-mschapv2"));
        assert!(rendered.contains("rightauth=pubkey"));
        assert!(rendered.contains("eap_identity=\"alice@example.com\""));
        assert!(rendered.contains("leftsourceip=%config"));
        assert!(rendered.contains("rightsubnet=0.0.0.0/0,::/0"));
    }

    #[test]
    fn config_renderer_uses_exact_split_tunnel_selectors() {
        let remote_subnets = vec!["10.20.0.0/16".to_string(), "2001:db8:42::/48".to_string()];
        let rendered = render_ipsec_conf(&IpsecConnectionSpec {
            conn_name: "safe_name",
            server: "vpn.example.com",
            local_id: None,
            remote_id: None,
            local_auth: "psk",
            remote_auth: "psk",
            eap_identity: None,
            phase1: None,
            phase2: None,
            remote_subnets: &remote_subnets,
        })
        .unwrap();
        assert!(rendered.contains("rightsubnet=10.20.0.0/16,2001:db8:42::/48"));
        assert!(!rendered.contains("rightsubnet=0.0.0.0/0,::/0"));
    }

    #[test]
    fn config_renderer_revalidates_routes_without_echoing_input() {
        let marker = "secret-host.example/24\ninclude /tmp/evil.conf";
        let remote_subnets = vec![marker.to_string()];
        let error = render_ipsec_conf(&IpsecConnectionSpec {
            conn_name: "safe_name",
            server: "vpn.example.com",
            local_id: None,
            remote_id: None,
            local_auth: "psk",
            remote_auth: "psk",
            eap_identity: None,
            phase1: None,
            phase2: None,
            remote_subnets: &remote_subnets,
        })
        .unwrap_err();
        assert!(!error.contains(marker));
        assert!(render_remote_subnets(&[]).is_err());
    }

    #[test]
    fn secrets_renderer_base64_round_trips_every_secret_byte() {
        let secret = "quote\" slash\\ dollar$ semicolon;\nnull\0Unicode €";
        let rendered = render_ipsec_secrets(
            "safe_name",
            Some("alice@example.com"),
            "vpn.example.com",
            "PSK",
            secret,
        )
        .unwrap();
        assert_eq!(rendered.lines().count(), 1);
        assert!(!rendered.contains(secret));
        let encoded = rendered
            .split_once(" : PSK 0s")
            .expect("PSK marker")
            .1
            .trim();
        assert_eq!(BASE64_STANDARD.decode(encoded).unwrap(), secret.as_bytes());
        assert!(render_ipsec_secrets(
            "safe_name",
            Some("selector\"break"),
            "vpn.example.com",
            "PSK",
            "secret",
        )
        .is_err());
    }

    #[test]
    fn l2tp_renderer_uses_ikev1_transport_udp_1701() {
        let rendered = render_l2tp_ipsec_conf("safe_name", "vpn.example.com", None, None).unwrap();
        assert!(rendered.contains("type=transport"));
        assert!(rendered.contains("keyexchange=ikev1"));
        assert!(rendered.contains("leftprotoport=17/%any"));
        assert!(rendered.contains("rightprotoport=17/1701"));
        assert!(!rendered.contains("rightsubnet="));
    }

    #[test]
    fn managed_include_append_is_preserving_and_idempotent() {
        let existing = "# administrator settings\nconfig setup\n    uniqueids=no\n";
        let include = "include /etc/ipsec.d/sorng_*.conf";
        let updated = append_managed_include(existing, include).unwrap().unwrap();
        assert!(updated.starts_with(existing));
        assert_eq!(updated.matches(include).count(), 1);
        assert!(append_managed_include(&updated, include).unwrap().is_none());
        assert!(
            append_managed_include("include /etc/ipsec.d/*.conf\n", include,)
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn sensitive_include_append_preserves_existing_secret_bytes() {
        let path = std::env::temp_dir().join(format!(
            "sortofremoteng-ipsec-secrets-test-{}",
            Uuid::new_v4().simple()
        ));
        let original = b": RSA sentinel-private-key\n";
        std::fs::write(&path, original).unwrap();
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        let include = format!(
            "include {}/sorng_*.secrets",
            path.parent().unwrap().display()
        );
        let accepted = covering_include_lines(&include);
        assert!(append_sensitive_include_locked(&path, &accepted, &include).unwrap());
        assert!(append_sensitive_include_locked(&path, &accepted, &include).unwrap());
        let after = std::fs::read(&path).unwrap();
        assert!(after.starts_with(original));
        assert_eq!(String::from_utf8_lossy(&after).matches(&include).count(), 1);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn psk_secret_selector_uses_the_effective_remote_identity() {
        let rendered =
            render_ipsec_secrets("safe_name", None, "gateway-id.example.com", "PSK", "secret")
                .unwrap();
        assert!(rendered.starts_with("\"%any\" \"gateway-id.example.com\" : PSK 0s"));
    }

    #[test]
    fn homebrew_layouts_cover_apple_silicon_and_intel_prefixes() {
        assert!(HOMEBREW_LAYOUTS.iter().any(|layout| {
            layout.binary == "/opt/homebrew/bin/ipsec"
                && layout.config_root == "/opt/homebrew/etc"
                && layout.allow_user_owned
        }));
        assert!(HOMEBREW_LAYOUTS.iter().any(|layout| {
            layout.binary == "/usr/local/bin/ipsec"
                && layout.config_root == "/usr/local/etc"
                && layout.allow_user_owned
        }));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn privileged_layout_root_validates_itself() {
        let layout = IpsecLayout {
            binary: PathBuf::from("/usr/sbin/ipsec"),
            config_root: PathBuf::from("/"),
            allow_elevation: true,
        };
        validate_privileged_path(&layout, &layout.config_root).unwrap();
    }

    #[tokio::test]
    async fn staging_files_are_owner_only() {
        let staging = PrivateStagingFile::create(Zeroizing::new("secret".to_string())).unwrap();
        let path = staging.payload_path.clone();
        let directory = path.parent().unwrap().to_path_buf();
        let metadata = std::fs::metadata(&path).unwrap();
        assert_eq!(metadata.mode() & 0o777, 0o600);
        staging.cleanup().unwrap();
        assert!(!path.exists());
        assert!(!directory.exists());
    }

    fn private_test_directory(label: &str) -> PathBuf {
        use std::os::unix::fs::DirBuilderExt as _;

        let path = std::env::temp_dir().join(format!(
            "sortofremoteng-{label}-{}",
            Uuid::new_v4().simple()
        ));
        let mut builder = std::fs::DirBuilder::new();
        builder.mode(0o700).create(&path).unwrap();
        path
    }

    #[test]
    fn staging_guard_drop_removes_payload_and_directory() {
        let staging = PrivateStagingFile::create(Zeroizing::new("secret".to_string())).unwrap();
        let payload = staging.payload_path.clone();
        let directory = payload.parent().unwrap().to_path_buf();
        drop(staging);
        assert!(!payload.exists());
        assert!(!directory.exists());
    }

    #[tokio::test]
    async fn cancelled_staging_owner_drops_armed_guard() {
        let staging = PrivateStagingFile::create(Zeroizing::new("secret".to_string())).unwrap();
        let payload = staging.payload_path.clone();
        let directory = payload.parent().unwrap().to_path_buf();
        let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(async move {
            let guard = staging;
            let _ = ready_tx.send(());
            std::future::pending::<()>().await;
            drop(guard);
        });
        ready_rx.await.unwrap();
        task.abort();
        let _ = task.await;
        assert!(!payload.exists());
        assert!(!directory.exists());
    }

    #[test]
    fn cleanup_failure_is_reported_and_never_merged_as_success() {
        let staging = PrivateStagingFile::create(Zeroizing::new("secret".to_string())).unwrap();
        let directory = staging.payload_path.parent().unwrap().to_path_buf();
        let unexpected = directory.join("unexpected");
        std::fs::write(&unexpected, b"block directory removal").unwrap();
        let cleanup_error = staging.cleanup().unwrap_err();
        assert!(cleanup_error.contains("staging directory"));
        let result = finalize_install_result(Ok(()), Err(cleanup_error));
        assert!(result.unwrap_err().contains("refusing to report success"));
        std::fs::remove_file(unexpected).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn oversized_config_inputs_fail_before_copy_or_append() {
        let oversized = "x".repeat(MANAGED_CONFIG_LIMIT + 1);
        assert!(append_managed_include(&oversized, "include /safe/*.conf").is_err());
        let staging_error =
            PrivateStagingFile::create(Zeroizing::new("x".repeat(IPSEC_FILE_LIMIT + 1)))
                .err()
                .expect("oversized staging content must fail");
        assert!(staging_error.contains("safety limit"));

        let directory = private_test_directory("oversized-ipsec");
        let path = directory.join("ipsec.conf");
        let file = File::create(&path).unwrap();
        file.set_len(MANAGED_CONFIG_LIMIT as u64 + 1).unwrap();
        drop(file);
        assert!(read_bounded_regular_file(&path, MANAGED_CONFIG_LIMIT).is_err());
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }

    #[test]
    fn no_follow_reader_rejects_symlink_and_reads_original_descriptor_after_swap() {
        use std::os::unix::fs::symlink;

        let directory = private_test_directory("ipsec-symlink");
        let target = directory.join("ipsec.conf");
        let moved = directory.join("original.conf");
        let decoy = directory.join("decoy.conf");
        let link = directory.join("linked.conf");
        std::fs::write(&target, b"original").unwrap();
        std::fs::write(&decoy, b"decoy").unwrap();
        symlink(&target, &link).unwrap();
        assert!(read_bounded_regular_file(&link, MANAGED_CONFIG_LIMIT).is_err());

        let mut opened =
            open_regular_file_no_follow(&target, libc::O_RDONLY, None, false, MANAGED_CONFIG_LIMIT)
                .unwrap()
                .unwrap();
        std::fs::rename(&target, &moved).unwrap();
        symlink(&decoy, &target).unwrap();
        let bytes = read_bounded_open_file(&mut opened, MANAGED_CONFIG_LIMIT).unwrap();
        assert_eq!(&*bytes, b"original");

        std::fs::remove_file(link).unwrap();
        std::fs::remove_file(target).unwrap();
        std::fs::remove_file(moved).unwrap();
        std::fs::remove_file(decoy).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    #[test]
    fn no_follow_reader_rejects_fifo_without_blocking() {
        let directory = private_test_directory("ipsec-fifo");
        let fifo = directory.join("ipsec.conf");
        let fifo_name = CString::new(fifo.as_os_str().as_bytes()).unwrap();
        // SAFETY: fifo_name is a valid NUL-terminated path and mode is valid.
        assert_eq!(unsafe { libc::mkfifo(fifo_name.as_ptr(), 0o600) }, 0);
        assert!(read_bounded_regular_file(&fifo, MANAGED_CONFIG_LIMIT).is_err());
        std::fs::remove_file(fifo).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }

    struct FakeTransactionRunner {
        calls: std::sync::Mutex<Vec<&'static str>>,
        setup_fails: bool,
        down_fails: bool,
        cleanup_fails: bool,
    }

    #[async_trait::async_trait]
    impl IpsecTransactionRunner for FakeTransactionRunner {
        async fn setup(&self, _: &str) -> Result<(), String> {
            self.calls.lock().unwrap().push("setup");
            if self.setup_fails {
                Err("setup failed".to_string())
            } else {
                Ok(())
            }
        }

        async fn down(&self, _: &str) -> Result<(), String> {
            self.calls.lock().unwrap().push("down");
            if self.down_fails {
                Err("down failed".to_string())
            } else {
                Ok(())
            }
        }

        async fn cleanup(&self, _: &str) -> Result<(), String> {
            self.calls.lock().unwrap().push("cleanup");
            if self.cleanup_fails {
                Err("cleanup failed".to_string())
            } else {
                Ok(())
            }
        }
    }

    #[tokio::test]
    async fn transactional_failure_never_skips_cleanup() {
        let runner = FakeTransactionRunner {
            calls: std::sync::Mutex::new(Vec::new()),
            setup_fails: true,
            down_fails: true,
            cleanup_fails: true,
        };
        let error = run_ipsec_transaction(&runner, "safe_name")
            .await
            .unwrap_err();
        assert_eq!(*runner.calls.lock().unwrap(), ["setup", "down", "cleanup"]);
        assert!(error.contains("setup failed"));
        assert!(error.contains("down failed"));
        assert!(error.contains("cleanup failed"));
    }

    #[test]
    fn process_deadlines_are_bounded_per_operation() {
        assert_eq!(ipsec_command_timeout(&["status"]), IPSEC_STATUS_TIMEOUT);
        assert_eq!(ipsec_command_timeout(&["reload"]), IPSEC_CONTROL_TIMEOUT);
        assert_eq!(ipsec_command_timeout(&["down"]), IPSEC_DOWN_TIMEOUT);
        assert_eq!(ipsec_command_timeout(&["up"]), IPSEC_UP_TIMEOUT);
    }
}
