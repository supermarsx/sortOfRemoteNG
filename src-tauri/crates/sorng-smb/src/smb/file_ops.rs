// ── File operations (platform-split) ─────────────────────────────────────────
//
// This module owns ALL platform-dependent code. Everything else in the
// crate is portable. Two independent implementations live here:
//
//   • `windows` module — native redirector + UNC I/O + NetShareEnum.
//   • `unix`    module — bounded smbclient with private auth files.
//
// Both expose the same `OpsBackend` trait surface so `service.rs` can
// swap them at `cfg` boundaries. Blocking work (subprocess spawn,
// UNC std::fs calls) runs inside `tokio::task::spawn_blocking`.

use super::session::SmbSession;
use super::types::*;
use async_trait::async_trait;

const MAX_SERVER_HOST_LEN: usize = 253;
const MAX_INLINE_FILE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_INLINE_BASE64_BYTES: usize = 24 * 1024 * 1024;

fn inline_read_limit(requested: Option<u64>) -> u64 {
    requested
        .unwrap_or(MAX_INLINE_FILE_BYTES)
        .min(MAX_INLINE_FILE_BYTES)
}

fn inline_base64_lengths_allowed(content_len: usize, symbols: usize) -> bool {
    let decoded_upper_bound = symbols.saturating_mul(3).saturating_add(3) / 4;
    content_len <= MAX_INLINE_BASE64_BYTES && decoded_upper_bound as u64 <= MAX_INLINE_FILE_BYTES
}

fn validate_inline_base64(content: &str) -> SmbResult<()> {
    if content.len() > MAX_INLINE_BASE64_BYTES {
        return Err(SmbError::Other(
            "inline SMB payload exceeds the 16 MiB safety limit; use file transfer instead".into(),
        ));
    }
    let symbols = content
        .bytes()
        .take_while(|byte| *byte != b'=')
        .filter(|byte| !byte.is_ascii_whitespace())
        .count();
    if !inline_base64_lengths_allowed(content.len(), symbols) {
        return Err(SmbError::Other(
            "inline SMB payload exceeds the 16 MiB safety limit; use file transfer instead".into(),
        ));
    }
    Ok(())
}

fn atomic_download_temp(
    local_path: &str,
) -> SmbResult<(std::path::PathBuf, tempfile::NamedTempFile)> {
    let destination = std::path::PathBuf::from(local_path);
    if destination.file_name().is_none() {
        return Err(SmbError::InvalidPath(
            "download destination must name a file".into(),
        ));
    }
    if destination.exists() {
        return Err(SmbError::Other(
            "download destination already exists; SMB downloads never overwrite files".into(),
        ));
    }
    let parent = destination
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| std::path::Path::new("."));
    let temp = tempfile::Builder::new()
        .prefix(".sorng-smb-download-")
        .tempfile_in(parent)
        .map_err(|_| SmbError::Backend("unable to create atomic SMB download file".into()))?;
    Ok((destination, temp))
}

fn persist_atomic_download(
    temp: tempfile::NamedTempFile,
    destination: &std::path::Path,
) -> SmbResult<()> {
    temp.persist_noclobber(destination).map_err(|_| {
        SmbError::Other(
            "download destination appeared during transfer; partial data was discarded".into(),
        )
    })?;
    Ok(())
}

/// Keep server names unambiguous before they are embedded in a UNC path or
/// smbclient target. Internationalised DNS names must be supplied in their
/// ASCII (punycode) form; scoped IPv6 literals are deliberately unsupported.
fn validate_server_host(host: &str) -> SmbResult<()> {
    let valid_chars = host
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_' | ':' | '[' | ']'));
    let bracketed = !(host.contains('[') || host.contains(']'))
        || (host.starts_with('[')
            && host.ends_with(']')
            && host[1..host.len() - 1]
                .chars()
                .all(|ch| ch.is_ascii_hexdigit() || matches!(ch, ':' | '.')));

    if host.is_empty()
        || host.len() > MAX_SERVER_HOST_LEN
        || host != host.trim()
        || host.starts_with('-')
        || host.contains("..")
        || !host.bytes().any(|byte| byte.is_ascii_alphanumeric())
        || !valid_chars
        || !bracketed
    {
        return Err(SmbError::Network(
            "SMB server host is invalid or unsupported".into(),
        ));
    }

    Ok(())
}

#[async_trait]
pub trait OpsBackend: Send + Sync {
    /// Probe server reachability / authenticate. Fail early if creds bad.
    async fn probe(&self, session: &SmbSession) -> SmbResult<()>;

    /// Release any platform-native connection state created by `probe`.
    async fn disconnect(&self, session: &SmbSession) -> SmbResult<()>;

    async fn list_shares(&self, session: &SmbSession) -> SmbResult<Vec<SmbShareInfo>>;

    async fn list_dir(
        &self,
        session: &SmbSession,
        share: &str,
        path: &str,
    ) -> SmbResult<Vec<SmbDirEntry>>;

    async fn stat(&self, session: &SmbSession, share: &str, path: &str) -> SmbResult<SmbStat>;

    async fn read_file(
        &self,
        session: &SmbSession,
        share: &str,
        path: &str,
        max_bytes: Option<u64>,
    ) -> SmbResult<SmbReadResult>;

    async fn write_file(
        &self,
        session: &SmbSession,
        share: &str,
        path: &str,
        content_b64: &str,
        overwrite: bool,
    ) -> SmbResult<SmbWriteResult>;

    async fn download_file(
        &self,
        session: &SmbSession,
        share: &str,
        remote_path: &str,
        local_path: &str,
    ) -> SmbResult<SmbTransferResult>;

    async fn upload_file(
        &self,
        session: &SmbSession,
        share: &str,
        local_path: &str,
        remote_path: &str,
    ) -> SmbResult<SmbTransferResult>;

    async fn mkdir(&self, session: &SmbSession, share: &str, path: &str) -> SmbResult<()>;

    async fn rmdir(
        &self,
        session: &SmbSession,
        share: &str,
        path: &str,
        recursive: bool,
    ) -> SmbResult<()>;

    async fn delete_file(&self, session: &SmbSession, share: &str, path: &str) -> SmbResult<()>;

    async fn rename(
        &self,
        session: &SmbSession,
        share: &str,
        from: &str,
        to: &str,
    ) -> SmbResult<()>;
}

#[cfg(test)]
mod host_validation_tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn host_validation_accepts_network_names_and_rejects_path_injection() {
        for valid in [
            "files.internal",
            "10.20.30.40",
            "2001:db8::1",
            "[2001:db8::1]",
        ] {
            assert!(validate_server_host(valid).is_ok(), "{valid}");
        }
        for invalid in [
            "",
            " server",
            "../server",
            r"server\share",
            "server/share",
            "server;touch",
            "server\nnext",
            "-server",
            "host%zone",
        ] {
            assert!(validate_server_host(invalid).is_err(), "{invalid:?}");
        }
    }

    #[test]
    fn inline_payload_limits_apply_even_without_a_caller_limit() {
        assert_eq!(inline_read_limit(None), MAX_INLINE_FILE_BYTES);
        assert_eq!(inline_read_limit(Some(u64::MAX)), MAX_INLINE_FILE_BYTES);
        assert!(!inline_base64_lengths_allowed(
            MAX_INLINE_BASE64_BYTES + 1,
            4
        ));
        assert!(!inline_base64_lengths_allowed(
            MAX_INLINE_BASE64_BYTES,
            MAX_INLINE_BASE64_BYTES
        ));
    }

    #[test]
    fn atomic_download_is_no_clobber_and_cleans_partial_files() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("download.bin");
        let (resolved, mut temp) =
            atomic_download_temp(destination.to_string_lossy().as_ref()).unwrap();
        let partial_path = temp.path().to_owned();
        temp.write_all(b"complete").unwrap();
        persist_atomic_download(temp, &resolved).unwrap();
        assert_eq!(std::fs::read(&destination).unwrap(), b"complete");
        assert!(!partial_path.exists());
        assert!(atomic_download_temp(destination.to_string_lossy().as_ref()).is_err());

        let second = directory.path().join("partial.bin");
        let (_, temp) = atomic_download_temp(second.to_string_lossy().as_ref()).unwrap();
        let partial_path = temp.path().to_owned();
        drop(temp);
        assert!(!partial_path.exists());
    }
}

// ─── backend selection ───────────────────────────────────────────────────────

pub fn default_backend() -> Box<dyn OpsBackend> {
    #[cfg(windows)]
    {
        Box::new(windows_impl::WindowsBackend::new())
    }
    #[cfg(not(windows))]
    {
        Box::new(unix_impl::UnixBackend::new())
    }
}

pub fn backend_name() -> &'static str {
    #[cfg(windows)]
    {
        "windows-unc"
    }
    #[cfg(not(windows))]
    {
        "unix-smbclient"
    }
}

#[cfg(windows)]
pub(crate) fn cleanup_native_session(session: &SmbSession) -> SmbResult<()> {
    windows_impl::WindowsBackend::disconnect_redirector(session)
}

// ═══════════════════════════════════════════════════════════════════════════
// Windows implementation — native redirector + UNC + NetShareEnum
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(windows)]
mod windows_impl {
    use super::*;
    use base64_shim as b64;
    use std::ffi::c_void;
    use std::io::{Read, Write};
    use std::path::PathBuf;
    use std::ptr::{null, null_mut};
    use std::time::Instant;
    use tokio::task::spawn_blocking;
    use windows_sys::Win32::Foundation::{
        ERROR_ACCESS_DENIED, ERROR_INVALID_PASSWORD, ERROR_LOGON_FAILURE, ERROR_MORE_DATA,
        ERROR_NOT_CONNECTED, ERROR_SESSION_CREDENTIAL_CONFLICT, ERROR_SUCCESS,
    };
    use windows_sys::Win32::NetworkManagement::NetManagement::{NERR_Success, NetApiBufferFree};
    use windows_sys::Win32::NetworkManagement::WNet::{
        WNetAddConnection2W, WNetCancelConnection2W, CONNECT_TEMPORARY, NETRESOURCEW,
        RESOURCETYPE_DISK,
    };
    // windows-sys 0.61 generates the NetShare API and its level/type records
    // under Storage::FileSystem, despite the API being implemented by
    // NetAPI32. NetApiBufferFree and NERR_Success remain in NetManagement.
    use windows_sys::Win32::Storage::FileSystem::{
        NetShareEnum, SHARE_INFO_1, STYPE_DEVICE, STYPE_DISKTREE, STYPE_IPC, STYPE_MASK,
        STYPE_PRINTQ, STYPE_SPECIAL,
    };
    use zeroize::Zeroizing;

    const MAX_NATIVE_SHARE_PAGES: usize = 64;
    const MAX_NATIVE_SHARES: usize = 4096;
    const NET_SHARE_PAGE_BYTES: u32 = 64 * 1024;
    const MAX_NATIVE_WIDE_CHARS: usize = 32 * 1024;

    struct NativeSmbPolicyCapabilities {
        can_enforce_smb2_or_newer: bool,
        can_require_encryption: bool,
    }

    struct NetApiBuffer(*mut u8);

    impl Drop for NetApiBuffer {
        fn drop(&mut self) {
            if !self.0.is_null() {
                // SAFETY: NetShareEnum allocated this buffer and ownership is
                // released exactly once by this guard.
                unsafe {
                    NetApiBufferFree(self.0.cast::<c_void>());
                }
            }
        }
    }

    // Tiny self-contained base64 helpers so we don't need to add a new
    // dep to Cargo.toml — the `base64` workspace dep isn't declared here
    // because only the binary-exchange read/write paths need it.
    mod base64_shim {
        const ALPHA: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        pub fn encode(input: &[u8]) -> String {
            let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
            for chunk in input.chunks(3) {
                let b0 = chunk[0];
                let b1 = if chunk.len() > 1 { chunk[1] } else { 0 };
                let b2 = if chunk.len() > 2 { chunk[2] } else { 0 };
                out.push(ALPHA[(b0 >> 2) as usize] as char);
                out.push(ALPHA[(((b0 & 0b11) << 4) | (b1 >> 4)) as usize] as char);
                if chunk.len() > 1 {
                    out.push(ALPHA[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char);
                } else {
                    out.push('=');
                }
                if chunk.len() > 2 {
                    out.push(ALPHA[(b2 & 0x3f) as usize] as char);
                } else {
                    out.push('=');
                }
            }
            out
        }
        pub fn decode(input: &str) -> Result<Vec<u8>, String> {
            if input.len() > super::super::MAX_INLINE_BASE64_BYTES {
                return Err("inline base64 input exceeds safety limit".into());
            }
            let mut lut = [0u8; 256];
            for (i, b) in ALPHA.iter().enumerate() {
                lut[*b as usize] = i as u8;
            }
            let mut out = Vec::with_capacity(input.len().saturating_mul(3) / 4);
            let mut buf: u32 = 0;
            let mut bits = 0u32;
            for b in input.bytes() {
                if b.is_ascii_whitespace() {
                    continue;
                }
                if b == b'=' {
                    break;
                }
                if !ALPHA.contains(&b) {
                    return Err(format!("invalid base64 char: {b}"));
                }
                buf = (buf << 6) | lut[b as usize] as u32;
                bits += 6;
                if bits >= 8 {
                    bits -= 8;
                    out.push((buf >> bits) as u8);
                }
            }
            Ok(out)
        }
    }

    pub struct WindowsBackend;

    impl WindowsBackend {
        pub fn new() -> Self {
            Self
        }

        fn native_policy_capabilities() -> NativeSmbPolicyCapabilities {
            // WNetAddConnection2W exposes no per-connection dialect floor or
            // encryption requirement. Both are controlled by machine policy.
            NativeSmbPolicyCapabilities {
                can_enforce_smb2_or_newer: false,
                can_require_encryption: false,
            }
        }

        fn ensure_supported_target(session: &SmbSession) -> SmbResult<()> {
            validate_server_host(&session.config.host)?;
            if session.config.disable_plaintext {
                let capabilities = Self::native_policy_capabilities();
                if !capabilities.can_enforce_smb2_or_newer || !capabilities.can_require_encryption {
                    return Err(SmbError::Unsupported(
                        "the Windows native redirector cannot enforce an SMB2+ dialect floor and encryption per connection; configure and verify Windows SMB client policy, then explicitly set disablePlaintext=false only to acknowledge that OS-managed policy (no credentials were submitted)".into(),
                    ));
                }
            }
            if session.config.port == 445 {
                return Ok(());
            }

            Err(SmbError::Unsupported(format!(
                "windows-unc backend does not support non-445 SMB ports (got {}); expose the server on port 445 or validate on a host that can use smbclient",
                session.config.port
            )))
        }

        /// Build a Windows UNC path: \\host\share\path.
        /// `path` uses forward slashes from the wire; we normalise.
        fn unc(host: &str, share: &str, path: &str) -> PathBuf {
            let cleaned = path.trim_start_matches('/').replace('/', "\\");
            let mut s = format!(r"\\{}\{}", host, share);
            if !cleaned.is_empty() {
                s.push('\\');
                s.push_str(&cleaned);
            }
            PathBuf::from(s)
        }

        fn wide(value: &str) -> Vec<u16> {
            value.encode_utf16().chain(std::iter::once(0)).collect()
        }

        fn validate_native_credential(value: &str) -> SmbResult<()> {
            if value.contains('\0') {
                return Err(SmbError::AuthFailed(
                    "SMB credentials contain unsupported characters".into(),
                ));
            }
            Ok(())
        }

        /// Authenticate with the Windows SMB redirector without ever placing
        /// a password in a process command line. CONNECT_TEMPORARY prevents
        /// Windows from restoring the connection after sign-in.
        fn connect_redirector(session: &SmbSession) -> SmbResult<()> {
            let host = &session.config.host;
            let share = session.config.share.as_deref().unwrap_or("IPC$");
            let target = format!(r"\\{}\{}", host, share);
            let mut remote = Self::wide(&target);

            let username = match session.config.username.as_deref() {
                Some(user) => {
                    Self::validate_native_credential(user)?;
                    let full = match session.config.domain.as_deref() {
                        Some(domain) if !domain.is_empty() => {
                            Self::validate_native_credential(domain)?;
                            format!(r"{}\{}", domain, user)
                        }
                        _ => user.to_string(),
                    };
                    Some(Self::wide(&full))
                }
                None => {
                    if session.config.password.is_some() {
                        return Err(SmbError::AuthFailed(
                            "an SMB password requires a username".into(),
                        ));
                    }
                    None
                }
            };
            let password = match session.config.password.as_deref() {
                Some(password) => {
                    Self::validate_native_credential(password)?;
                    Some(Zeroizing::new(Self::wide(password)))
                }
                None if username.is_some() => Some(Zeroizing::new(Self::wide(""))),
                None => None,
            };

            let resource = NETRESOURCEW {
                dwType: RESOURCETYPE_DISK,
                lpRemoteName: remote.as_mut_ptr(),
                ..Default::default()
            };
            let password_ptr = password.as_ref().map_or(null(), |value| value.as_ptr());
            let username_ptr = username.as_ref().map_or(null(), |value| value.as_ptr());

            // SAFETY: all pointers reference live, NUL-terminated UTF-16
            // buffers for the duration of the call. No interactive flag is
            // supplied, so the API cannot display a credential prompt.
            let status = unsafe {
                WNetAddConnection2W(&resource, password_ptr, username_ptr, CONNECT_TEMPORARY)
            };
            match status {
                ERROR_SUCCESS => Ok(()),
                ERROR_LOGON_FAILURE | ERROR_INVALID_PASSWORD | ERROR_ACCESS_DENIED => Err(
                    SmbError::AuthFailed("SMB authentication was rejected".into()),
                ),
                ERROR_SESSION_CREDENTIAL_CONFLICT => Err(SmbError::AuthFailed(
                    "an existing SMB connection uses different credentials".into(),
                )),
                _ => Err(SmbError::Backend("native SMB authentication failed".into())),
            }
        }

        pub(super) fn disconnect_redirector(session: &SmbSession) -> SmbResult<()> {
            validate_server_host(&session.config.host)?;
            let share = session.config.share.as_deref().unwrap_or("IPC$");
            let remote = Self::wide(&format!(r"\\{}\{}", session.config.host, share));
            // SAFETY: `remote` is a live NUL-terminated UTF-16 string. The
            // force flag is safe because service operations are serialized
            // and no command is active while disconnect holds service state.
            let status = unsafe { WNetCancelConnection2W(remote.as_ptr(), 0, 1) };
            match status {
                ERROR_SUCCESS | ERROR_NOT_CONNECTED => Ok(()),
                _ => Err(SmbError::Backend(
                    "native SMB connection could not be released".into(),
                )),
            }
        }

        fn wide_ptr_to_string(value: *const u16) -> Option<String> {
            if value.is_null() {
                return None;
            }
            let mut len = 0usize;
            // SAFETY: pointers originate in a live NetShareEnum buffer. The
            // explicit upper bound prevents an unbounded scan on malformed
            // provider data.
            while len < MAX_NATIVE_WIDE_CHARS && unsafe { *value.add(len) } != 0 {
                len += 1;
            }
            if len == MAX_NATIVE_WIDE_CHARS {
                return None;
            }
            let slice = unsafe { std::slice::from_raw_parts(value, len) };
            Some(String::from_utf16_lossy(slice))
        }

        fn native_share_type(raw: u32) -> SmbShareType {
            match raw & STYPE_MASK {
                STYPE_DISKTREE => SmbShareType::Disk,
                STYPE_PRINTQ => SmbShareType::Printer,
                STYPE_DEVICE => SmbShareType::Device,
                STYPE_IPC => SmbShareType::Ipc,
                _ if raw & STYPE_SPECIAL != 0 => SmbShareType::Special,
                _ => SmbShareType::Unknown,
            }
        }

        fn enumerate_shares(host: &str) -> SmbResult<Vec<SmbShareInfo>> {
            validate_server_host(host)?;
            let mut server = Self::wide(&format!(r"\\{}", host));
            let mut resume = 0u32;
            let mut shares = Vec::new();

            for _ in 0..MAX_NATIVE_SHARE_PAGES {
                let previous_resume = resume;
                let mut buffer = null_mut::<u8>();
                let mut entries_read = 0u32;
                let mut _total_entries = 0u32;
                // SAFETY: output pointers are valid and the returned buffer is
                // immediately owned by NetApiBuffer.
                let status = unsafe {
                    NetShareEnum(
                        server.as_mut_ptr(),
                        1,
                        &mut buffer,
                        NET_SHARE_PAGE_BYTES,
                        &mut entries_read,
                        &mut _total_entries,
                        &mut resume,
                    )
                };
                let _buffer_guard = NetApiBuffer(buffer);

                if status != NERR_Success && status != ERROR_MORE_DATA {
                    return match status {
                        ERROR_LOGON_FAILURE | ERROR_ACCESS_DENIED => Err(SmbError::AuthFailed(
                            "SMB share enumeration was rejected".into(),
                        )),
                        _ => Err(SmbError::Backend(
                            "native SMB share enumeration failed".into(),
                        )),
                    };
                }
                let count = entries_read as usize;
                if shares.len().saturating_add(count) > MAX_NATIVE_SHARES
                    || (count > 0 && buffer.is_null())
                {
                    return Err(SmbError::Backend(
                        "native SMB share enumeration exceeded safety limits".into(),
                    ));
                }

                let entries = if count == 0 {
                    &[][..]
                } else {
                    // SAFETY: NetShareEnum returned `entries_read` level-1
                    // records in the guarded buffer.
                    unsafe { std::slice::from_raw_parts(buffer.cast::<SHARE_INFO_1>(), count) }
                };
                for entry in entries {
                    let Some(name) = Self::wide_ptr_to_string(entry.shi1_netname) else {
                        continue;
                    };
                    let comment = Self::wide_ptr_to_string(entry.shi1_remark)
                        .filter(|value| !value.is_empty());
                    shares.push(SmbShareInfo {
                        is_admin: name.ends_with('$') || entry.shi1_type & STYPE_SPECIAL != 0,
                        name,
                        share_type: Self::native_share_type(entry.shi1_type),
                        comment,
                    });
                }

                if status == NERR_Success {
                    return Ok(shares);
                }
                if entries_read == 0 || resume == previous_resume {
                    return Err(SmbError::Backend(
                        "native SMB share enumeration made no progress".into(),
                    ));
                }
            }

            Err(SmbError::Backend(
                "native SMB share enumeration exceeded safety limits".into(),
            ))
        }

        fn entry_type_from_metadata(md: &std::fs::Metadata) -> SmbEntryType {
            if md.is_dir() {
                SmbEntryType::Directory
            } else if md.file_type().is_symlink() {
                SmbEntryType::Symlink
            } else if md.is_file() {
                SmbEntryType::File
            } else {
                SmbEntryType::Unknown
            }
        }

        fn millis_since_epoch(t: std::time::SystemTime) -> Option<i64> {
            t.duration_since(std::time::UNIX_EPOCH)
                .ok()
                .map(|d| d.as_millis() as i64)
        }
    }

    #[async_trait]
    impl OpsBackend for WindowsBackend {
        async fn probe(&self, session: &SmbSession) -> SmbResult<()> {
            Self::ensure_supported_target(session)?;
            // WNet can block on network authentication. Copy credentials only
            // for this bounded blocking call; SmbConnectionConfig zeroizes the
            // copied password as soon as the task completes.
            let config = SmbConnectionConfig {
                host: session.config.host.clone(),
                port: session.config.port,
                domain: session.config.domain.clone(),
                username: session.config.username.clone(),
                password: session.config.password.clone(),
                workgroup: session.config.workgroup.clone(),
                share: session.config.share.clone(),
                label: None,
                disable_plaintext: session.config.disable_plaintext,
                use_kerberos: session.config.use_kerberos,
            };
            spawn_blocking(move || {
                let blocking_session = SmbSession::new(String::new(), config, "windows-unc");
                Self::connect_redirector(&blocking_session)
            })
            .await
            .map_err(|e| SmbError::Backend(format!("join: {e}")))??;
            Ok(())
        }

        async fn disconnect(&self, session: &SmbSession) -> SmbResult<()> {
            let host = session.config.host.clone();
            let share = session.config.share.clone();
            spawn_blocking(move || {
                let config = SmbConnectionConfig {
                    host,
                    port: 445,
                    domain: None,
                    username: None,
                    password: None,
                    workgroup: None,
                    share,
                    label: None,
                    disable_plaintext: false,
                    use_kerberos: false,
                };
                let cleanup = SmbSession::new(String::new(), config, "windows-unc");
                Self::disconnect_redirector(&cleanup)
            })
            .await
            .map_err(|_| SmbError::Backend("native SMB cleanup task failed".into()))?
        }

        async fn list_shares(&self, session: &SmbSession) -> SmbResult<Vec<SmbShareInfo>> {
            Self::ensure_supported_target(session)?;
            let host = session.config.host.clone();
            spawn_blocking(move || Self::enumerate_shares(&host))
                .await
                .map_err(|e| SmbError::Backend(format!("join: {e}")))?
        }

        async fn list_dir(
            &self,
            session: &SmbSession,
            share: &str,
            path: &str,
        ) -> SmbResult<Vec<SmbDirEntry>> {
            Self::ensure_supported_target(session)?;
            let host = session.config.host.clone();
            let share_s = share.to_string();
            let path_s = path.to_string();
            spawn_blocking(move || -> SmbResult<Vec<SmbDirEntry>> {
                let unc = WindowsBackend::unc(&host, &share_s, &path_s);
                let rd = std::fs::read_dir(&unc)
                    .map_err(|e| SmbError::Backend(format!("read_dir {}: {e}", unc.display())))?;
                let mut out = Vec::new();
                for entry in rd {
                    let Ok(entry) = entry else { continue };
                    let md = match entry.metadata() {
                        Ok(m) => m,
                        Err(_) => continue,
                    };
                    let name = entry.file_name().to_string_lossy().into_owned();
                    let mut child_path = path_s.trim_end_matches('/').to_string();
                    if !child_path.is_empty() && !child_path.ends_with('/') {
                        child_path.push('/');
                    }
                    child_path.push_str(&name);
                    let modified = md.modified().ok().and_then(Self::millis_since_epoch);
                    let is_hidden = name.starts_with('.') || WindowsBackend::is_windows_hidden(&md);
                    let is_readonly = md.permissions().readonly();
                    out.push(SmbDirEntry {
                        name,
                        path: child_path,
                        entry_type: Self::entry_type_from_metadata(&md),
                        size: md.len(),
                        modified,
                        is_hidden,
                        is_readonly,
                        is_system: false,
                    });
                }
                Ok(out)
            })
            .await
            .map_err(|e| SmbError::Backend(format!("join: {e}")))?
        }

        async fn stat(&self, session: &SmbSession, share: &str, path: &str) -> SmbResult<SmbStat> {
            Self::ensure_supported_target(session)?;
            let host = session.config.host.clone();
            let share_s = share.to_string();
            let path_s = path.to_string();
            spawn_blocking(move || -> SmbResult<SmbStat> {
                let unc = WindowsBackend::unc(&host, &share_s, &path_s);
                let md = std::fs::metadata(&unc)
                    .map_err(|e| SmbError::Backend(format!("metadata {}: {e}", unc.display())))?;
                Ok(SmbStat {
                    path: path_s,
                    entry_type: WindowsBackend::entry_type_from_metadata(&md),
                    size: md.len(),
                    modified: md
                        .modified()
                        .ok()
                        .and_then(WindowsBackend::millis_since_epoch),
                    created: md
                        .created()
                        .ok()
                        .and_then(WindowsBackend::millis_since_epoch),
                    accessed: md
                        .accessed()
                        .ok()
                        .and_then(WindowsBackend::millis_since_epoch),
                    is_hidden: WindowsBackend::is_windows_hidden(&md),
                    is_readonly: md.permissions().readonly(),
                    is_system: false,
                })
            })
            .await
            .map_err(|e| SmbError::Backend(format!("join: {e}")))?
        }

        async fn read_file(
            &self,
            session: &SmbSession,
            share: &str,
            path: &str,
            max_bytes: Option<u64>,
        ) -> SmbResult<SmbReadResult> {
            Self::ensure_supported_target(session)?;
            let host = session.config.host.clone();
            let share_s = share.to_string();
            let path_s = path.to_string();
            spawn_blocking(move || -> SmbResult<SmbReadResult> {
                let unc = WindowsBackend::unc(&host, &share_s, &path_s);
                let md = std::fs::metadata(&unc)
                    .map_err(|e| SmbError::Backend(format!("stat {}: {e}", unc.display())))?;
                let len = md.len();
                let max = inline_read_limit(max_bytes);
                if len > max {
                    return Err(SmbError::Other(format!(
                        "file size {len} exceeds the inline limit {max}; use smb_download_file"
                    )));
                }
                let file = std::fs::File::open(&unc)
                    .map_err(|e| SmbError::Backend(format!("read {}: {e}", unc.display())))?;
                let mut bytes = Vec::with_capacity(len as usize);
                let mut limited = file.take(max.saturating_add(1));
                limited
                    .read_to_end(&mut bytes)
                    .map_err(|e| SmbError::Backend(format!("read {}: {e}", unc.display())))?;
                if bytes.len() as u64 > max {
                    return Err(SmbError::Other(format!(
                        "file grew beyond the inline limit {max}; use smb_download_file"
                    )));
                }
                Ok(SmbReadResult {
                    path: path_s,
                    size: bytes.len() as u64,
                    content_b64: b64::encode(&bytes),
                })
            })
            .await
            .map_err(|e| SmbError::Backend(format!("join: {e}")))?
        }

        async fn write_file(
            &self,
            session: &SmbSession,
            share: &str,
            path: &str,
            content_b64: &str,
            overwrite: bool,
        ) -> SmbResult<SmbWriteResult> {
            Self::ensure_supported_target(session)?;
            validate_inline_base64(content_b64)?;
            let host = session.config.host.clone();
            let share_s = share.to_string();
            let path_s = path.to_string();
            let content_b64 = content_b64.to_string();
            spawn_blocking(move || -> SmbResult<SmbWriteResult> {
                let unc = WindowsBackend::unc(&host, &share_s, &path_s);
                let bytes = b64::decode(&content_b64)
                    .map_err(|e| SmbError::Other(format!("base64 decode: {e}")))?;
                if bytes.len() as u64 > MAX_INLINE_FILE_BYTES {
                    return Err(SmbError::Other(
                        "decoded SMB payload exceeds the 16 MiB safety limit".into(),
                    ));
                }
                if overwrite {
                    std::fs::write(&unc, &bytes)
                        .map_err(|e| SmbError::Backend(format!("write {}: {e}", unc.display())))?;
                } else {
                    let mut file = std::fs::OpenOptions::new()
                        .write(true)
                        .create_new(true)
                        .open(&unc)
                        .map_err(|error| {
                            if error.kind() == std::io::ErrorKind::AlreadyExists {
                                SmbError::Other(
                                    "remote file already exists and overwrite=false".into(),
                                )
                            } else {
                                SmbError::Backend("native SMB file creation failed".into())
                            }
                        })?;
                    file.write_all(&bytes)
                        .map_err(|_| SmbError::Backend("native SMB write failed".into()))?;
                }
                Ok(SmbWriteResult {
                    path: path_s,
                    bytes_written: bytes.len() as u64,
                })
            })
            .await
            .map_err(|e| SmbError::Backend(format!("join: {e}")))?
        }

        async fn download_file(
            &self,
            session: &SmbSession,
            share: &str,
            remote_path: &str,
            local_path: &str,
        ) -> SmbResult<SmbTransferResult> {
            Self::ensure_supported_target(session)?;
            let host = session.config.host.clone();
            let share_s = share.to_string();
            let remote_s = remote_path.to_string();
            let local_s = local_path.to_string();
            spawn_blocking(move || -> SmbResult<SmbTransferResult> {
                let started = Instant::now();
                let unc = WindowsBackend::unc(&host, &share_s, &remote_s);
                let (destination, temp) = atomic_download_temp(&local_s)?;
                let bytes = std::fs::copy(&unc, temp.path()).map_err(|_| {
                    SmbError::Backend(
                        "native SMB download failed; partial data was discarded".into(),
                    )
                })?;
                persist_atomic_download(temp, &destination)?;
                Ok(SmbTransferResult {
                    remote_path: remote_s,
                    local_path: local_s,
                    bytes_transferred: bytes,
                    duration_ms: started.elapsed().as_millis() as u64,
                })
            })
            .await
            .map_err(|e| SmbError::Backend(format!("join: {e}")))?
        }

        async fn upload_file(
            &self,
            session: &SmbSession,
            share: &str,
            local_path: &str,
            remote_path: &str,
        ) -> SmbResult<SmbTransferResult> {
            Self::ensure_supported_target(session)?;
            let host = session.config.host.clone();
            let share_s = share.to_string();
            let remote_s = remote_path.to_string();
            let local_s = local_path.to_string();
            spawn_blocking(move || -> SmbResult<SmbTransferResult> {
                let started = Instant::now();
                let unc = WindowsBackend::unc(&host, &share_s, &remote_s);
                let bytes = std::fs::copy(&local_s, &unc).map_err(|e| {
                    SmbError::Backend(format!("copy {}→{}: {e}", local_s, unc.display()))
                })?;
                Ok(SmbTransferResult {
                    remote_path: remote_s,
                    local_path: local_s,
                    bytes_transferred: bytes,
                    duration_ms: started.elapsed().as_millis() as u64,
                })
            })
            .await
            .map_err(|e| SmbError::Backend(format!("join: {e}")))?
        }

        async fn mkdir(&self, session: &SmbSession, share: &str, path: &str) -> SmbResult<()> {
            Self::ensure_supported_target(session)?;
            let host = session.config.host.clone();
            let share_s = share.to_string();
            let path_s = path.to_string();
            spawn_blocking(move || -> SmbResult<()> {
                let unc = WindowsBackend::unc(&host, &share_s, &path_s);
                std::fs::create_dir_all(&unc)
                    .map_err(|e| SmbError::Backend(format!("mkdir {}: {e}", unc.display())))
            })
            .await
            .map_err(|e| SmbError::Backend(format!("join: {e}")))?
        }

        async fn rmdir(
            &self,
            session: &SmbSession,
            share: &str,
            path: &str,
            recursive: bool,
        ) -> SmbResult<()> {
            Self::ensure_supported_target(session)?;
            let host = session.config.host.clone();
            let share_s = share.to_string();
            let path_s = path.to_string();
            spawn_blocking(move || -> SmbResult<()> {
                let unc = WindowsBackend::unc(&host, &share_s, &path_s);
                let res = if recursive {
                    std::fs::remove_dir_all(&unc)
                } else {
                    std::fs::remove_dir(&unc)
                };
                res.map_err(|e| SmbError::Backend(format!("rmdir {}: {e}", unc.display())))
            })
            .await
            .map_err(|e| SmbError::Backend(format!("join: {e}")))?
        }

        async fn delete_file(
            &self,
            session: &SmbSession,
            share: &str,
            path: &str,
        ) -> SmbResult<()> {
            Self::ensure_supported_target(session)?;
            let host = session.config.host.clone();
            let share_s = share.to_string();
            let path_s = path.to_string();
            spawn_blocking(move || -> SmbResult<()> {
                let unc = WindowsBackend::unc(&host, &share_s, &path_s);
                std::fs::remove_file(&unc)
                    .map_err(|e| SmbError::Backend(format!("delete {}: {e}", unc.display())))
            })
            .await
            .map_err(|e| SmbError::Backend(format!("join: {e}")))?
        }

        async fn rename(
            &self,
            session: &SmbSession,
            share: &str,
            from: &str,
            to: &str,
        ) -> SmbResult<()> {
            Self::ensure_supported_target(session)?;
            let host = session.config.host.clone();
            let share_s = share.to_string();
            let from_s = from.to_string();
            let to_s = to.to_string();
            spawn_blocking(move || -> SmbResult<()> {
                let from_unc = WindowsBackend::unc(&host, &share_s, &from_s);
                let to_unc = WindowsBackend::unc(&host, &share_s, &to_s);
                std::fs::rename(&from_unc, &to_unc).map_err(|e| {
                    SmbError::Backend(format!(
                        "rename {}→{}: {e}",
                        from_unc.display(),
                        to_unc.display()
                    ))
                })
            })
            .await
            .map_err(|e| SmbError::Backend(format!("join: {e}")))?
        }
    }

    impl WindowsBackend {
        fn is_windows_hidden(md: &std::fs::Metadata) -> bool {
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
                (md.file_attributes() & FILE_ATTRIBUTE_HIDDEN) != 0
            }
            #[cfg(not(windows))]
            {
                let _ = md;
                false
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn maps_native_share_types_without_network_access() {
            assert_eq!(
                WindowsBackend::native_share_type(STYPE_DISKTREE),
                SmbShareType::Disk
            );
            assert_eq!(
                WindowsBackend::native_share_type(STYPE_PRINTQ),
                SmbShareType::Printer
            );
            assert_eq!(
                WindowsBackend::native_share_type(STYPE_IPC),
                SmbShareType::Ipc
            );
            assert_eq!(
                WindowsBackend::native_share_type(STYPE_DEVICE),
                SmbShareType::Device
            );
        }

        #[test]
        fn unc_builder_normalises_slashes() {
            let p = WindowsBackend::unc("srv", "Share", "sub/dir/file.txt");
            assert_eq!(p.to_string_lossy(), r"\\srv\Share\sub\dir\file.txt");
            let p2 = WindowsBackend::unc("srv", "C$", "");
            assert_eq!(p2.to_string_lossy(), r"\\srv\C$");
        }

        #[test]
        fn base64_roundtrip() {
            let data = b"hello, smb client!";
            let encoded = b64::encode(data);
            let decoded = b64::decode(&encoded).unwrap();
            assert_eq!(decoded, data);
        }

        #[test]
        fn rejects_non_default_ports_for_windows_unc() {
            let session = SmbSession::new(
                "sid".into(),
                SmbConnectionConfig {
                    host: "127.0.0.1".into(),
                    port: 1445,
                    domain: None,
                    username: None,
                    password: None,
                    workgroup: None,
                    share: Some("public".into()),
                    label: None,
                    disable_plaintext: false,
                    use_kerberos: false,
                },
                "windows-unc",
            );

            let err = WindowsBackend::ensure_supported_target(&session)
                .expect_err("non-445 ports should fail before UNC access");

            assert!(matches!(err, SmbError::Unsupported(_)));
            assert!(err.to_string().contains("non-445 SMB ports"));
        }

        #[test]
        fn rejects_unverifiable_windows_plaintext_policy() {
            let session = SmbSession::new(
                "sid".into(),
                SmbConnectionConfig {
                    host: "files.internal".into(),
                    port: 445,
                    domain: None,
                    username: None,
                    password: None,
                    workgroup: None,
                    share: Some("public".into()),
                    label: None,
                    disable_plaintext: true,
                    use_kerberos: false,
                },
                "windows-unc",
            );
            let error = WindowsBackend::ensure_supported_target(&session)
                .expect_err("unverifiable native policy must fail before authentication");
            assert!(matches!(&error, SmbError::Unsupported(_)));
            assert!(error.to_string().contains("no credentials were submitted"));
        }

        #[test]
        fn native_policy_capabilities_are_explicitly_unenforceable() {
            let capabilities = WindowsBackend::native_policy_capabilities();
            assert!(!capabilities.can_enforce_smb2_or_newer);
            assert!(!capabilities.can_require_encryption);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Unix implementation — `smbclient` subprocess
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(not(windows))]
mod unix_impl {
    use super::*;
    use std::ffi::OsString;
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use std::process::{ExitStatus, Stdio};
    use std::time::{Duration, Instant};
    use tempfile::{Builder as TempFileBuilder, NamedTempFile};
    use tokio::io::{AsyncRead, AsyncReadExt};
    use tokio::process::{Child, Command};
    use zeroize::{Zeroize, Zeroizing};

    const SMBCLIENT_TIMEOUT: Duration = Duration::from_secs(300);
    const PROCESS_CLEANUP_TIMEOUT: Duration = Duration::from_secs(5);
    const READER_JOIN_TIMEOUT: Duration = Duration::from_secs(5);
    const READER_ABORT_CONFIRM_TIMEOUT: Duration = Duration::from_secs(1);
    const MAX_HELPER_OUTPUT_BYTES: usize = 4 * 1024 * 1024;
    const MAX_AUTH_FIELD_BYTES: usize = 16 * 1024;

    struct PrivateAuthFile {
        file: NamedTempFile,
    }

    impl PrivateAuthFile {
        fn create(session: &SmbSession) -> SmbResult<Option<Self>> {
            let Some(username) = session.config.username.as_deref() else {
                if session.config.password.is_some() {
                    return Err(SmbError::AuthFailed(
                        "an SMB password requires a username".into(),
                    ));
                }
                return Ok(None);
            };

            validate_auth_field(username)?;
            let password = session.config.password.as_deref().unwrap_or("");
            validate_auth_field(password)?;
            if let Some(domain) = session.config.domain.as_deref() {
                validate_auth_field(domain)?;
            }

            let mut contents =
                Zeroizing::new(format!("username = {username}\npassword = {password}\n"));
            if let Some(domain) = session
                .config
                .domain
                .as_deref()
                .filter(|domain| !domain.is_empty())
            {
                contents.push_str("domain = ");
                contents.push_str(domain);
                contents.push('\n');
            }

            let mut file = TempFileBuilder::new()
                .prefix(".sorng-smb-auth-")
                .tempfile()
                .map_err(|_| {
                    SmbError::Backend("unable to create private SMB credential file".into())
                })?;

            #[cfg(unix)]
            {
                use std::os::unix::fs::{MetadataExt, PermissionsExt};

                file.as_file()
                    .set_permissions(std::fs::Permissions::from_mode(0o600))
                    .map_err(|_| {
                        SmbError::Backend("unable to protect private SMB credential file".into())
                    })?;
                let metadata = file.as_file().metadata().map_err(|_| {
                    SmbError::Backend("unable to inspect private SMB credential file".into())
                })?;
                if metadata.mode() & 0o077 != 0 {
                    contents.zeroize();
                    return Err(SmbError::Backend(
                        "private SMB credential file permissions are unsafe".into(),
                    ));
                }
            }
            #[cfg(not(unix))]
            {
                contents.zeroize();
                return Err(SmbError::Unsupported(
                    "secure smbclient credential files are unavailable on this platform".into(),
                ));
            }

            let write_result = file
                .as_file_mut()
                .write_all(contents.as_bytes())
                .and_then(|_| file.as_file_mut().flush());
            contents.zeroize();
            write_result.map_err(|_| {
                SmbError::Backend("unable to write private SMB credential file".into())
            })?;

            Ok(Some(Self { file }))
        }

        fn path(&self) -> &Path {
            self.file.path()
        }
    }

    struct AuthArgs {
        args: Vec<OsString>,
        _auth_file: Option<PrivateAuthFile>,
    }

    struct HelperOutput {
        status: ExitStatus,
        stdout: Vec<u8>,
        stderr: Vec<u8>,
    }

    fn validate_auth_field(value: &str) -> SmbResult<()> {
        if value.len() > MAX_AUTH_FIELD_BYTES
            || value.chars().any(|ch| matches!(ch, '\0' | '\r' | '\n'))
        {
            return Err(SmbError::AuthFailed(
                "SMB credentials contain unsupported characters".into(),
            ));
        }
        Ok(())
    }

    #[cfg(unix)]
    fn current_process_uid() -> SmbResult<u32> {
        use std::os::unix::fs::MetadataExt;

        let probe = TempFileBuilder::new()
            .prefix(".sorng-smb-owner-probe-")
            .tempfile()
            .map_err(|_| SmbError::Backend("unable to verify SMB helper ownership".into()))?;
        probe
            .as_file()
            .metadata()
            .map(|metadata| metadata.uid())
            .map_err(|_| SmbError::Backend("unable to verify SMB helper ownership".into()))
    }

    #[cfg(unix)]
    fn helper_path_is_trusted(canonical: &Path, process_uid: u32) -> bool {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};

        let Ok(file_metadata) = std::fs::symlink_metadata(canonical) else {
            return false;
        };
        let file_mode = file_metadata.permissions().mode();
        if !file_metadata.is_file()
            || (file_metadata.uid() != 0 && file_metadata.uid() != process_uid)
            || file_mode & 0o111 == 0
            || file_mode & 0o022 != 0
        {
            return false;
        }

        for parent in canonical.ancestors().skip(1) {
            let Ok(metadata) = std::fs::symlink_metadata(parent) else {
                return false;
            };
            let mode = metadata.permissions().mode();
            let owner_is_trusted = metadata.uid() == 0 || metadata.uid() == process_uid;
            let writable_by_others = mode & 0o022 != 0;
            let sticky_directory = mode & 0o1000 != 0;
            if !metadata.is_dir() || !owner_is_trusted || (writable_by_others && !sticky_directory)
            {
                return false;
            }
        }
        true
    }

    fn resolve_smbclient_from_candidates<I, P>(candidates: I) -> SmbResult<PathBuf>
    where
        I: IntoIterator<Item = P>,
        P: AsRef<Path>,
    {
        #[cfg(unix)]
        let process_uid = current_process_uid()?;
        for candidate in candidates {
            let candidate = candidate.as_ref();
            if !candidate.is_absolute() {
                continue;
            }
            let Ok(canonical) = std::fs::canonicalize(candidate) else {
                continue;
            };
            let Ok(metadata) = std::fs::metadata(&canonical) else {
                continue;
            };
            if !metadata.is_file() {
                continue;
            }
            #[cfg(unix)]
            {
                if !helper_path_is_trusted(&canonical, process_uid) {
                    continue;
                }
            }
            return Ok(canonical);
        }

        Err(SmbError::Unsupported(
            "an absolute, protected smbclient helper was not found".into(),
        ))
    }

    fn resolve_smbclient() -> SmbResult<PathBuf> {
        #[cfg(target_os = "linux")]
        let candidates = [
            Path::new("/usr/bin/smbclient"),
            Path::new("/usr/local/bin/smbclient"),
            Path::new("/snap/bin/smbclient"),
        ];
        #[cfg(target_os = "macos")]
        let candidates = [
            Path::new("/opt/homebrew/bin/smbclient"),
            Path::new("/usr/local/bin/smbclient"),
            Path::new("/opt/local/bin/smbclient"),
        ];
        #[cfg(all(not(target_os = "linux"), not(target_os = "macos")))]
        let candidates = [Path::new("/usr/bin/smbclient")];

        resolve_smbclient_from_candidates(candidates)
    }

    async fn read_bounded<R>(mut reader: R, max_bytes: usize) -> std::io::Result<(Vec<u8>, bool)>
    where
        R: AsyncRead + Unpin,
    {
        let mut output = Vec::with_capacity(max_bytes.min(64 * 1024));
        let mut chunk = [0u8; 8192];
        let mut truncated = false;
        loop {
            let read = reader.read(&mut chunk).await?;
            if read == 0 {
                return Ok((output, truncated));
            }
            let remaining = max_bytes.saturating_sub(output.len());
            if read > remaining {
                output.extend_from_slice(&chunk[..remaining]);
                truncated = true;
                continue;
            }
            output.extend_from_slice(&chunk[..read]);
        }
    }

    async fn kill_and_reap(child: &mut Child) -> bool {
        let _ = child.start_kill();
        matches!(
            tokio::time::timeout(PROCESS_CLEANUP_TIMEOUT, child.wait()).await,
            Ok(Ok(_))
        )
    }

    async fn join_reader(
        mut task: tokio::task::JoinHandle<std::io::Result<(Vec<u8>, bool)>>,
    ) -> SmbResult<(Vec<u8>, bool)> {
        match tokio::time::timeout(READER_JOIN_TIMEOUT, &mut task).await {
            Ok(Ok(Ok(output))) => Ok(output),
            Ok(Ok(Err(_))) => Err(SmbError::Backend(
                "SMB client helper output read failed".into(),
            )),
            Ok(Err(_)) => Err(SmbError::Backend(
                "SMB client helper output task failed".into(),
            )),
            Err(_) => {
                task.abort();
                let cancellation_confirmed =
                    tokio::time::timeout(READER_ABORT_CONFIRM_TIMEOUT, &mut task)
                        .await
                        .is_ok();
                Err(SmbError::Backend(if cancellation_confirmed {
                    "SMB client helper output drain timed out and was cancelled".into()
                } else {
                    "SMB client helper output drain cancellation could not be confirmed promptly"
                        .into()
                }))
            }
        }
    }

    async fn abort_reader(
        mut task: tokio::task::JoinHandle<std::io::Result<(Vec<u8>, bool)>>,
    ) -> bool {
        task.abort();
        tokio::time::timeout(READER_ABORT_CONFIRM_TIMEOUT, &mut task)
            .await
            .is_ok()
    }

    async fn abort_readers(
        stdout_task: tokio::task::JoinHandle<std::io::Result<(Vec<u8>, bool)>>,
        stderr_task: tokio::task::JoinHandle<std::io::Result<(Vec<u8>, bool)>>,
    ) -> bool {
        let (stdout_stopped, stderr_stopped) =
            tokio::join!(abort_reader(stdout_task), abort_reader(stderr_task));
        stdout_stopped && stderr_stopped
    }

    async fn run_helper(
        program: &Path,
        args: &[OsString],
        operation_timeout: Duration,
        max_output_bytes: usize,
    ) -> SmbResult<HelperOutput> {
        let mut child = Command::new(program)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("LC_ALL", "C")
            .kill_on_drop(true)
            .spawn()
            .map_err(|_| SmbError::Backend("unable to start SMB client helper".into()))?;
        let Some(stdout) = child.stdout.take() else {
            let _ = kill_and_reap(&mut child).await;
            return Err(SmbError::Backend(
                "SMB client helper output was unavailable".into(),
            ));
        };
        let Some(stderr) = child.stderr.take() else {
            let _ = kill_and_reap(&mut child).await;
            return Err(SmbError::Backend(
                "SMB client helper diagnostics were unavailable".into(),
            ));
        };
        let stdout_task = tokio::spawn(read_bounded(stdout, max_output_bytes));
        let stderr_task = tokio::spawn(read_bounded(stderr, max_output_bytes));

        let status = match tokio::time::timeout(operation_timeout, child.wait()).await {
            Ok(Ok(status)) => status,
            Ok(Err(_)) => {
                let reaped = kill_and_reap(&mut child).await;
                let readers_stopped = abort_readers(stdout_task, stderr_task).await;
                return Err(SmbError::Backend(if reaped && readers_stopped {
                    "SMB client helper wait failed".into()
                } else {
                    "SMB client helper cleanup could not be confirmed within the safety timeout"
                        .into()
                }));
            }
            Err(_) => {
                let reaped = kill_and_reap(&mut child).await;
                let readers_stopped = abort_readers(stdout_task, stderr_task).await;
                return Err(SmbError::Backend(if reaped && readers_stopped {
                    "SMB client helper timed out".into()
                } else {
                    "SMB client helper timed out and cleanup could not be confirmed promptly".into()
                }));
            }
        };

        let (stdout_result, stderr_result) =
            tokio::join!(join_reader(stdout_task), join_reader(stderr_task));
        let (stdout, stdout_truncated) = stdout_result?;
        let (stderr, stderr_truncated) = stderr_result?;
        if stdout_truncated || stderr_truncated {
            return Err(SmbError::Backend(
                "SMB client helper output exceeded the safety limit".into(),
            ));
        }

        Ok(HelperOutput {
            status,
            stdout,
            stderr,
        })
    }

    pub struct UnixBackend;

    impl UnixBackend {
        pub fn new() -> Self {
            Self
        }

        /// Convert our forward-slash wire path to the backslash path that
        /// smbclient's `-c` commands expect (Windows-native SMB syntax).
        fn smb_path(path: &str) -> String {
            let trimmed = path.trim_start_matches('/');
            trimmed.replace('/', "\\")
        }

        /// Quote one argument for smbclient's `-c` command language.
        ///
        /// `smbclient -c` accepts a semicolon-separated command string, so
        /// remote paths must not be interpolated directly into that string.
        /// Reject command-language metacharacters that can terminate the
        /// current command or trigger smbclient's local shell escape.
        fn quote_smbclient_arg(arg: &str) -> SmbResult<String> {
            if arg
                .chars()
                .any(|ch| matches!(ch, '\"' | ';' | '!' | '\r' | '\n') || ch.is_control())
            {
                return Err(SmbError::InvalidPath(
                    "SMB path contains unsupported smbclient command characters".into(),
                ));
            }
            Ok(format!("\"{}\"", arg))
        }

        fn base_auth_args(session: &SmbSession) -> SmbResult<AuthArgs> {
            validate_server_host(&session.config.host)?;
            let mut args = Vec::new();
            let auth_file = PrivateAuthFile::create(session)?;
            if let Some(auth_file) = auth_file.as_ref() {
                args.push(OsString::from("-A"));
                args.push(auth_file.path().as_os_str().to_owned());
            } else {
                args.push(OsString::from("-N"));
            }
            if let Some(wg) = &session.config.workgroup {
                if !wg.is_empty() {
                    validate_auth_field(wg)?;
                    args.push(OsString::from("-W"));
                    args.push(OsString::from(wg));
                }
            }
            if session.config.port != 445 {
                args.push(OsString::from("-p"));
                args.push(OsString::from(session.config.port.to_string()));
            }
            if session.config.use_kerberos {
                args.push(OsString::from("-k"));
            }
            if session.config.disable_plaintext {
                args.push(OsString::from("--option=client plaintext auth=no"));
                args.push(OsString::from("--option=client lanman auth=no"));
                args.push(OsString::from("--option=client ntlmv2 auth=yes"));
                args.push(OsString::from("--option=client min protocol=SMB2_02"));
                args.push(OsString::from("--option=client max protocol=SMB3"));
                args.push(OsString::from("--option=client smb encrypt=required"));
            }
            Ok(AuthArgs {
                args,
                _auth_file: auth_file,
            })
        }

        async fn run_smbclient(
            session: &SmbSession,
            trailing_args: impl IntoIterator<Item = OsString>,
        ) -> SmbResult<String> {
            let helper = resolve_smbclient()?;
            let mut auth = Self::base_auth_args(session)?;
            auth.args.extend(trailing_args);
            let output = run_helper(
                &helper,
                &auth.args,
                SMBCLIENT_TIMEOUT,
                MAX_HELPER_OUTPUT_BYTES,
            )
            .await?;
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            if !output.status.success() {
                if stderr.contains("NT_STATUS_LOGON_FAILURE")
                    || stdout.contains("NT_STATUS_LOGON_FAILURE")
                {
                    return Err(SmbError::AuthFailed(
                        "SMB authentication was rejected".into(),
                    ));
                }
                if stderr.contains("NT_STATUS_OBJECT_NAME_NOT_FOUND")
                    || stdout.contains("NT_STATUS_OBJECT_NAME_NOT_FOUND")
                {
                    return Err(SmbError::InvalidPath(
                        "the requested SMB path was not found".into(),
                    ));
                }
                return Err(SmbError::Backend("SMB client command failed".into()));
            }
            Ok(stdout.into_owned())
        }

        async fn run_smbclient_cmd(
            session: &SmbSession,
            share: &str,
            commands: &str,
        ) -> SmbResult<String> {
            let target = format!("//{}/{}", session.config.host, share);
            Self::run_smbclient(
                session,
                [
                    OsString::from(target),
                    OsString::from("-c"),
                    OsString::from(commands),
                ],
            )
            .await
        }
    }

    #[async_trait]
    impl OpsBackend for UnixBackend {
        async fn probe(&self, session: &SmbSession) -> SmbResult<()> {
            // "ls" on the share root; fails fast on bad auth.
            let share = session.config.share.as_deref().unwrap_or("IPC$");
            Self::run_smbclient_cmd(session, share, "ls")
                .await
                .map(|_| ())
        }

        async fn disconnect(&self, _session: &SmbSession) -> SmbResult<()> {
            Ok(())
        }

        async fn list_shares(&self, session: &SmbSession) -> SmbResult<Vec<SmbShareInfo>> {
            let stdout = Self::run_smbclient(
                session,
                [
                    OsString::from("-L"),
                    OsString::from(format!("//{}", session.config.host)),
                ],
            )
            .await?;
            Ok(parse_smbclient_shares(&stdout))
        }

        async fn list_dir(
            &self,
            session: &SmbSession,
            share: &str,
            path: &str,
        ) -> SmbResult<Vec<SmbDirEntry>> {
            let smb_path = Self::smb_path(path);
            let ls_target = if smb_path.is_empty() {
                "ls".to_string()
            } else {
                format!("cd {}; ls", Self::quote_smbclient_arg(&smb_path)?)
            };
            let out = Self::run_smbclient_cmd(session, share, &ls_target).await?;
            Ok(parse_smbclient_ls(&out, path))
        }

        async fn stat(&self, session: &SmbSession, share: &str, path: &str) -> SmbResult<SmbStat> {
            // smbclient doesn't expose a direct `stat`; use `allinfo`.
            let smb_path = Self::smb_path(path);
            let cmd = format!("allinfo {}", Self::quote_smbclient_arg(&smb_path)?);
            let out = Self::run_smbclient_cmd(session, share, &cmd).await?;
            parse_smbclient_allinfo(&out, path)
                .ok_or_else(|| SmbError::Backend("allinfo parse failed".into()))
        }

        async fn read_file(
            &self,
            session: &SmbSession,
            share: &str,
            path: &str,
            max_bytes: Option<u64>,
        ) -> SmbResult<SmbReadResult> {
            // Download to a temp file then read bytes back. smbclient doesn't
            // stream to stdout in a format we can rely on across builds.
            let max = inline_read_limit(max_bytes);
            let remote_stat = self.stat(session, share, path).await?;
            if remote_stat.size > max {
                return Err(SmbError::Other(format!(
                    "file size {} exceeds the inline limit {max}; use smb_download_file",
                    remote_stat.size
                )));
            }
            let temp = transfer_tempfile()?;
            let temp_path = temp.path().to_string_lossy().into_owned();
            let smb_path = Self::smb_path(path);
            let cmd = format!(
                "get {} {}",
                Self::quote_smbclient_arg(&smb_path)?,
                Self::quote_smbclient_arg(&temp_path)?
            );
            let _ = Self::run_smbclient_cmd(session, share, &cmd).await?;
            let downloaded_size = tokio::fs::metadata(temp.path())
                .await
                .map_err(|_| SmbError::Backend("unable to inspect SMB transfer file".into()))?
                .len();
            if downloaded_size > max {
                return Err(SmbError::Other(format!(
                    "downloaded file exceeds the inline limit {max}; use smb_download_file"
                )));
            }
            let file = tokio::fs::File::open(temp.path())
                .await
                .map_err(|_| SmbError::Backend("unable to read SMB transfer file".into()))?;
            let mut bytes = Vec::with_capacity(downloaded_size as usize);
            let mut limited = file.take(max.saturating_add(1));
            limited
                .read_to_end(&mut bytes)
                .await
                .map_err(|_| SmbError::Backend("unable to read SMB transfer file".into()))?;
            if bytes.len() as u64 > max {
                return Err(SmbError::Other(format!(
                    "downloaded file exceeds the inline limit {max}; use smb_download_file"
                )));
            }
            Ok(SmbReadResult {
                path: path.to_string(),
                size: bytes.len() as u64,
                content_b64: base64_encode(&bytes),
            })
        }

        async fn write_file(
            &self,
            session: &SmbSession,
            share: &str,
            path: &str,
            content_b64: &str,
            overwrite: bool,
        ) -> SmbResult<SmbWriteResult> {
            validate_inline_base64(content_b64)?;
            if !overwrite {
                return Err(SmbError::Unsupported(
                    "smbclient cannot atomically guarantee overwrite=false; use an explicit overwrite or a native SMB client".into(),
                ));
            }
            let bytes = base64_decode(content_b64)
                .map_err(|e| SmbError::Other(format!("base64 decode: {e}")))?;
            if bytes.len() as u64 > MAX_INLINE_FILE_BYTES {
                return Err(SmbError::Other(
                    "decoded SMB payload exceeds the 16 MiB safety limit".into(),
                ));
            }
            let temp = transfer_tempfile()?;
            let temp_path = temp.path().to_string_lossy().into_owned();
            tokio::fs::write(temp.path(), &bytes)
                .await
                .map_err(|_| SmbError::Backend("unable to write SMB transfer file".into()))?;
            let smb_path = Self::smb_path(path);
            let cmd = format!(
                "put {} {}",
                Self::quote_smbclient_arg(&temp_path)?,
                Self::quote_smbclient_arg(&smb_path)?
            );
            let _ = Self::run_smbclient_cmd(session, share, &cmd).await?;
            Ok(SmbWriteResult {
                path: path.to_string(),
                bytes_written: bytes.len() as u64,
            })
        }

        async fn download_file(
            &self,
            session: &SmbSession,
            share: &str,
            remote_path: &str,
            local_path: &str,
        ) -> SmbResult<SmbTransferResult> {
            let started = Instant::now();
            let (destination, temp) = atomic_download_temp(local_path)?;
            let temp_path = temp.path().to_string_lossy().into_owned();
            let smb_path = Self::smb_path(remote_path);
            let cmd = format!(
                "get {} {}",
                Self::quote_smbclient_arg(&smb_path)?,
                Self::quote_smbclient_arg(&temp_path)?
            );
            let _ = Self::run_smbclient_cmd(session, share, &cmd).await?;
            let bytes_transferred = tokio::fs::metadata(temp.path())
                .await
                .map(|metadata| metadata.len())
                .unwrap_or(0);
            persist_atomic_download(temp, &destination)?;
            Ok(SmbTransferResult {
                remote_path: remote_path.to_string(),
                local_path: local_path.to_string(),
                bytes_transferred,
                duration_ms: started.elapsed().as_millis() as u64,
            })
        }

        async fn upload_file(
            &self,
            session: &SmbSession,
            share: &str,
            local_path: &str,
            remote_path: &str,
        ) -> SmbResult<SmbTransferResult> {
            let started = Instant::now();
            let md = tokio::fs::metadata(local_path)
                .await
                .map_err(|e| SmbError::Backend(format!("local stat: {e}")))?;
            let smb_path = Self::smb_path(remote_path);
            let cmd = format!(
                "put {} {}",
                Self::quote_smbclient_arg(local_path)?,
                Self::quote_smbclient_arg(&smb_path)?
            );
            let _ = Self::run_smbclient_cmd(session, share, &cmd).await?;
            Ok(SmbTransferResult {
                remote_path: remote_path.to_string(),
                local_path: local_path.to_string(),
                bytes_transferred: md.len(),
                duration_ms: started.elapsed().as_millis() as u64,
            })
        }

        async fn mkdir(&self, session: &SmbSession, share: &str, path: &str) -> SmbResult<()> {
            let smb_path = Self::smb_path(path);
            let cmd = format!("mkdir {}", Self::quote_smbclient_arg(&smb_path)?);
            Self::run_smbclient_cmd(session, share, &cmd)
                .await
                .map(|_| ())
        }

        async fn rmdir(
            &self,
            session: &SmbSession,
            share: &str,
            path: &str,
            recursive: bool,
        ) -> SmbResult<()> {
            let smb_path = Self::smb_path(path);
            if recursive {
                // smbclient has `deltree` in newer builds; fall back to manual.
                let cmd = format!("deltree {}", Self::quote_smbclient_arg(&smb_path)?);
                match Self::run_smbclient_cmd(session, share, &cmd).await {
                    Ok(_) => Ok(()),
                    Err(_) => {
                        // Fallback: enumerate + delete.
                        self.rmdir_manual_recursive(session, share, path).await
                    }
                }
            } else {
                let cmd = format!("rmdir {}", Self::quote_smbclient_arg(&smb_path)?);
                Self::run_smbclient_cmd(session, share, &cmd)
                    .await
                    .map(|_| ())
            }
        }

        async fn delete_file(
            &self,
            session: &SmbSession,
            share: &str,
            path: &str,
        ) -> SmbResult<()> {
            let smb_path = Self::smb_path(path);
            let cmd = format!("del {}", Self::quote_smbclient_arg(&smb_path)?);
            Self::run_smbclient_cmd(session, share, &cmd)
                .await
                .map(|_| ())
        }

        async fn rename(
            &self,
            session: &SmbSession,
            share: &str,
            from: &str,
            to: &str,
        ) -> SmbResult<()> {
            let from_p = Self::smb_path(from);
            let to_p = Self::smb_path(to);
            let cmd = format!(
                "rename {} {}",
                Self::quote_smbclient_arg(&from_p)?,
                Self::quote_smbclient_arg(&to_p)?
            );
            Self::run_smbclient_cmd(session, share, &cmd)
                .await
                .map(|_| ())
        }
    }

    impl UnixBackend {
        async fn rmdir_manual_recursive(
            &self,
            session: &SmbSession,
            share: &str,
            path: &str,
        ) -> SmbResult<()> {
            let entries = self.list_dir(session, share, path).await?;
            for entry in entries {
                if entry.name == "." || entry.name == ".." {
                    continue;
                }
                match entry.entry_type {
                    SmbEntryType::Directory => {
                        Box::pin(self.rmdir_manual_recursive(session, share, &entry.path)).await?;
                    }
                    _ => {
                        self.delete_file(session, share, &entry.path).await?;
                    }
                }
            }
            let smb_path = Self::smb_path(path);
            let cmd = format!("rmdir {}", Self::quote_smbclient_arg(&smb_path)?);
            Self::run_smbclient_cmd(session, share, &cmd)
                .await
                .map(|_| ())
        }
    }

    // ─── parsers ──────────────────────────────────────────────────────────

    fn parse_smbclient_shares(stdout: &str) -> Vec<SmbShareInfo> {
        // smbclient -L output has a "Sharename   Type    Comment" header.
        let mut shares = Vec::new();
        let mut in_shares_section = false;
        for line in stdout.lines() {
            let trimmed = line.trim_end();
            if trimmed.to_lowercase().contains("sharename")
                && trimmed.to_lowercase().contains("type")
            {
                in_shares_section = true;
                continue;
            }
            if in_shares_section && trimmed.trim().starts_with("---") {
                continue;
            }
            if !in_shares_section {
                continue;
            }
            if trimmed.trim().is_empty()
                || trimmed.to_lowercase().contains("server")
                || trimmed.to_lowercase().contains("workgroup")
            {
                if trimmed.trim().is_empty() {
                    in_shares_section = false;
                }
                continue;
            }
            let cols: Vec<&str> = trimmed.split_whitespace().collect();
            if cols.len() < 2 {
                continue;
            }
            let name = cols[0].to_string();
            let type_tok = cols[1];
            let comment = if cols.len() > 2 {
                Some(cols[2..].join(" "))
            } else {
                None
            };
            let share_type = match type_tok.to_lowercase().as_str() {
                "disk" => SmbShareType::Disk,
                "printer" => SmbShareType::Printer,
                "ipc" => SmbShareType::Ipc,
                "device" => SmbShareType::Device,
                _ => SmbShareType::Unknown,
            };
            shares.push(SmbShareInfo {
                is_admin: name.ends_with('$'),
                name,
                share_type,
                comment,
            });
        }
        shares
    }

    /// Parse `smbclient ls` output. Format:
    ///   `  .                                   D        0  Wed Jan  1 00:00:00 2025`
    /// Columns: name, attrs (D/H/R/A/S/…), size, date.
    fn parse_smbclient_ls(stdout: &str, parent_path: &str) -> Vec<SmbDirEntry> {
        let mut out = Vec::new();
        let re = match regex::Regex::new(r"^\s{2}(.+?)\s{2,}([DHSRNA]*)\s+(\d+)\s+(.+)$") {
            Ok(r) => r,
            Err(_) => return out,
        };
        for line in stdout.lines() {
            let Some(caps) = re.captures(line) else {
                continue;
            };
            let name = caps
                .get(1)
                .map(|m| m.as_str().trim().to_string())
                .unwrap_or_default();
            let attrs = caps.get(2).map(|m| m.as_str()).unwrap_or("");
            let size: u64 = caps
                .get(3)
                .and_then(|m| m.as_str().parse().ok())
                .unwrap_or(0);
            let date_s = caps.get(4).map(|m| m.as_str().trim().to_string());
            let modified = date_s.and_then(parse_smb_date);
            let entry_type = if attrs.contains('D') {
                SmbEntryType::Directory
            } else {
                SmbEntryType::File
            };
            let mut child_path = parent_path.trim_end_matches('/').to_string();
            if !child_path.is_empty() && !child_path.ends_with('/') {
                child_path.push('/');
            }
            child_path.push_str(&name);
            out.push(SmbDirEntry {
                name,
                path: child_path,
                entry_type,
                size,
                modified,
                is_hidden: attrs.contains('H'),
                is_readonly: attrs.contains('R'),
                is_system: attrs.contains('S'),
            });
        }
        out
    }

    /// Parse `smbclient allinfo` output.
    fn parse_smbclient_allinfo(stdout: &str, path: &str) -> Option<SmbStat> {
        // allinfo lines like:
        //   altname: FOO~1.TXT
        //   create_time: Tue Jan  2 10:11:12 2024 EST
        //   access_time: ...
        //   write_time:  ...
        //   attributes: A (20)
        //   stream: <data>, 1024 bytes
        let mut created = None;
        let mut accessed = None;
        let mut modified = None;
        let mut is_hidden = false;
        let mut is_readonly = false;
        let mut is_system = false;
        let mut entry_type = SmbEntryType::File;
        let mut size: u64 = 0;
        for line in stdout.lines() {
            let l = line.trim();
            if let Some(v) = l.strip_prefix("create_time:") {
                created = parse_smb_date(v.trim().to_string());
            } else if let Some(v) = l.strip_prefix("access_time:") {
                accessed = parse_smb_date(v.trim().to_string());
            } else if let Some(v) = l.strip_prefix("write_time:") {
                modified = parse_smb_date(v.trim().to_string());
            } else if let Some(v) = l.strip_prefix("attributes:") {
                let v = v.trim();
                is_hidden = v.contains('H');
                is_readonly = v.contains('R');
                is_system = v.contains('S');
                if v.contains('D') {
                    entry_type = SmbEntryType::Directory;
                }
            } else if let Some(v) = l.strip_prefix("stream:") {
                // "<data>, NNN bytes"
                if let Some(bytes_s) = v.split(',').nth(1) {
                    let bytes_s = bytes_s.trim().trim_end_matches(" bytes");
                    size = bytes_s.parse().unwrap_or(0);
                }
            }
        }
        Some(SmbStat {
            path: path.to_string(),
            entry_type,
            size,
            modified,
            created,
            accessed,
            is_hidden,
            is_readonly,
            is_system,
        })
    }

    /// Very lenient date parser — accepts the output formats smbclient
    /// uses on both old (`Wed Jan  1 00:00:00 2025`) and new builds.
    /// Returns millis since epoch, or None if parsing fails.
    fn parse_smb_date(s: String) -> Option<i64> {
        use chrono::NaiveDateTime;
        // smbclient typical: "Wed Jan  1 00:00:00 2025"
        for fmt in &[
            "%a %b %e %H:%M:%S %Y",
            "%a %b %d %H:%M:%S %Y",
            "%Y-%m-%d %H:%M:%S",
        ] {
            if let Ok(dt) = NaiveDateTime::parse_from_str(s.trim(), fmt) {
                return Some(dt.and_utc().timestamp_millis());
            }
        }
        None
    }

    fn transfer_tempfile() -> SmbResult<NamedTempFile> {
        TempFileBuilder::new()
            .prefix(".sorng-smb-transfer-")
            .tempfile()
            .map_err(|_| SmbError::Backend("unable to create SMB transfer file".into()))
    }

    // ─── Tiny base64 helpers (no extra dep) ─────────────────────────────────
    fn base64_encode(input: &[u8]) -> String {
        const ALPHA: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
        for chunk in input.chunks(3) {
            let b0 = chunk[0];
            let b1 = if chunk.len() > 1 { chunk[1] } else { 0 };
            let b2 = if chunk.len() > 2 { chunk[2] } else { 0 };
            out.push(ALPHA[(b0 >> 2) as usize] as char);
            out.push(ALPHA[(((b0 & 0b11) << 4) | (b1 >> 4)) as usize] as char);
            if chunk.len() > 1 {
                out.push(ALPHA[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char);
            } else {
                out.push('=');
            }
            if chunk.len() > 2 {
                out.push(ALPHA[(b2 & 0x3f) as usize] as char);
            } else {
                out.push('=');
            }
        }
        out
    }

    fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
        const ALPHA: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        if input.len() > MAX_INLINE_BASE64_BYTES {
            return Err("inline base64 input exceeds safety limit".into());
        }
        let mut lut = [0u8; 256];
        for (i, b) in ALPHA.iter().enumerate() {
            lut[*b as usize] = i as u8;
        }
        let mut out = Vec::with_capacity(input.len().saturating_mul(3) / 4);
        let mut buf: u32 = 0;
        let mut bits = 0u32;
        for b in input.bytes() {
            if b.is_ascii_whitespace() {
                continue;
            }
            if b == b'=' {
                break;
            }
            if !ALPHA.contains(&b) {
                return Err(format!("invalid base64 char: {b}"));
            }
            buf = (buf << 6) | lut[b as usize] as u32;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                out.push((buf >> bits) as u8);
            }
        }
        Ok(out)
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[cfg(unix)]
        use std::os::unix::fs::PermissionsExt;
        #[cfg(unix)]
        use tokio::io::AsyncWriteExt;

        #[test]
        fn parse_shares_header() {
            let sample = "
        Sharename       Type      Comment
        ---------       ----      -------
        Shared          Disk      Default share
        IPC$            IPC       Remote IPC
        Users           Disk
";
            let s = parse_smbclient_shares(sample);
            assert_eq!(s.len(), 3);
            assert_eq!(s[0].name, "Shared");
            assert_eq!(s[0].share_type, SmbShareType::Disk);
            assert_eq!(s[1].share_type, SmbShareType::Ipc);
            assert!(s[1].is_admin);
        }

        #[test]
        fn parse_ls_entries() {
            let sample = "  Documents                           D        0  Wed Jan  1 00:00:00 2025\n  notes.txt                           A      128  Wed Jan  1 00:00:00 2025\n";
            let out = parse_smbclient_ls(sample, "/home");
            assert_eq!(out.len(), 2);
            assert_eq!(out[0].name, "Documents");
            assert_eq!(out[0].entry_type, SmbEntryType::Directory);
            assert_eq!(out[1].name, "notes.txt");
            assert_eq!(out[1].size, 128);
        }

        #[test]
        fn quote_smbclient_arg_rejects_command_metacharacters() {
            assert_eq!(
                UnixBackend::quote_smbclient_arg(r"safe\path.txt").unwrap(),
                r#""safe\path.txt""#
            );

            for malicious in [
                r#"evil"; ! touch pwned; ""#,
                "semi;colon",
                "local!escape",
                "line\nbreak",
                "carriage\rreturn",
            ] {
                assert!(matches!(
                    UnixBackend::quote_smbclient_arg(malicious),
                    Err(SmbError::InvalidPath(_))
                ));
            }
        }

        #[cfg(unix)]
        fn test_session(password: Option<&str>) -> SmbSession {
            SmbSession::new(
                "test-session".into(),
                SmbConnectionConfig {
                    host: "files.internal".into(),
                    port: 445,
                    domain: Some("EXAMPLE".into()),
                    username: Some("alice".into()),
                    password: password.map(str::to_owned),
                    workgroup: None,
                    share: Some("public".into()),
                    label: None,
                    disable_plaintext: true,
                    use_kerberos: false,
                },
                "unix-smbclient",
            )
        }

        #[cfg(unix)]
        fn fake_helper(script: &str) -> tempfile::TempPath {
            let mut helper = TempFileBuilder::new()
                .prefix("sorng-smb-fake-helper-")
                .tempfile()
                .unwrap();
            helper.write_all(script.as_bytes()).unwrap();
            helper.flush().unwrap();
            helper
                .as_file()
                .set_permissions(std::fs::Permissions::from_mode(0o700))
                .unwrap();
            helper.into_temp_path()
        }

        #[cfg(unix)]
        #[tokio::test]
        async fn auth_file_keeps_secrets_out_of_fake_helper_argv_and_cleans_up() {
            let secret = "p%ss word;still-secret";
            let session = test_session(Some(secret));
            let auth = UnixBackend::base_auth_args(&session).unwrap();
            let auth_path = auth._auth_file.as_ref().unwrap().path().to_owned();
            let auth_contents = std::fs::read_to_string(&auth_path).unwrap();
            assert!(auth_contents.contains(secret));

            let argv = auth
                .args
                .iter()
                .map(|arg| arg.to_string_lossy())
                .collect::<Vec<_>>()
                .join("\n");
            assert!(!argv.contains(secret));
            assert!(!argv.contains("alice%"));
            assert!(argv.contains("client min protocol=SMB2_02"));
            assert!(argv.contains("client plaintext auth=no"));
            assert!(argv.contains("client smb encrypt=required"));

            let helper = fake_helper("#!/bin/sh\nprintf '%s\\n' \"$@\"\n");
            let mut helper_args = Vec::with_capacity(auth.args.len() + 1);
            helper_args.push(helper.as_os_str().to_owned());
            helper_args.extend(auth.args.iter().cloned());
            let output = run_helper(
                Path::new("/bin/sh"),
                &helper_args,
                Duration::from_secs(2),
                4096,
            )
            .await
            .unwrap();
            assert!(output.status.success());
            let observed = String::from_utf8(output.stdout).unwrap();
            assert!(observed.contains("client min protocol=SMB2_02"));
            assert!(!observed.contains(secret));
            assert!(!observed.contains("alice%"));

            drop(auth);
            assert!(!auth_path.exists());
        }

        #[cfg(unix)]
        #[test]
        fn resolver_accepts_only_absolute_protected_executables() {
            let helper = fake_helper("#!/bin/sh\nexit 0\n");
            let helper_path: &Path = helper.as_ref();
            let resolved = resolve_smbclient_from_candidates([helper_path]).unwrap();
            assert!(resolved.is_absolute());

            assert!(resolve_smbclient_from_candidates([Path::new("smbclient")]).is_err());
            std::fs::set_permissions(helper_path, std::fs::Permissions::from_mode(0o777)).unwrap();
            assert!(resolve_smbclient_from_candidates([helper_path]).is_err());

            let unsafe_parent = tempfile::tempdir().unwrap();
            std::fs::set_permissions(unsafe_parent.path(), std::fs::Permissions::from_mode(0o777))
                .unwrap();
            let nested_helper = unsafe_parent.path().join("smbclient");
            std::fs::write(&nested_helper, b"#!/bin/sh\nexit 0\n").unwrap();
            std::fs::set_permissions(&nested_helper, std::fs::Permissions::from_mode(0o700))
                .unwrap();
            assert!(resolve_smbclient_from_candidates([&nested_helper]).is_err());
        }

        #[cfg(unix)]
        #[tokio::test]
        async fn capped_reader_continues_draining_without_growing() {
            let (mut writer, reader) = tokio::io::duplex(128);
            let writer_task = tokio::spawn(async move {
                writer.write_all(&vec![b'x'; 8192]).await?;
                writer.shutdown().await
            });
            let (output, truncated) = read_bounded(reader, 64).await.unwrap();
            writer_task.await.unwrap().unwrap();
            assert_eq!(output.len(), 64);
            assert!(truncated);
        }

        #[cfg(unix)]
        #[tokio::test]
        async fn reader_abort_waits_for_bounded_cancellation_confirmation() {
            let (_writer, reader) = tokio::io::duplex(128);
            let reader_task = tokio::spawn(read_bounded(reader, 64));
            assert!(abort_reader(reader_task).await);
        }

        #[cfg(unix)]
        #[tokio::test]
        async fn fake_helper_timeout_kills_and_reaps() {
            let helper = fake_helper("#!/bin/sh\nwhile :; do :; done\n");
            let helper_args = [helper.as_os_str().to_owned()];
            let error = match run_helper(
                Path::new("/bin/sh"),
                &helper_args,
                Duration::from_millis(25),
                1024,
            )
            .await
            {
                Err(error) => error,
                Ok(_) => panic!("busy helper must time out"),
            };
            match error {
                SmbError::Backend(message) => {
                    assert_eq!(message, "SMB client helper timed out");
                }
                other => panic!("unexpected helper error: {other}"),
            }
        }

        #[cfg(unix)]
        #[test]
        fn auth_file_rejects_line_injection() {
            let session = test_session(Some("secret\nclient min protocol = NT1"));
            assert!(matches!(
                UnixBackend::base_auth_args(&session),
                Err(SmbError::AuthFailed(_))
            ));
        }

        #[test]
        fn b64_roundtrip() {
            let cases: &[(&[u8], &str)] = &[
                (b"", ""),
                (b"h", "aA=="),
                (b"hi", "aGk="),
                (b"hey", "aGV5"),
                (b"hello smb", "aGVsbG8gc21i"),
                (&[0xff, 0x00, 0x80], "/wCA"),
            ];

            for (data, encoded) in cases {
                assert_eq!(base64_encode(data), *encoded);
                assert_eq!(base64_decode(encoded).unwrap(), *data);
            }
        }
    }
}
