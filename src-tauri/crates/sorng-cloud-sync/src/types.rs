use serde::{Deserialize, Serialize};
use serde_json::Value;

// Never derive Debug for credentials or payloads.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub id: String,
    pub provider: String,
    pub google_drive: Option<Value>,
    pub one_drive: Option<Value>,
    pub nextcloud: Option<Value>,
    pub webdav: Option<Value>,
    pub sftp: Option<Value>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransportOptions {
    pub max_bytes: usize,
    #[serde(default)]
    pub upload_limit_kbs: u64,
    #[serde(default)]
    pub download_limit_kbs: u64,
}

impl TransportOptions {
    pub fn validate(&self) -> Result<(), SyncError> {
        if self.max_bytes == 0 || self.max_bytes > 100 * 1024 * 1024 {
            return Err(SyncError::Invalid(
                "Configured sync file size limit must be between 1 byte and 100 MiB.".into(),
            ));
        }
        if self.upload_limit_kbs > 1_000_000 || self.download_limit_kbs > 1_000_000 {
            return Err(SyncError::Invalid("Invalid sync bandwidth limit.".into()));
        }
        Ok(())
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Blob {
    pub data: Option<String>,
    pub revision: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Written {
    pub revision: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum SyncError {
    Invalid(String),
    Transport(String),
    Conflict(String),
    Authentication(String),
    Trust(String),
}

impl std::fmt::Display for SyncError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let message = match self {
            Self::Invalid(m)
            | Self::Transport(m)
            | Self::Conflict(m)
            | Self::Authentication(m)
            | Self::Trust(m) => m,
        };
        f.write_str(message)
    }
}
impl std::error::Error for SyncError {}

#[cfg(test)]
mod tests {
    use super::{SyncError, TransportOptions};

    fn options(max_bytes: usize) -> TransportOptions {
        TransportOptions {
            max_bytes,
            upload_limit_kbs: 0,
            download_limit_kbs: 0,
        }
    }

    fn assert_invalid_configured_size(max_bytes: usize) {
        match options(max_bytes).validate() {
            Err(SyncError::Invalid(message)) => assert_eq!(
                message,
                "Configured sync file size limit must be between 1 byte and 100 MiB."
            ),
            result => panic!("Expected an invalid configured size limit, got {result:?}"),
        }
    }

    #[test]
    fn accepts_one_byte_configured_limit() {
        options(1).validate().unwrap();
    }

    #[test]
    fn accepts_exactly_100_mib_configured_limit() {
        options(104_857_600).validate().unwrap();
    }

    #[test]
    fn rejects_zero_configured_limit() {
        assert_invalid_configured_size(0);
    }

    #[test]
    fn rejects_configured_limit_one_byte_above_100_mib() {
        assert_invalid_configured_size(104_857_601);
    }
}
