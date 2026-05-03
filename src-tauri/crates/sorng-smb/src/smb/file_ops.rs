// ── File operations (platform-split) ─────────────────────────────────────────
//
// This module owns ALL platform-dependent code. Everything else in the
// crate is portable. Two independent implementations live here:
//
//   • `windows` module — uses UNC paths + std::fs; share enum via `net view`.
//   • `unix`    module — shells out to `smbclient`.
//
// Both expose the same `OpsBackend` trait surface so `service.rs` can
// swap them at `cfg` boundaries. Blocking work (subprocess spawn,
// UNC std::fs calls) runs inside `tokio::task::spawn_blocking`.

use super::session::SmbSession;
use super::types::*;
use async_trait::async_trait;

#[async_trait]
pub trait OpsBackend: Send + Sync {
    /// Probe server reachability / authenticate. Fail early if creds bad.
    async fn probe(&self, session: &SmbSession) -> SmbResult<()>;

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

// ═══════════════════════════════════════════════════════════════════════════
// Windows implementation — UNC + std::fs + `net view`
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(windows)]
mod windows_impl {
    use super::*;
    use base64_shim as b64;
    use std::path::PathBuf;
    use std::time::Instant;
    use tokio::task::spawn_blocking;

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
            let mut lut = [0u8; 256];
            for (i, b) in ALPHA.iter().enumerate() {
                lut[*b as usize] = i as u8;
            }
            let clean: Vec<u8> = input.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
            let trimmed = clean
                .iter()
                .copied()
                .take_while(|b| *b != b'=')
                .collect::<Vec<_>>();
            let mut out = Vec::with_capacity(trimmed.len() * 3 / 4);
            let mut buf: u32 = 0;
            let mut bits = 0u32;
            for b in trimmed {
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

        fn ensure_supported_target(session: &SmbSession) -> SmbResult<()> {
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

        /// Connect / authenticate with the Windows SMB redirector via
        /// `net use` — best-effort; no-op if creds already cached. We
        /// deliberately do NOT persist the connection (`/PERSISTENT:NO`).
        fn net_use_connect(session: &SmbSession) -> SmbResult<()> {
            use std::process::Command;
            // If no creds provided, rely on ambient auth (current user).
            let Some(ref user) = session.config.username else {
                return Ok(());
            };
            let host = &session.config.host;
            let share = session.config.share.as_deref().unwrap_or("IPC$");
            let target = format!(r"\\{}\{}", host, share);
            let password = session.config.password.as_deref().unwrap_or("");
            let user_full = match session.config.domain.as_deref() {
                Some(d) if !d.is_empty() => format!(r"{}\{}", d, user),
                _ => user.to_string(),
            };
            let out = Command::new("net")
                .args([
                    "use",
                    &target,
                    password,
                    &format!("/USER:{user_full}"),
                    "/PERSISTENT:NO",
                ])
                .output()
                .map_err(|e| SmbError::Backend(format!("net use spawn: {e}")))?;
            if !out.status.success() {
                let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                // "1219" = session exists with different creds — treat as fatal.
                // "1326" = logon failure.
                if stderr.contains("1326") || stdout.contains("1326") {
                    return Err(SmbError::AuthFailed(
                        "logon failure (bad username or password)".into(),
                    ));
                }
                // Otherwise, it may already be connected; log and continue.
                log::debug!(
                    "net use non-zero exit (likely already connected): {} / {}",
                    stdout.trim(),
                    stderr.trim()
                );
            }
            Ok(())
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
            let session = session.clone();
            spawn_blocking(move || Self::net_use_connect(&session))
                .await
                .map_err(|e| SmbError::Backend(format!("join: {e}")))??;
            Ok(())
        }

        async fn list_shares(&self, session: &SmbSession) -> SmbResult<Vec<SmbShareInfo>> {
            Self::ensure_supported_target(session)?;
            let host = session.config.host.clone();
            spawn_blocking(move || -> SmbResult<Vec<SmbShareInfo>> {
                use std::process::Command;
                let target = format!(r"\\{}", host);
                let out = Command::new("net")
                    .args(["view", &target, "/ALL"])
                    .output()
                    .map_err(|e| SmbError::Backend(format!("net view spawn: {e}")))?;
                if !out.status.success() {
                    let stderr = String::from_utf8_lossy(&out.stderr);
                    // `net view` exits non-zero if the remote server isn't
                    // browsable; return empty list rather than erroring.
                    if stderr.contains("6118") {
                        return Ok(vec![]);
                    }
                    return Err(SmbError::Backend(format!("net view failed: {}", stderr)));
                }
                let stdout = String::from_utf8_lossy(&out.stdout);
                Ok(parse_net_view_output(&stdout))
            })
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
                    let is_hidden = name.starts_with('.')
                        || WindowsBackend::is_windows_hidden(&md);
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
                    modified: md.modified().ok().and_then(WindowsBackend::millis_since_epoch),
                    created: md.created().ok().and_then(WindowsBackend::millis_since_epoch),
                    accessed: md.accessed().ok().and_then(WindowsBackend::millis_since_epoch),
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
                if let Some(max) = max_bytes {
                    if len > max {
                        return Err(SmbError::Other(format!(
                            "file size {len} exceeds max_bytes {max}; use smb_download_file"
                        )));
                    }
                }
                let bytes = std::fs::read(&unc)
                    .map_err(|e| SmbError::Backend(format!("read {}: {e}", unc.display())))?;
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
            let host = session.config.host.clone();
            let share_s = share.to_string();
            let path_s = path.to_string();
            let content_b64 = content_b64.to_string();
            spawn_blocking(move || -> SmbResult<SmbWriteResult> {
                let unc = WindowsBackend::unc(&host, &share_s, &path_s);
                let bytes = b64::decode(&content_b64)
                    .map_err(|e| SmbError::Other(format!("base64 decode: {e}")))?;
                if !overwrite && unc.exists() {
                    return Err(SmbError::Other(format!(
                        "{} already exists and overwrite=false",
                        unc.display()
                    )));
                }
                std::fs::write(&unc, &bytes)
                    .map_err(|e| SmbError::Backend(format!("write {}: {e}", unc.display())))?;
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
                let bytes = std::fs::copy(&unc, &local_s)
                    .map_err(|e| SmbError::Backend(format!("copy {}→{}: {e}", unc.display(), local_s)))?;
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
                let bytes = std::fs::copy(&local_s, &unc)
                    .map_err(|e| SmbError::Backend(format!("copy {}→{}: {e}", local_s, unc.display())))?;
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

        async fn delete_file(&self, session: &SmbSession, share: &str, path: &str) -> SmbResult<()> {
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

    // ─── `net view` output parser ───────────────────────────────────────────
    // The command produces something like:
    //
    //   Shared resources at \\host
    //
    //   Share name  Type   Used as  Comment
    //   -----------------------------------
    //   C$          Disk            Default share
    //   IPC$        IPC             Remote IPC
    //   Users       Disk
    //   Printer     Print           HP LaserJet
    //   The command completed successfully.
    //
    // We scan for a header line of dashes, then parse fixed-ish columns
    // until the trailing "command completed" line. Share type tokens are
    // localised by Windows; we map the English forms and fall back to
    // "Unknown" for others.
    fn parse_net_view_output(stdout: &str) -> Vec<SmbShareInfo> {
        let mut shares = Vec::new();
        let mut in_table = false;
        for line in stdout.lines() {
            let trimmed = line.trim_end();
            if trimmed.starts_with("-----") {
                in_table = true;
                continue;
            }
            if !in_table {
                continue;
            }
            if trimmed.is_empty() {
                continue;
            }
            if trimmed.to_lowercase().contains("command completed")
                || trimmed.to_lowercase().contains("command failed")
            {
                break;
            }
            // Split on 2+ whitespace so names/comments with single spaces survive.
            let cols: Vec<&str> = trimmed.split("  ").filter(|s| !s.trim().is_empty()).collect();
            if cols.is_empty() {
                continue;
            }
            let name = cols[0].trim().to_string();
            let type_tok = cols.get(1).map(|s| s.trim()).unwrap_or("");
            let comment = cols.get(2).map(|s| s.trim().to_string());
            let comment_nonempty = comment
                .as_ref()
                .filter(|c| !c.is_empty() && !c.eq_ignore_ascii_case("used as"))
                .cloned();
            let share_type = match type_tok.to_lowercase().as_str() {
                "disk" => SmbShareType::Disk,
                "print" | "printer" => SmbShareType::Printer,
                "ipc" => SmbShareType::Ipc,
                "device" => SmbShareType::Device,
                "special" => SmbShareType::Special,
                _ => SmbShareType::Unknown,
            };
            let is_admin = name.ends_with('$');
            shares.push(SmbShareInfo {
                name,
                share_type,
                comment: comment_nonempty,
                is_admin,
            });
        }
        shares
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn parses_net_view_sample() {
            let sample = "\
Shared resources at \\\\server

Share name  Type   Used as  Comment
-----------------------------------
C$          Disk            Default share
IPC$        IPC             Remote IPC
Users       Disk
Printer     Print           HP LaserJet
The command completed successfully.
";
            let shares = parse_net_view_output(sample);
            assert_eq!(shares.len(), 4);
            assert_eq!(shares[0].name, "C$");
            assert!(shares[0].is_admin);
            assert_eq!(shares[0].share_type, SmbShareType::Disk);
            assert_eq!(shares[1].name, "IPC$");
            assert_eq!(shares[1].share_type, SmbShareType::Ipc);
            assert_eq!(shares[2].name, "Users");
            assert!(!shares[2].is_admin);
            assert_eq!(shares[3].share_type, SmbShareType::Printer);
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
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Unix implementation — `smbclient` subprocess
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(not(windows))]
mod unix_impl {
    use super::*;
    use std::process::Stdio;
    use std::time::Instant;
    use tokio::process::Command;

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

        fn user_full(session: &SmbSession) -> Option<String> {
            let user = session.config.username.as_deref()?;
            match session.config.domain.as_deref() {
                Some(d) if !d.is_empty() => Some(format!("{}\\{}", d, user)),
                _ => Some(user.to_string()),
            }
        }

        fn base_auth_args(session: &SmbSession) -> Vec<String> {
            let mut args = Vec::new();
            if let Some(user) = Self::user_full(session) {
                args.push("-U".into());
                // Pass password via %... form; still visible in argv
                // process listing but this is the accepted smbclient idiom.
                if let Some(pw) = &session.config.password {
                    args.push(format!("{}%{}", user, pw));
                } else {
                    args.push(user);
                }
            } else {
                args.push("-N".into()); // no password
            }
            if let Some(wg) = &session.config.workgroup {
                if !wg.is_empty() {
                    args.push("-W".into());
                    args.push(wg.clone());
                }
            }
            if session.config.port != 445 {
                args.push("-p".into());
                args.push(session.config.port.to_string());
            }
            if session.config.use_kerberos {
                args.push("-k".into());
            }
            if session.config.disable_plaintext {
                args.push("-s".into());
                args.push("/dev/null".into()); // minimal config; forces defaults
            }
            args
        }

        async fn run_smbclient_cmd(
            session: &SmbSession,
            share: &str,
            commands: &str,
        ) -> SmbResult<String> {
            let target = format!("//{}/{}", session.config.host, share);
            let mut args = Self::base_auth_args(session);
            args.push(target);
            args.push("-c".into());
            args.push(commands.to_string());
            let out = Command::new("smbclient")
                .args(&args)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output()
                .await
                .map_err(|e| SmbError::Backend(format!("smbclient spawn: {e}")))?;
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            if !out.status.success() {
                if stderr.contains("NT_STATUS_LOGON_FAILURE")
                    || stdout.contains("NT_STATUS_LOGON_FAILURE")
                {
                    return Err(SmbError::AuthFailed(
                        "NT_STATUS_LOGON_FAILURE (bad username / password)".into(),
                    ));
                }
                if stderr.contains("NT_STATUS_OBJECT_NAME_NOT_FOUND")
                    || stdout.contains("NT_STATUS_OBJECT_NAME_NOT_FOUND")
                {
                    return Err(SmbError::InvalidPath(
                        "NT_STATUS_OBJECT_NAME_NOT_FOUND".into(),
                    ));
                }
                return Err(SmbError::Backend(format!(
                    "smbclient failed ({}): {}",
                    out.status, stderr
                )));
            }
            Ok(stdout)
        }
    }

    #[async_trait]
    impl OpsBackend for UnixBackend {
        async fn probe(&self, session: &SmbSession) -> SmbResult<()> {
            // "ls" on the share root; fails fast on bad auth.
            let share = session.config.share.as_deref().unwrap_or("IPC$");
            Self::run_smbclient_cmd(session, share, "ls").await.map(|_| ())
        }

        async fn list_shares(&self, session: &SmbSession) -> SmbResult<Vec<SmbShareInfo>> {
            let mut args = Self::base_auth_args(session);
            args.push("-L".into());
            args.push(format!("//{}", session.config.host));
            let out = Command::new("smbclient")
                .args(&args)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .output()
                .await
                .map_err(|e| SmbError::Backend(format!("smbclient -L spawn: {e}")))?;
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            if !out.status.success() && stdout.is_empty() {
                return Err(SmbError::Backend(format!(
                    "smbclient -L failed: {stderr}"
                )));
            }
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
                format!("cd \"{}\"; ls", smb_path)
            };
            let out = Self::run_smbclient_cmd(session, share, &ls_target).await?;
            Ok(parse_smbclient_ls(&out, path))
        }

        async fn stat(&self, session: &SmbSession, share: &str, path: &str) -> SmbResult<SmbStat> {
            // smbclient doesn't expose a direct `stat`; use `allinfo`.
            let smb_path = Self::smb_path(path);
            let cmd = format!("allinfo \"{}\"", smb_path);
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
            let temp = tempfile_path();
            let smb_path = Self::smb_path(path);
            let cmd = format!("get \"{}\" \"{}\"", smb_path, temp);
            let _ = Self::run_smbclient_cmd(session, share, &cmd).await?;
            let bytes = tokio::fs::read(&temp)
                .await
                .map_err(|e| SmbError::Backend(format!("read temp {temp}: {e}")))?;
            let _ = tokio::fs::remove_file(&temp).await;
            if let Some(max) = max_bytes {
                if bytes.len() as u64 > max {
                    return Err(SmbError::Other(format!(
                        "file size {} exceeds max_bytes {max}; use smb_download_file",
                        bytes.len()
                    )));
                }
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
            let bytes = base64_decode(content_b64)
                .map_err(|e| SmbError::Other(format!("base64 decode: {e}")))?;
            let temp = tempfile_path();
            tokio::fs::write(&temp, &bytes)
                .await
                .map_err(|e| SmbError::Backend(format!("write temp {temp}: {e}")))?;
            let smb_path = Self::smb_path(path);
            // If overwrite=false, check existence first.
            if !overwrite {
                let check = format!("allinfo \"{}\"", smb_path);
                if Self::run_smbclient_cmd(session, share, &check).await.is_ok() {
                    let _ = tokio::fs::remove_file(&temp).await;
                    return Err(SmbError::Other(format!("{} already exists", path)));
                }
            }
            let cmd = format!("put \"{}\" \"{}\"", temp, smb_path);
            let _ = Self::run_smbclient_cmd(session, share, &cmd).await?;
            let _ = tokio::fs::remove_file(&temp).await;
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
            let smb_path = Self::smb_path(remote_path);
            let cmd = format!("get \"{}\" \"{}\"", smb_path, local_path);
            let _ = Self::run_smbclient_cmd(session, share, &cmd).await?;
            let md = tokio::fs::metadata(local_path).await.ok();
            Ok(SmbTransferResult {
                remote_path: remote_path.to_string(),
                local_path: local_path.to_string(),
                bytes_transferred: md.map(|m| m.len()).unwrap_or(0),
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
            let cmd = format!("put \"{}\" \"{}\"", local_path, smb_path);
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
            let cmd = format!("mkdir \"{}\"", smb_path);
            Self::run_smbclient_cmd(session, share, &cmd).await.map(|_| ())
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
                let cmd = format!("deltree \"{}\"", smb_path);
                match Self::run_smbclient_cmd(session, share, &cmd).await {
                    Ok(_) => Ok(()),
                    Err(_) => {
                        // Fallback: enumerate + delete.
                        self.rmdir_manual_recursive(session, share, path).await
                    }
                }
            } else {
                let cmd = format!("rmdir \"{}\"", smb_path);
                Self::run_smbclient_cmd(session, share, &cmd).await.map(|_| ())
            }
        }

        async fn delete_file(
            &self,
            session: &SmbSession,
            share: &str,
            path: &str,
        ) -> SmbResult<()> {
            let smb_path = Self::smb_path(path);
            let cmd = format!("del \"{}\"", smb_path);
            Self::run_smbclient_cmd(session, share, &cmd).await.map(|_| ())
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
            let cmd = format!("rename \"{}\" \"{}\"", from_p, to_p);
            Self::run_smbclient_cmd(session, share, &cmd).await.map(|_| ())
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
                        Box::pin(self.rmdir_manual_recursive(session, share, &entry.path))
                            .await?;
                    }
                    _ => {
                        self.delete_file(session, share, &entry.path).await?;
                    }
                }
            }
            let smb_path = Self::smb_path(path);
            let cmd = format!("rmdir \"{}\"", smb_path);
            Self::run_smbclient_cmd(session, share, &cmd).await.map(|_| ())
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
        let re = match regex::Regex::new(
            r"^\s{2}(.+?)\s{2,}([DHSRNA]*)\s+(\d+)\s+(.+)$",
        ) {
            Ok(r) => r,
            Err(_) => return out,
        };
        for line in stdout.lines() {
            let Some(caps) = re.captures(line) else {
                continue;
            };
            let name = caps.get(1).map(|m| m.as_str().trim().to_string()).unwrap_or_default();
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

    fn tempfile_path() -> String {
        let id = uuid::Uuid::new_v4();
        let tmp = std::env::temp_dir();
        tmp.join(format!("sorng-smb-{id}")).to_string_lossy().into_owned()
    }

    // ─── Tiny base64 helpers (no extra dep) ─────────────────────────────────
    fn base64_encode(input: &[u8]) -> String {
        const ALPHA: &[u8] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
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
        const ALPHA: &[u8] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut lut = [0u8; 256];
        for (i, b) in ALPHA.iter().enumerate() {
            lut[*b as usize] = i as u8;
        }
        let clean: Vec<u8> = input.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
        let trimmed: Vec<u8> = clean.iter().copied().take_while(|b| *b != b'=').collect();
        let mut out = Vec::with_capacity(trimmed.len() * 3 / 4);
        let mut buf: u32 = 0;
        let mut bits = 0u32;
        for b in trimmed {
            if !ALPHA.contains(&b) {
                return Err(format!("invalid base64 char: {b}"));
            }
            buf = (buf << 6) | lut[b as usize] as u32;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                out.push((buf >> bits) as u8 & 0xff);
            }
        }
        Ok(out)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

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
        fn b64_roundtrip() {
            let data = b"hello smb";
            assert_eq!(base64_decode(&base64_encode(data)).unwrap(), data);
        }
    }
}
