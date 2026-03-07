use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OciError {
    ConnectionFailed,
    AuthenticationFailed,
    NotFound,
    InstanceError,
    NetworkError,
    StorageError,
    DatabaseError,
    LoadBalancerError,
    ContainerError,
    FunctionError,
    IamError,
    QuotaExceeded,
    ApiError {
        status: u16,
        message: String,
        opc_request_id: Option<String>,
    },
    ParseError,
    Timeout,
    PermissionDenied,
    InvalidConfig,
    Other,
}

impl fmt::Display for OciError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            OciError::ConnectionFailed => write!(f, "OCI connection failed"),
            OciError::AuthenticationFailed => write!(f, "OCI authentication failed"),
            OciError::NotFound => write!(f, "OCI resource not found"),
            OciError::InstanceError => write!(f, "OCI instance error"),
            OciError::NetworkError => write!(f, "OCI network error"),
            OciError::StorageError => write!(f, "OCI storage error"),
            OciError::DatabaseError => write!(f, "OCI database error"),
            OciError::LoadBalancerError => write!(f, "OCI load balancer error"),
            OciError::ContainerError => write!(f, "OCI container engine error"),
            OciError::FunctionError => write!(f, "OCI function error"),
            OciError::IamError => write!(f, "OCI IAM error"),
            OciError::QuotaExceeded => write!(f, "OCI quota exceeded"),
            OciError::ApiError {
                status,
                message,
                opc_request_id,
            } => {
                write!(f, "OCI API error ({}): {}", status, message)?;
                if let Some(req_id) = opc_request_id {
                    write!(f, " [opc-request-id: {}]", req_id)?;
                }
                Ok(())
            }
            OciError::ParseError => write!(f, "OCI response parse error"),
            OciError::Timeout => write!(f, "OCI request timed out"),
            OciError::PermissionDenied => write!(f, "OCI permission denied"),
            OciError::InvalidConfig => write!(f, "OCI invalid configuration"),
            OciError::Other => write!(f, "OCI unknown error"),
        }
    }
}

impl std::error::Error for OciError {}

impl From<reqwest::Error> for OciError {
    fn from(err: reqwest::Error) -> Self {
        if err.is_timeout() {
            OciError::Timeout
        } else if err.is_connect() {
            OciError::ConnectionFailed
        } else if let Some(status) = err.status() {
            match status.as_u16() {
                401 => OciError::AuthenticationFailed,
                403 => OciError::PermissionDenied,
                404 => OciError::NotFound,
                429 => OciError::QuotaExceeded,
                _ => OciError::ApiError {
                    status: status.as_u16(),
                    message: err.to_string(),
                    opc_request_id: None,
                },
            }
        } else {
            OciError::ConnectionFailed
        }
    }
}

impl From<serde_json::Error> for OciError {
    fn from(_err: serde_json::Error) -> Self {
        OciError::ParseError
    }
}

pub fn err_str<E: fmt::Display>(err: E) -> OciError {
    OciError::ApiError {
        status: 0,
        message: err.to_string(),
        opc_request_id: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_display_connection_failed() {
        let err = OciError::ConnectionFailed;
        assert_eq!(err.to_string(), "OCI connection failed");
    }

    #[test]
    fn test_display_api_error() {
        let err = OciError::ApiError {
            status: 500,
            message: "Internal Server Error".to_string(),
            opc_request_id: Some("abc-123".to_string()),
        };
        assert!(err.to_string().contains("500"));
        assert!(err.to_string().contains("abc-123"));
    }

    #[test]
    fn test_display_api_error_no_request_id() {
        let err = OciError::ApiError {
            status: 400,
            message: "Bad Request".to_string(),
            opc_request_id: None,
        };
        let display = err.to_string();
        assert!(display.contains("400"));
        assert!(!display.contains("opc-request-id"));
    }

    #[test]
    fn test_from_serde_json_error() {
        let json_err = serde_json::from_str::<serde_json::Value>("invalid json").unwrap_err();
        let oci_err: OciError = json_err.into();
        assert!(matches!(oci_err, OciError::ParseError));
    }

    #[test]
    fn test_err_str() {
        let err = err_str("something went wrong");
        match err {
            OciError::ApiError { status, message, .. } => {
                assert_eq!(status, 0);
                assert_eq!(message, "something went wrong");
            }
            _ => panic!("expected ApiError"),
        }
    }
}
