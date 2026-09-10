//! Explicit, bounded file viewing. Previews stay in memory; external viewers
//! receive only a validated local copy, never a NAS URL, SID or credential.
use crate::{
    error::{SynologyError, SynologyResult},
    file_transfer::FileTransferContext,
    scoped_files::validate_remote_path,
    types::SynoResponse,
};
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

const PREVIEW_LIMIT: u64 = 16 * 1024 * 1024;
const EXTERNAL_LIMIT: u64 = 32 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileViewerKind {
    Text,
    Pdf,
    Image,
}

/// Native-only payload. Never serialized into the privileged app renderer.
pub struct PreparedFile {
    pub name: String,
    pub kind: FileViewerKind,
    pub mime_type: &'static str,
    pub bytes: Vec<u8>,
}

#[derive(Serialize)]
pub struct ExternalFileResult {
    pub cancelled: bool,
    pub message: &'static str,
}

/// The application path is selected by a native dialog, not supplied by the
/// renderer or derived from NAS filenames. No command templates are accepted.
pub enum ExternalApplication {
    Default,
    Selected(PathBuf),
}

fn invalid(message: &'static str) -> SynologyError {
    SynologyError::parse(message)
}

fn format_for(kind: FileViewerKind, bytes: &[u8]) -> SynologyResult<(&'static str, &'static str)> {
    match kind {
        FileViewerKind::Text => {
            let text = std::str::from_utf8(bytes).map_err(|_| invalid("This file is not UTF-8 text. Download it to use another encoding."))?;
            if text.chars().any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t' | '\u{c}')) {
                return Err(invalid("This file contains binary control characters and cannot be viewed as text."));
            }
            // Even source code and HTML are given a harmless text association.
            Ok(("text/plain", "txt"))
        }
        FileViewerKind::Pdf if bytes.starts_with(b"%PDF-") => Ok(("application/pdf", "pdf")),
        FileViewerKind::Image if bytes.starts_with(b"\x89PNG\r\n\x1a\n") => Ok(("image/png", "png")),
        FileViewerKind::Image if bytes.starts_with(&[0xff, 0xd8, 0xff]) => Ok(("image/jpeg", "jpg")),
        FileViewerKind::Image if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") => Ok(("image/gif", "gif")),
        FileViewerKind::Image if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" => Ok(("image/webp", "webp")),
        _ => Err(invalid("The file content does not match the selected viewer. Supported previews are UTF-8 text, PDF, PNG, JPEG, GIF and WebP; active HTML and SVG are never rendered.")),
    }
}

impl FileTransferContext {
    async fn viewer_bytes(
        &self,
        remote_path: &str,
        limit: u64,
        hard_limit: u64,
    ) -> SynologyResult<Vec<u8>> {
        self.assert_active()?;
        validate_remote_path(remote_path)?;
        if limit == 0 || limit > hard_limit {
            return Err(invalid(
                "The requested viewer size limit is outside the supported range.",
            ));
        }
        let api = "SYNO.FileStation.Download";
        let version = self.client.best_version(api, 2).unwrap_or(2);
        let path = serde_json::to_string(&[remote_path])?;
        let mode = if self
            .client
            .api_info
            .get(api)
            .and_then(|i| i.request_format.as_deref())
            == Some("JSON")
        {
            "\"download\""
        } else {
            "download"
        };
        let request = self
            .client
            .form_request(api, version, "download", &[("path", &path), ("mode", mode)])?
            .timeout(Duration::from_secs(30))
            .send();
        let mut response = self.while_active(request).await??;
        if !response.status().is_success() {
            return Err(SynologyError::connection(
                "The NAS did not return the requested file. Nothing was opened.",
            ));
        }
        let attachment = response
            .headers()
            .get("content-disposition")
            .and_then(|h| h.to_str().ok())
            .is_some_and(|h| h.to_ascii_lowercase().starts_with("attachment"));
        let read_limit = if attachment {
            limit
        } else {
            limit.min(64 * 1024)
        };
        if response
            .content_length()
            .is_some_and(|size| size > read_limit)
        {
            return Err(invalid(
                "This file exceeds the configured viewing size limit. Use Download instead.",
            ));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = self.while_active(response.chunk()).await?? {
            if chunk.len() as u64 > read_limit.saturating_sub(bytes.len() as u64) {
                return Err(invalid(
                    "This file exceeds the configured viewing size limit. Use Download instead.",
                ));
            }
            bytes.extend_from_slice(&chunk);
        }
        self.assert_active()?;
        if !attachment {
            let code = serde_json::from_slice::<SynoResponse<serde_json::Value>>(&bytes)
                .ok()
                .and_then(|value| value.error.map(|error| error.code))
                .unwrap_or(100);
            return Err(self.api_error(
                code,
                "The NAS returned an API error instead of a file. Nothing was opened.",
            ));
        }
        Ok(bytes)
    }

    pub async fn prepare_preview_file(
        &self,
        path: &str,
        kind: FileViewerKind,
        max_bytes: u64,
    ) -> SynologyResult<PreparedFile> {
        let bytes = self.viewer_bytes(path, max_bytes, PREVIEW_LIMIT).await?;
        let (mime_type, _) = format_for(kind, &bytes)?;
        self.assert_active()?;
        Ok(PreparedFile {
            name: path
                .rsplit('/')
                .next()
                .unwrap_or("File")
                .chars()
                .take(255)
                .collect(),
            kind,
            mime_type,
            bytes,
        })
    }

    pub async fn open_external_file(
        &self,
        path: &str,
        kind: FileViewerKind,
        max_bytes: u64,
        application: ExternalApplication,
        retention_minutes: u32,
    ) -> SynologyResult<ExternalFileResult> {
        if !(5..=1440).contains(&retention_minutes) {
            return Err(invalid(
                "Choose an external copy lifetime between 5 minutes and 24 hours.",
            ));
        }
        validate_application(&application)?;
        let bytes = self.viewer_bytes(path, max_bytes, EXTERNAL_LIMIT).await?;
        let (_, extension) = format_for(kind, &bytes)?;
        self.assert_active()?;
        let directory = tempfile::Builder::new()
            .prefix("sorng-nas-view-")
            .tempdir()
            .map_err(|_| {
                SynologyError::connection("Could not create a private local viewing folder.")
            })?;
        // Remote filenames never influence the local path or executable suffix.
        let local_path = directory.path().join(format!("view.{extension}"));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&local_path)
            .map_err(|_| SynologyError::connection("Could not create the local viewing copy."))?;
        std::io::Write::write_all(&mut file, &bytes)
            .map_err(|_| SynologyError::connection("Could not write the local viewing copy."))?;
        drop(file);
        self.assert_active()?;
        launch(&local_path, &application)?;
        let active = self.active.clone();
        let cancelled = self.cancelled.clone();
        tokio::spawn(async move {
            let notified = cancelled.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if active.load(std::sync::atomic::Ordering::Acquire) {
                tokio::select! {
                    _ = &mut notified => {},
                    _ = tokio::time::sleep(Duration::from_secs(u64::from(retention_minutes) * 60)) => {},
                }
            }
            // Windows applications can hold the copy open. Retry only this
            // exact generated file; never traverse a user-selected directory.
            for _ in 0..120 {
                match tokio::fs::remove_file(&local_path).await {
                    Ok(()) => break,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
                    Err(_) => tokio::time::sleep(Duration::from_secs(30)).await,
                }
            }
            drop(directory);
        });
        Ok(ExternalFileResult {
            cancelled: false,
            message: "Opened a local viewing copy. Changes are not uploaded to the NAS. Cleanup is attempted when this session ends or the configured lifetime expires; an open application or an app crash may leave a copy in the system temporary folder.",
        })
    }
}

fn validate_application(application: &ExternalApplication) -> SynologyResult<()> {
    let ExternalApplication::Selected(path) = application else {
        return Ok(());
    };
    if !path.is_absolute() || !path.is_file() {
        return Err(invalid("Choose an installed application executable."));
    }
    #[cfg(windows)]
    {
        if !path
            .extension()
            .is_some_and(|v| v.eq_ignore_ascii_case("exe"))
        {
            return Err(invalid(
                "Choose an application executable (.exe), not a shortcut or script.",
            ));
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if path
            .metadata()
            .map_err(|_| invalid("The selected application is unavailable."))?
            .permissions()
            .mode()
            & 0o111
            == 0
        {
            return Err(invalid(
                "The selected file is not an executable application.",
            ));
        }
    }
    // No shell/batch/script launch: accept native executable signatures only.
    use std::io::Read;
    let mut signature = [0u8; 4];
    std::fs::File::open(path)
        .and_then(|mut file| file.read_exact(&mut signature))
        .map_err(|_| invalid("Could not inspect the selected application."))?;
    if !signature.starts_with(b"MZ")
        && signature != *b"\x7fELF"
        && ![
            [0xcf, 0xfa, 0xed, 0xfe],
            [0xce, 0xfa, 0xed, 0xfe],
            [0xfe, 0xed, 0xfa, 0xcf],
            [0xfe, 0xed, 0xfa, 0xce],
            [0xca, 0xfe, 0xba, 0xbe],
            [0xca, 0xfe, 0xba, 0xbf],
        ]
        .contains(&signature)
    {
        return Err(invalid(
            "Choose a native application executable, not a script or shortcut.",
        ));
    }
    Ok(())
}

fn launch(path: &Path, application: &ExternalApplication) -> SynologyResult<()> {
    if let ExternalApplication::Selected(executable) = application {
        let mut command = std::process::Command::new(executable);
        command.arg(path);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW; GUI apps still open normally.
        }
        let child = command.spawn().map_err(|_| {
            SynologyError::connection("The selected application could not be opened.")
        })?;
        // Reap without blocking the NAS session or retaining any local file handle.
        std::thread::spawn(move || {
            let mut child = child;
            let _ = child.wait();
        });
        return Ok(());
    }
    #[cfg(windows)]
    {
        use std::{ffi::OsStr, os::windows::ffi::OsStrExt};
        use windows_sys::{
            w,
            Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
        };
        let encoded: Vec<u16> = OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                w!("open"),
                encoded.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            )
        };
        if result as isize <= 32 {
            return Err(SynologyError::connection("No application could open this file. Try Open with and choose an installed application."));
        }
    }
    #[cfg(not(windows))]
    {
        #[cfg(target_os = "macos")]
        let program = "/usr/bin/open";
        #[cfg(not(target_os = "macos"))]
        let program = "/usr/bin/xdg-open";
        let child = std::process::Command::new(program)
            .arg(path)
            .spawn()
            .map_err(|_| {
                SynologyError::connection("The system file opener is unavailable. Try Open with.")
            })?;
        std::thread::spawn(move || {
            let mut child = child;
            let _ = child.wait();
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn active_formats_never_receive_an_executable_association() {
        assert_eq!(
            format_for(FileViewerKind::Text, b"<script>bad()</script>").unwrap(),
            ("text/plain", "txt")
        );
        assert!(format_for(FileViewerKind::Image, b"<svg onload='bad()'/>").is_err());
        assert!(format_for(FileViewerKind::Text, b"MZ\0\0binary").is_err());
        assert!(format_for(FileViewerKind::Text, &[0xff, 0xfe, 0x61, 0]).is_err());
        assert!(format_for(FileViewerKind::Pdf, b"<html>sign in</html>").is_err());
    }
    #[test]
    fn verifies_supported_content_signatures() {
        for (kind, bytes, mime) in [
            (
                FileViewerKind::Pdf,
                b"%PDF-1.7".as_slice(),
                "application/pdf",
            ),
            (
                FileViewerKind::Image,
                b"\x89PNG\r\n\x1a\n".as_slice(),
                "image/png",
            ),
            (
                FileViewerKind::Image,
                b"\xff\xd8\xff".as_slice(),
                "image/jpeg",
            ),
            (FileViewerKind::Image, b"GIF89a".as_slice(), "image/gif"),
            (
                FileViewerKind::Image,
                b"RIFFabcdWEBP".as_slice(),
                "image/webp",
            ),
        ] {
            assert_eq!(format_for(kind, bytes).unwrap().0, mime);
        }
    }
    #[test]
    fn rejects_script_and_relative_application_targets() {
        assert!(validate_application(&ExternalApplication::Selected("editor.exe".into())).is_err());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fake.exe");
        std::fs::write(&path, b"#!/bin/sh\necho no").unwrap();
        assert!(validate_application(&ExternalApplication::Selected(path)).is_err());
    }
}
