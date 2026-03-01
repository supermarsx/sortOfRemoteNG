//! File download and export operations for Google Drive.

use log::{debug, info};
use tokio::io::AsyncWriteExt;

use crate::client::GDriveClient;
use crate::types::{
    mime_types, DriveFile, DownloadRequest, GDriveError, GDriveErrorKind, GDriveResult,
};

/// Download a binary (blob) file to a local path.
pub async fn download_file(
    client: &GDriveClient,
    file_id: &str,
    destination: &str,
) -> GDriveResult<u64> {
    debug!("Downloading file {} to {}", file_id, destination);
    let url = format!(
        "{}?alt=media&supportsAllDrives=true",
        GDriveClient::api_url(&format!("files/{}", file_id))
    );
    let bytes = client.get_bytes(&url).await?;
    let size = bytes.len() as u64;

    let mut file = tokio::fs::File::create(destination)
        .await
        .map_err(|e| {
            GDriveError::new(
                GDriveErrorKind::DownloadFailed,
                format!("Cannot create file '{}': {}", destination, e),
            )
        })?;

    file.write_all(&bytes).await.map_err(|e| {
        GDriveError::new(
            GDriveErrorKind::DownloadFailed,
            format!("Write error: {e}"),
        )
    })?;

    file.flush().await.map_err(|e| {
        GDriveError::new(
            GDriveErrorKind::DownloadFailed,
            format!("Flush error: {e}"),
        )
    })?;

    info!("Downloaded {} bytes to {}", size, destination);
    Ok(size)
}

/// Download a file's content as raw bytes (in-memory).
pub async fn download_bytes(client: &GDriveClient, file_id: &str) -> GDriveResult<Vec<u8>> {
    let url = format!(
        "{}?alt=media&supportsAllDrives=true",
        GDriveClient::api_url(&format!("files/{}", file_id))
    );
    client.get_bytes(&url).await
}

/// Export a Google Workspace document (Docs, Sheets, Slides, etc.) to a
/// specific format.
pub async fn export_file(
    client: &GDriveClient,
    file_id: &str,
    export_mime_type: &str,
    destination: &str,
) -> GDriveResult<u64> {
    debug!(
        "Exporting file {} as {} to {}",
        file_id, export_mime_type, destination
    );
    let bytes = crate::files::export_file(client, file_id, export_mime_type).await?;
    let size = bytes.len() as u64;

    let mut file = tokio::fs::File::create(destination)
        .await
        .map_err(|e| {
            GDriveError::new(
                GDriveErrorKind::DownloadFailed,
                format!("Cannot create file '{}': {}", destination, e),
            )
        })?;

    file.write_all(&bytes).await.map_err(|e| {
        GDriveError::new(
            GDriveErrorKind::DownloadFailed,
            format!("Write error: {e}"),
        )
    })?;

    file.flush().await.map_err(|e| {
        GDriveError::new(
            GDriveErrorKind::DownloadFailed,
            format!("Flush error: {e}"),
        )
    })?;

    info!("Exported {} bytes to {}", size, destination);
    Ok(size)
}

/// Export a Google Workspace document as raw bytes.
pub async fn export_bytes(
    client: &GDriveClient,
    file_id: &str,
    export_mime_type: &str,
) -> GDriveResult<Vec<u8>> {
    crate::files::export_file(client, file_id, export_mime_type).await
}

/// Process a download request (convenience wrapper).
pub async fn process_download(
    client: &GDriveClient,
    request: &DownloadRequest,
) -> GDriveResult<u64> {
    if let Some(ref export_mime) = request.export_mime_type {
        export_file(client, &request.file_id, export_mime, &request.destination_path).await
    } else {
        download_file(client, &request.file_id, &request.destination_path).await
    }
}

/// Determine if a file is a Google Workspace type that requires export.
pub fn requires_export(file: &DriveFile) -> bool {
    mime_types::is_google_type(&file.mime_type)
}

/// Suggest the best export MIME type for a Google Workspace document.
pub fn suggest_export_mime(google_mime: &str) -> Option<&'static str> {
    match google_mime {
        mime_types::DOCUMENT => Some(crate::types::export_formats::DOCX),
        mime_types::SPREADSHEET => Some(crate::types::export_formats::XLSX),
        mime_types::PRESENTATION => Some(crate::types::export_formats::PPTX),
        mime_types::DRAWING => Some(crate::types::export_formats::PNG),
        mime_types::SCRIPT => Some(crate::types::export_formats::PLAIN_TEXT),
        _ if mime_types::is_google_type(google_mime) => Some(crate::types::export_formats::PDF),
        _ => None,
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
//  Tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::export_formats;

    #[test]
    fn requires_export_google_types() {
        let mut f = DriveFile::default();
        f.mime_type = mime_types::DOCUMENT.into();
        assert!(requires_export(&f));

        f.mime_type = mime_types::SPREADSHEET.into();
        assert!(requires_export(&f));

        f.mime_type = mime_types::FOLDER.into();
        assert!(requires_export(&f));
    }

    #[test]
    fn requires_export_regular_types() {
        let mut f = DriveFile::default();
        f.mime_type = "application/pdf".into();
        assert!(!requires_export(&f));

        f.mime_type = "image/png".into();
        assert!(!requires_export(&f));
    }

    #[test]
    fn suggest_export_mime_document() {
        let m = suggest_export_mime(mime_types::DOCUMENT);
        assert_eq!(m, Some(export_formats::DOCX));
    }

    #[test]
    fn suggest_export_mime_spreadsheet() {
        let m = suggest_export_mime(mime_types::SPREADSHEET);
        assert_eq!(m, Some(export_formats::XLSX));
    }

    #[test]
    fn suggest_export_mime_presentation() {
        let m = suggest_export_mime(mime_types::PRESENTATION);
        assert_eq!(m, Some(export_formats::PPTX));
    }

    #[test]
    fn suggest_export_mime_drawing() {
        let m = suggest_export_mime(mime_types::DRAWING);
        assert_eq!(m, Some(export_formats::PNG));
    }

    #[test]
    fn suggest_export_mime_script() {
        let m = suggest_export_mime(mime_types::SCRIPT);
        assert_eq!(m, Some(export_formats::PLAIN_TEXT));
    }

    #[test]
    fn suggest_export_mime_unknown_google_type() {
        let m = suggest_export_mime(mime_types::FORM);
        assert_eq!(m, Some(export_formats::PDF));
    }

    #[test]
    fn suggest_export_mime_non_google() {
        let m = suggest_export_mime("application/pdf");
        assert_eq!(m, None);
    }

    #[test]
    fn download_url_pattern() {
        let url = format!(
            "{}?alt=media&supportsAllDrives=true",
            GDriveClient::api_url("files/abc123")
        );
        assert!(url.contains("files/abc123"));
        assert!(url.contains("alt=media"));
    }

    #[test]
    fn download_request_serde() {
        let r = DownloadRequest {
            file_id: "id1".into(),
            destination_path: "/tmp/file.pdf".into(),
            export_mime_type: Some("application/pdf".into()),
        };
        let json = serde_json::to_string(&r).unwrap();
        let back: DownloadRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(back.file_id, "id1");
        assert!(back.export_mime_type.is_some());
    }
}
