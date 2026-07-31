use reqwest::Response;
use serde::de::DeserializeOwned;

use crate::error::{LlmError, LlmResult};

const DEFAULT_RESPONSE_BODY_LIMIT: usize = 8 * 1024 * 1024;
const STREAM_FRAME_LIMIT: usize = 512 * 1024;

fn response_too_large(limit: usize) -> LlmError {
    LlmError {
        code: "RESPONSE_TOO_LARGE".to_string(),
        message: format!(
            "Provider response exceeded the configured {} byte safety limit",
            limit
        ),
        provider: None,
        model: None,
        retryable: false,
        status_code: None,
        details: None,
    }
}

fn checked_total(current: usize, incoming: usize, limit: usize) -> LlmResult<usize> {
    let total = current
        .checked_add(incoming)
        .ok_or_else(|| response_too_large(limit))?;
    if total > limit {
        return Err(response_too_large(limit));
    }
    Ok(total)
}

async fn limited_bytes(mut response: Response) -> LlmResult<Vec<u8>> {
    if response
        .content_length()
        .is_some_and(|length| length > DEFAULT_RESPONSE_BODY_LIMIT as u64)
    {
        return Err(response_too_large(DEFAULT_RESPONSE_BODY_LIMIT));
    }

    let initial_capacity = response
        .content_length()
        .and_then(|length| usize::try_from(length).ok())
        .unwrap_or(0)
        .min(DEFAULT_RESPONSE_BODY_LIMIT);
    let mut body = Vec::with_capacity(initial_capacity);

    while let Some(chunk) = response.chunk().await? {
        checked_total(body.len(), chunk.len(), DEFAULT_RESPONSE_BODY_LIMIT)?;
        body.extend_from_slice(&chunk);
    }

    Ok(body)
}

pub(crate) async fn limited_text(response: Response) -> LlmResult<String> {
    String::from_utf8(limited_bytes(response).await?).map_err(|_| LlmError {
        code: "INVALID_RESPONSE_ENCODING".to_string(),
        message: "Provider returned a non-UTF-8 response body".to_string(),
        provider: None,
        model: None,
        retryable: false,
        status_code: None,
        details: None,
    })
}

pub(crate) async fn limited_json<T: DeserializeOwned>(response: Response) -> LlmResult<T> {
    let body = limited_bytes(response).await?;
    serde_json::from_slice(&body).map_err(Into::into)
}

pub(crate) fn append_stream_chunk(buffer: &mut String, chunk: &[u8]) -> LlmResult<()> {
    checked_total(buffer.len(), chunk.len(), STREAM_FRAME_LIMIT).map_err(|_| {
        LlmError::stream_error("Provider stream frame exceeded the 524288 byte safety limit")
    })?;
    buffer.push_str(&String::from_utf8_lossy(chunk));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checked_total_accepts_exact_limit() {
        assert_eq!(checked_total(5, 3, 8).unwrap(), 8);
    }

    #[test]
    fn checked_total_rejects_oversized_and_overflowing_values() {
        assert_eq!(
            checked_total(5, 4, 8).unwrap_err().code,
            "RESPONSE_TOO_LARGE"
        );
        assert_eq!(
            checked_total(usize::MAX, 1, usize::MAX).unwrap_err().code,
            "RESPONSE_TOO_LARGE"
        );
    }

    #[test]
    fn stream_frame_limit_is_enforced_before_appending() {
        let mut buffer = "x".repeat(STREAM_FRAME_LIMIT);
        let error = append_stream_chunk(&mut buffer, b"x").unwrap_err();
        assert_eq!(error.code, "STREAM_ERROR");
        assert_eq!(buffer.len(), STREAM_FRAME_LIMIT);
    }
}
