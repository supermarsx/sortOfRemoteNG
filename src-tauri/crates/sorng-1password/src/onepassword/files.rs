use super::api_client::OnePasswordApiClient;
use super::types::*;

/// File attachment operations for 1Password items.
pub struct OnePasswordFiles;

impl OnePasswordFiles {
    /// List all files attached to an item.
    pub async fn list(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
        inline: bool,
    ) -> Result<Vec<FileAttachment>, OnePasswordError> {
        client.list_files(vault_id, item_id, inline).await
    }

    /// Get metadata for a specific file.
    pub async fn get(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
        file_id: &str,
    ) -> Result<FileAttachment, OnePasswordError> {
        client.get_file(vault_id, item_id, file_id, false).await
    }

    /// Get a file with its content inlined (base64).
    pub async fn get_with_content(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
        file_id: &str,
    ) -> Result<FileAttachment, OnePasswordError> {
        client.get_file(vault_id, item_id, file_id, true).await
    }

    /// Download file content as raw bytes.
    pub async fn download(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
        file_id: &str,
    ) -> Result<Vec<u8>, OnePasswordError> {
        client.download_file(vault_id, item_id, file_id).await
    }

    /// Download file and decode base64 content (for inline files).
    pub async fn download_to_string(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
        file_id: &str,
    ) -> Result<String, OnePasswordError> {
        let file = client.get_file(vault_id, item_id, file_id, true).await?;
        if let Some(content) = file.content {
            use base64::Engine as _;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&content)
                .map_err(|e| {
                    OnePasswordError::parse_error(format!(
                        "Failed to decode base64 file content: {}",
                        e
                    ))
                })?;
            String::from_utf8(bytes).map_err(|e| {
                OnePasswordError::parse_error(format!("File content is not valid UTF-8: {}", e))
            })
        } else {
            // Fall back to binary download
            let bytes = client.download_file(vault_id, item_id, file_id).await?;
            String::from_utf8(bytes).map_err(|e| {
                OnePasswordError::parse_error(format!("File content is not valid UTF-8: {}", e))
            })
        }
    }

    /// Get total size of all files attached to an item.
    pub async fn get_total_size(
        client: &OnePasswordApiClient,
        vault_id: &str,
        item_id: &str,
    ) -> Result<i64, OnePasswordError> {
        let files = client.list_files(vault_id, item_id, false).await?;
        Ok(files.iter().filter_map(|f| f.size).sum())
    }
}
