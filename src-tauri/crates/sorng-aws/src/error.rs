//! AWS error types mirroring the official AWS SDK error model.
//!
//! Each AWS service returns errors in a consistent format. This module provides
//! a unified error type that can represent errors from any AWS service, following
//! the patterns established by `aws-sdk-*` crates.

use serde::{Deserialize, Serialize};
use std::fmt;

/// Top-level error type for all AWS operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AwsError {
    /// The AWS error code (e.g., "InvalidParameterValue", "AccessDenied").
    pub code: String,
    /// Human-readable error message.
    pub message: String,
    /// The HTTP status code returned by the AWS API.
    pub status_code: u16,
    /// AWS request ID for tracing (returned in response headers).
    pub request_id: Option<String>,
    /// The AWS service that returned the error (e.g., "ec2", "s3").
    pub service: String,
    /// The specific API action that failed.
    pub action: Option<String>,
    /// Whether this error is retryable.
    pub retryable: bool,
}

impl fmt::Display for AwsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "AWS {} error [{}]: {} (HTTP {})",
            self.service, self.code, self.message, self.status_code
        )?;
        if let Some(ref req_id) = self.request_id {
            write!(f, " [RequestId: {}]", req_id)?;
        }
        Ok(())
    }
}

impl std::error::Error for AwsError {}

impl AwsError {
    /// Create a new AWS error.
    pub fn new(service: &str, code: &str, message: &str, status_code: u16) -> Self {
        let retryable = Self::is_retryable_code(code, status_code);
        Self {
            code: code.to_string(),
            message: message.to_string(),
            status_code,
            request_id: None,
            service: service.to_string(),
            action: None,
            retryable,
        }
    }

    /// Create from a generic string error with a service context.
    pub fn from_str(service: &str, msg: &str) -> Self {
        Self {
            code: "InternalError".to_string(),
            message: msg.to_string(),
            status_code: 500,
            request_id: None,
            service: service.to_string(),
            action: None,
            retryable: false,
        }
    }

    /// Build a "session not found" error.
    pub fn session_not_found(session_id: &str) -> Self {
        Self {
            code: "SessionNotFound".to_string(),
            message: format!("AWS session '{}' not found or expired", session_id),
            status_code: 404,
            request_id: None,
            service: "aws".to_string(),
            action: None,
            retryable: false,
        }
    }

    /// Build a "not connected" error.
    pub fn not_connected(session_id: &str) -> Self {
        Self {
            code: "NotConnected".to_string(),
            message: format!("AWS session '{}' is not connected", session_id),
            status_code: 400,
            request_id: None,
            service: "aws".to_string(),
            action: None,
            retryable: false,
        }
    }

    /// Build a credential error.
    pub fn credential_error(message: &str) -> Self {
        Self {
            code: "CredentialError".to_string(),
            message: message.to_string(),
            status_code: 401,
            request_id: None,
            service: "sts".to_string(),
            action: None,
            retryable: false,
        }
    }

    /// Build a validation error.
    pub fn validation(service: &str, message: &str) -> Self {
        Self {
            code: "ValidationError".to_string(),
            message: message.to_string(),
            status_code: 400,
            request_id: None,
            service: service.to_string(),
            action: None,
            retryable: false,
        }
    }

    /// With request ID.
    pub fn with_request_id(mut self, id: String) -> Self {
        self.request_id = Some(id);
        self
    }

    /// With action.
    pub fn with_action(mut self, action: &str) -> Self {
        self.action = Some(action.to_string());
        self
    }

    /// Determine if an error code/status is retryable per AWS SDK retry policy.
    fn is_retryable_code(code: &str, status_code: u16) -> bool {
        // Transient errors are retryable
        if status_code == 429 || status_code == 502 || status_code == 503 || status_code == 504 {
            return true;
        }
        matches!(
            code,
            "Throttling"
                | "ThrottlingException"
                | "ThrottledException"
                | "RequestThrottledException"
                | "TooManyRequestsException"
                | "ProvisionedThroughputExceededException"
                | "TransactionInProgressException"
                | "RequestLimitExceeded"
                | "BandwidthLimitExceeded"
                | "LimitExceededException"
                | "RequestThrottled"
                | "SlowDown"
                | "EC2ThrottledException"
                | "InternalError"
                | "InternalFailure"
                | "ServiceUnavailable"
                | "RequestTimeout"
                | "RequestTimeoutException"
                | "IDPCommunicationError"
        )
    }

    /// Parse an AWS XML error response.
    ///
    /// AWS XML error format:
    /// ```xml
    /// <ErrorResponse>
    ///   <Error>
    ///     <Code>InvalidParameterValue</Code>
    ///     <Message>The filter ...</Message>
    ///   </Error>
    ///   <RequestId>abc-123</RequestId>
    /// </ErrorResponse>
    /// ```
    pub fn parse_xml_error(service: &str, status_code: u16, body: &str) -> Self {
        // Try to extract <Code> and <Message> from XML error
        let code = Self::extract_xml_tag(body, "Code").unwrap_or_else(|| "UnknownError".to_string());
        let message = Self::extract_xml_tag(body, "Message")
            .unwrap_or_else(|| format!("HTTP {} from {}", status_code, service));
        let request_id = Self::extract_xml_tag(body, "RequestId")
            .or_else(|| Self::extract_xml_tag(body, "RequestID"));

        let mut err = Self::new(service, &code, &message, status_code);
        if let Some(id) = request_id {
            err.request_id = Some(id);
        }
        err
    }

    /// Parse an AWS JSON error response.
    ///
    /// AWS JSON error format:
    /// ```json
    /// {
    ///   "__type": "ResourceNotFoundException",
    ///   "message": "Function not found: ..."
    /// }
    /// ```
    pub fn parse_json_error(service: &str, status_code: u16, body: &str) -> Self {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(body) {
            let code = val
                .get("__type")
                .or_else(|| val.get("code"))
                .or_else(|| val.get("Code"))
                .and_then(|v| v.as_str())
                .map(|s| {
                    // __type can be "com.amazonaws.lambda#ResourceNotFoundException"
                    s.rsplit('#').next().unwrap_or(s).to_string()
                })
                .unwrap_or_else(|| "UnknownError".to_string());
            let message = val
                .get("message")
                .or_else(|| val.get("Message"))
                .or_else(|| val.get("errorMessage"))
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error")
                .to_string();
            Self::new(service, &code, &message, status_code)
        } else {
            Self::new(
                service,
                "ParseError",
                &format!("Failed to parse error response: {}", &body[..body.len().min(200)]),
                status_code,
            )
        }
    }

    /// Simple XML tag extractor (avoids full XML parse for error handling).
    fn extract_xml_tag(xml: &str, tag: &str) -> Option<String> {
        let open = format!("<{}>", tag);
        let close = format!("</{}>", tag);
        if let Some(start) = xml.find(&open) {
            let content_start = start + open.len();
            if let Some(end) = xml[content_start..].find(&close) {
                return Some(xml[content_start..content_start + end].to_string());
            }
        }
        None
    }
}

/// Convert AwsError to a Tauri-compatible String error.
impl From<AwsError> for String {
    fn from(err: AwsError) -> String {
        err.to_string()
    }
}

impl From<reqwest::Error> for AwsError {
    fn from(err: reqwest::Error) -> Self {
        Self {
            code: "HttpError".to_string(),
            message: err.to_string(),
            status_code: err.status().map(|s| s.as_u16()).unwrap_or(0),
            request_id: None,
            service: "http".to_string(),
            action: None,
            retryable: err.is_timeout() || err.is_connect(),
        }
    }
}

/// Convenience result type for AWS operations.
pub type AwsResult<T> = Result<T, AwsError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_display() {
        let err = AwsError::new("ec2", "InvalidInstanceID.NotFound", "Instance not found", 400);
        let s = err.to_string();
        assert!(s.contains("ec2"));
        assert!(s.contains("InvalidInstanceID.NotFound"));
        assert!(s.contains("400"));
    }

    #[test]
    fn error_display_with_request_id() {
        let err = AwsError::new("s3", "NoSuchBucket", "Bucket not found", 404)
            .with_request_id("req-abc-123".into());
        assert!(err.to_string().contains("req-abc-123"));
    }

    #[test]
    fn parse_xml_error_basic() {
        let xml = r#"<ErrorResponse><Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error><RequestId>xyz-789</RequestId></ErrorResponse>"#;
        let err = AwsError::parse_xml_error("s3", 403, xml);
        assert_eq!(err.code, "AccessDenied");
        assert_eq!(err.message, "Access Denied");
        assert_eq!(err.request_id.as_deref(), Some("xyz-789"));
    }

    #[test]
    fn parse_json_error_lambda_style() {
        let json = r#"{"__type":"com.amazonaws.lambda#ResourceNotFoundException","message":"Function not found: arn:aws:lambda:us-east-1:123:function:missing"}"#;
        let err = AwsError::parse_json_error("lambda", 404, json);
        assert_eq!(err.code, "ResourceNotFoundException");
        assert!(err.message.contains("Function not found"));
    }

    #[test]
    fn retryable_throttling() {
        let err = AwsError::new("ec2", "Throttling", "Rate exceeded", 400);
        assert!(err.retryable);
    }

    #[test]
    fn retryable_503() {
        let err = AwsError::new("s3", "ServiceUnavailable", "Slow down", 503);
        assert!(err.retryable);
    }

    #[test]
    fn not_retryable_auth() {
        let err = AwsError::new("iam", "AccessDenied", "Not authorized", 403);
        assert!(!err.retryable);
    }

    #[test]
    fn session_not_found() {
        let err = AwsError::session_not_found("sess-123");
        assert_eq!(err.code, "SessionNotFound");
        assert!(err.message.contains("sess-123"));
    }

    #[test]
    fn from_string_conversion() {
        let err = AwsError::new("ec2", "TestError", "test msg", 400);
        let s: String = err.into();
        assert!(s.contains("TestError"));
    }

    #[test]
    fn serde_roundtrip() {
        let err = AwsError::new("s3", "NoSuchKey", "Key not found", 404)
            .with_request_id("r-123".into())
            .with_action("GetObject");
        let json = serde_json::to_string(&err).unwrap();
        let back: AwsError = serde_json::from_str(&json).unwrap();
        assert_eq!(back.code, "NoSuchKey");
        assert_eq!(back.action.as_deref(), Some("GetObject"));
        assert_eq!(back.request_id.as_deref(), Some("r-123"));
    }
}
