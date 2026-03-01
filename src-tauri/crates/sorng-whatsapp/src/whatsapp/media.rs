//! Media upload, download, and management via WhatsApp Cloud API.
//!
//! Media endpoints let you upload files to WhatsApp servers, retrieve
//! download URLs, and delete previously uploaded media assets.

use crate::whatsapp::api_client::CloudApiClient;
use crate::whatsapp::error::{WhatsAppError, WhatsAppResult};
use crate::whatsapp::types::*;
use log::{debug, info};
use reqwest::multipart;
use serde::{Deserialize, Serialize};

/// Manages media assets through the Cloud API.
pub struct WaMedia {
    client: CloudApiClient,
}

/// Upload result returned after uploading a media file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaMediaUploadResult {
    pub id: String,
}

/// Information about a media asset from the API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaMediaDetails {
    pub id: String,
    pub url: String,
    pub mime_type: String,
    pub sha256: String,
    pub file_size: u64,
    pub messaging_product: String,
}

impl WaMedia {
    pub fn new(client: CloudApiClient) -> Self {
        Self { client }
    }

    /// Upload a media file from raw bytes.
    ///
    /// `mime_type` must be a supported WhatsApp MIME type. Optionally
    /// include a `filename` (required for documents).
    pub async fn upload(
        &self,
        data: Vec<u8>,
        mime_type: &str,
        filename: Option<&str>,
    ) -> WhatsAppResult<WaMediaUploadResult> {
        Self::validate_mime_type(mime_type)?;

        let url = self.client.phone_url("media");

        let file_part = multipart::Part::bytes(data)
            .mime_str(mime_type)
            .map_err(|e| WhatsAppError::internal(format!("Bad MIME type: {}", e)))?;

        let file_part = if let Some(name) = filename {
            file_part.file_name(name.to_string())
        } else {
            file_part.file_name("upload")
        };

        let form = multipart::Form::new()
            .text("messaging_product", "whatsapp")
            .text("type", mime_type.to_string())
            .part("file", file_part);

        let resp = self.client.post_multipart(&url, form).await?;

        let id = resp["id"]
            .as_str()
            .ok_or_else(|| WhatsAppError::internal("No media id in upload response"))?
            .to_string();

        info!("Uploaded media: {}", id);
        Ok(WaMediaUploadResult { id })
    }

    /// Upload a media file from a local file path.
    pub async fn upload_from_file(
        &self,
        file_path: &str,
        mime_type: &str,
    ) -> WhatsAppResult<WaMediaUploadResult> {
        let data = tokio::fs::read(file_path)
            .await
            .map_err(|e| WhatsAppError::internal(format!("Read file error: {}", e)))?;

        let filename = std::path::Path::new(file_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("upload");

        self.upload(data, mime_type, Some(filename)).await
    }

    /// Get the download URL and metadata for a media asset.
    pub async fn get_url(&self, media_id: &str) -> WhatsAppResult<WaMediaDetails> {
        let url = self.client.url(media_id);
        let resp = self.client.get(&url).await?;

        Ok(WaMediaDetails {
            id: resp["id"].as_str().unwrap_or(media_id).to_string(),
            url: resp["url"]
                .as_str()
                .ok_or_else(|| {
                    WhatsAppError::internal("No url in media response")
                })?
                .to_string(),
            mime_type: resp["mime_type"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            sha256: resp["sha256"].as_str().unwrap_or_default().to_string(),
            file_size: resp["file_size"].as_u64().unwrap_or(0),
            messaging_product: resp["messaging_product"]
                .as_str()
                .unwrap_or("whatsapp")
                .to_string(),
        })
    }

    /// Download the raw bytes of a media asset.
    ///
    /// Fetches the download URL first, then streams the binary content.
    pub async fn download(&self, media_id: &str) -> WhatsAppResult<(Vec<u8>, String)> {
        let details = self.get_url(media_id).await?;
        debug!("Downloading media {} from {}", media_id, details.url);

        let bytes = self.client.download_bytes(&details.url).await?;

        info!("Downloaded {} bytes for media {}", bytes.len(), media_id);
        Ok((bytes, details.mime_type))
    }

    /// Download media and save to a local file.
    pub async fn download_to_file(
        &self,
        media_id: &str,
        output_path: &str,
    ) -> WhatsAppResult<String> {
        let (bytes, mime) = self.download(media_id).await?;

        tokio::fs::write(output_path, &bytes)
            .await
            .map_err(|e| WhatsAppError::internal(format!("Write file error: {}", e)))?;

        info!("Saved media {} to {}", media_id, output_path);
        Ok(mime)
    }

    /// Delete a media asset from WhatsApp servers.
    pub async fn delete(&self, media_id: &str) -> WhatsAppResult<()> {
        let url = self.client.url(media_id);
        self.client.delete(&url).await?;
        info!("Deleted media {}", media_id);
        Ok(())
    }

    /// Validate that the MIME type is supported by WhatsApp.
    fn validate_mime_type(mime: &str) -> WhatsAppResult<()> {
        let supported = [
            // Images
            "image/jpeg",
            "image/png",
            "image/webp",
            // Video
            "video/mp4",
            "video/3gpp",
            // Audio
            "audio/aac",
            "audio/mp4",
            "audio/mpeg",
            "audio/amr",
            "audio/ogg",
            "audio/opus",
            // Documents
            "application/pdf",
            "application/vnd.ms-powerpoint",
            "application/msword",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "text/plain",
            // Stickers
            "image/webp",
        ];

        if !supported.contains(&mime) {
            return Err(WhatsAppError::internal(format!(
                "Unsupported MIME type: {}. Supported: {:?}",
                mime,
                supported
            )));
        }
        Ok(())
    }

    /// Build a `WaMediaInfo` from upload result for convenience.
    pub fn media_info_from_upload(result: &WaMediaUploadResult) -> WaMediaInfo {
        WaMediaInfo {
            id: result.id.clone(),
            url: None,
            mime_type: None,
            sha256: None,
            file_size: None,
            messaging_product: Some("whatsapp".to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_mime_supported() {
        assert!(WaMedia::validate_mime_type("image/jpeg").is_ok());
        assert!(WaMedia::validate_mime_type("video/mp4").is_ok());
        assert!(WaMedia::validate_mime_type("application/pdf").is_ok());
    }

    #[test]
    fn test_validate_mime_unsupported() {
        assert!(WaMedia::validate_mime_type("application/zip").is_err());
        assert!(WaMedia::validate_mime_type("video/avi").is_err());
    }

    #[test]
    fn test_media_info_from_upload() {
        let upload = WaMediaUploadResult {
            id: "media_123".to_string(),
        };
        let info = WaMedia::media_info_from_upload(&upload);
        assert_eq!(info.id, "media_123");
        assert_eq!(info.messaging_product.as_deref(), Some("whatsapp"));
    }
}
