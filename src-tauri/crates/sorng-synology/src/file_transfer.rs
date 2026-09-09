//! Native-selected streaming transfers. No local path is accepted over IPC and
//! no file body crosses into renderer memory. A revoked session stops chunks.
use crate::{
    client::SynoClient,
    error::{SynologyError, SynologyResult},
    scoped_files::{validate_name, validate_remote_path, FileTransferOutcome},
    types::SynoResponse,
};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub struct FileTransferContext {
    pub(crate) client: SynoClient,
    pub(crate) active: Arc<AtomicBool>,
}
fn io_error(_: std::io::Error) -> SynologyError {
    SynologyError::connection(
        "Unable to access the selected local file; check its permissions and available disk space",
    )
}
impl FileTransferContext {
    fn assert_active(&self) -> SynologyResult<()> {
        if self.active.load(Ordering::Acquire) {
            Ok(())
        } else {
            Err(SynologyError::session_expired("File transfer stopped because its File Station session changed; refresh to inspect any partial NAS upload"))
        }
    }
    pub async fn upload_selected(
        &self,
        local_path: &Path,
        folder: &str,
        overwrite: Option<bool>,
    ) -> SynologyResult<FileTransferOutcome> {
        self.assert_active()?;
        validate_remote_path(folder)?;
        let name = local_path
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| SynologyError::parse("Choose a file with a supported name"))?
            .to_string();
        validate_name(&name)?;
        let file = tokio::fs::File::open(local_path).await.map_err(io_error)?;
        let metadata = file.metadata().await.map_err(io_error)?;
        if !metadata.is_file() {
            return Err(SynologyError::parse("Select a regular file for upload"));
        }
        let length = metadata.len();
        self.assert_active()?;
        let active = self.active.clone();
        let stream = futures::stream::try_unfold((file, length), move |(mut file, remaining)| {
            let active = active.clone();
            async move {
                if !active.load(Ordering::Acquire) {
                    return Err(std::io::Error::other("File Station session changed"));
                }
                if remaining == 0 {
                    return Ok(None);
                }
                let mut chunk = vec![0u8; remaining.min(64 * 1024) as usize];
                let count = file.read(&mut chunk).await?;
                if count == 0 {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::UnexpectedEof,
                        "Selected file changed during upload",
                    ));
                }
                chunk.truncate(count);
                Ok(Some((chunk, (file, remaining - count as u64))))
            }
        });
        let part = reqwest::multipart::Part::stream_with_length(
            reqwest::Body::wrap_stream(stream),
            length,
        )
        .file_name(name.clone());
        let version = self
            .client
            .best_version("SYNO.FileStation.Upload", 2)
            .unwrap_or(2);
        let url = self
            .client
            .resolve_url("SYNO.FileStation.Upload", version, "upload")?;
        let mut form = reqwest::multipart::Form::new()
            .text("api", "SYNO.FileStation.Upload")
            .text("method", "upload")
            .text("version", version.to_string())
            .text("path", folder.to_string())
            .text("create_parents", "false");
        if let Some(overwrite) = overwrite {
            form = form.text("overwrite", overwrite.to_string());
        }
        if let Some(sid) = &self.client.sid {
            form = form.text("_sid", sid.clone());
        }
        if let Some(token) = &self.client.syno_token {
            form = form.text("SynoToken", token.clone());
        }
        // Synology requires the binary file to be the LAST multipart field.
        form = form.part("file", part);
        let response = self
            .client
            .http_client()
            .post(url)
            .timeout(Duration::from_secs(24 * 60 * 60))
            .multipart(form)
            .send()
            .await?;
        let result: SynoResponse<serde_json::Value> = SynoClient::read_json(response).await?;
        self.assert_active()?;
        if !result.success {
            return Err(SynologyError::api(
                result.error.map(|e| e.code).unwrap_or(100),
                "NAS rejected the upload; refresh before retrying",
            ));
        }
        Ok(FileTransferOutcome {
            cancelled: false,
            name: Some(name),
            bytes: Some(length),
        })
    }
    pub async fn download_selected(
        &self,
        remote_path: &str,
        local_path: &Path,
    ) -> SynologyResult<FileTransferOutcome> {
        self.assert_active()?;
        validate_remote_path(remote_path)?;
        let name = local_path
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| SynologyError::parse("Choose a valid destination filename"))?
            .to_string();
        // A concurrent writer must never be overwritten. Existing files remain
        // untouched even if the platform save picker offered an overwrite prompt.
        if local_path.try_exists().map_err(io_error)? {
            return Err(SynologyError::parse(
                "Choose a new destination filename; existing local files are not overwritten",
            ));
        }
        let parent = local_path
            .parent()
            .filter(|p| p.is_absolute())
            .ok_or_else(|| SynologyError::parse("Choose an absolute local destination"))?;
        let version = self
            .client
            .best_version("SYNO.FileStation.Download", 2)
            .unwrap_or(2);
        let encoded_path = serde_json::to_string(&vec![remote_path])?;
        let mode = if self
            .client
            .api_info
            .get("SYNO.FileStation.Download")
            .and_then(|i| i.request_format.as_deref())
            == Some("JSON")
        {
            "\"download\""
        } else {
            "download"
        };
        let mut response = self
            .client
            .form_request(
                "SYNO.FileStation.Download",
                version,
                "download",
                &[("path", &encoded_path), ("mode", mode)],
            )?
            .timeout(Duration::from_secs(24 * 60 * 60))
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(SynologyError::connection(format!(
                "NAS download failed (HTTP {})",
                response.status().as_u16()
            )));
        }
        let attachment = response
            .headers()
            .get("content-disposition")
            .and_then(|h| h.to_str().ok())
            .is_some_and(|s| s.to_ascii_lowercase().starts_with("attachment"));
        if !attachment {
            // mode=download promises attachment. Never save an API error/login
            // page as the requested file; valid JSON attachments are ordinary data.
            let result: SynoResponse<serde_json::Value> = SynoClient::read_json(response).await?;
            return Err(SynologyError::api(
                result.error.map(|e| e.code).unwrap_or(100),
                "NAS did not return a downloadable attachment",
            ));
        }
        self.assert_active()?;
        let temporary = tempfile::NamedTempFile::new_in(parent).map_err(io_error)?;
        let mut output = tokio::fs::File::from_std(temporary.reopen().map_err(io_error)?);
        let mut bytes = 0u64;
        while let Some(chunk) = response.chunk().await? {
            self.assert_active()?;
            output.write_all(&chunk).await.map_err(io_error)?;
            bytes = bytes
                .checked_add(chunk.len() as u64)
                .ok_or_else(|| SynologyError::parse("Downloaded file is too large"))?;
        }
        output.flush().await.map_err(io_error)?;
        output.sync_all().await.map_err(io_error)?;
        drop(output);
        self.assert_active()?;
        // Atomic no-clobber publication; failed/cancelled transfers drop only the
        // specifically created temporary file, never the user's existing target.
        temporary.persist_noclobber(local_path).map_err(|_| SynologyError::connection("Could not finish the download; the destination may already exist. Existing files were preserved."))?;
        Ok(FileTransferOutcome {
            cancelled: false,
            name: Some(name),
            bytes: Some(bytes),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::SynologyConfig;
    #[tokio::test]
    async fn cancelled_transfer_never_opens_local_file_or_contacts_nas() {
        let context = FileTransferContext {
            client: SynoClient::new(&SynologyConfig {
                host: "127.0.0.1".into(),
                port: 9,
                username: "synthetic".into(),
                password: String::new(),
                use_https: false,
                insecure: false,
                timeout_secs: 1,
                otp_code: None,
                device_token: None,
                access_token: None,
            })
            .unwrap(),
            active: Arc::new(AtomicBool::new(false)),
        };
        let temporary = tempfile::tempdir().unwrap();
        let target = temporary.path().join("untouched.txt");
        assert!(context
            .download_selected("/share/file", &target)
            .await
            .is_err());
        assert!(context
            .upload_selected(&target, "/share", None)
            .await
            .is_err());
        assert!(!target.exists());
        assert_eq!(std::fs::read_dir(temporary.path()).unwrap().count(), 0);
    }
}
