use serde::{Deserialize, Serialize};
use std::fmt;

/// Categorized error kinds for Kafka operations.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum KafkaErrorKind {
    ConnectionFailed,
    AuthenticationFailed,
    SessionNotFound,
    TopicNotFound,
    GroupNotFound,
    BrokerError,
    AdminError,
    ProducerError,
    ConsumerError,
    AclError,
    SchemaRegistryError,
    ConnectError,
    QuotaError,
    ReassignmentError,
    Timeout,
    SerializationError,
    SaslError,
    SslError,
    InvalidConfig,
    PartitionError,
    OffsetError,
}

/// Unified error type for all Kafka operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KafkaError {
    pub kind: KafkaErrorKind,
    pub message: String,
    pub detail: Option<String>,
}

impl KafkaError {
    pub fn new(kind: KafkaErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            detail: None,
        }
    }

    pub fn with_detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    pub fn connection_failed(msg: impl Into<String>) -> Self {
        Self::new(KafkaErrorKind::ConnectionFailed, msg)
    }

    pub fn authentication_failed(msg: impl Into<String>) -> Self {
        Self::new(KafkaErrorKind::AuthenticationFailed, msg)
    }

    pub fn session_not_found(id: &str) -> Self {
        Self::new(
            KafkaErrorKind::SessionNotFound,
            format!("Session not found: {}", id),
        )
    }

    pub fn topic_not_found(name: &str) -> Self {
        Self::new(
            KafkaErrorKind::TopicNotFound,
            format!("Topic not found: {}", name),
        )
    }

    pub fn group_not_found(id: &str) -> Self {
        Self::new(
            KafkaErrorKind::GroupNotFound,
            format!("Group not found: {}", id),
        )
    }

    pub fn broker_error(msg: impl Into<String>) -> Self {
        Self::new(KafkaErrorKind::BrokerError, msg)
    }

    pub fn admin_error(msg: impl Into<String>) -> Self {
        Self::new(KafkaErrorKind::AdminError, msg)
    }

    pub fn producer_error(msg: impl Into<String>) -> Self {
        Self::new(KafkaErrorKind::ProducerError, msg)
    }

    pub fn consumer_error(msg: impl Into<String>) -> Self {
        Self::new(KafkaErrorKind::ConsumerError, msg)
    }

    pub fn acl_error(msg: impl Into<String>) -> Self {
        Self::new(KafkaErrorKind::AclError, msg)
    }

    pub fn schema_registry_error(msg: impl Into<String>) -> Self {
        Self::new(KafkaErrorKind::SchemaRegistryError, msg)
    }

    pub fn connect_error(msg: impl Into<String>) -> Self {
        Self::new(KafkaErrorKind::ConnectError, msg)
    }

    pub fn quota_error(msg: impl Into<String>) -> Self {
        Self::new(KafkaErrorKind::QuotaError, msg)
    }

    pub fn reassignment_error(msg: impl Into<String>) -> Self {
        Self::new(KafkaErrorKind::ReassignmentError, msg)
    }

    pub fn timeout(msg: impl Into<String>) -> Self {
        Self::new(KafkaErrorKind::Timeout, msg)
    }

    pub fn serialization_error(msg: impl Into<String>) -> Self {
        Self::new(KafkaErrorKind::SerializationError, msg)
    }

    pub fn invalid_config(msg: impl Into<String>) -> Self {
        Self::new(KafkaErrorKind::InvalidConfig, msg)
    }

    pub fn partition_error(msg: impl Into<String>) -> Self {
        Self::new(KafkaErrorKind::PartitionError, msg)
    }

    pub fn offset_error(msg: impl Into<String>) -> Self {
        Self::new(KafkaErrorKind::OffsetError, msg)
    }
}

impl fmt::Display for KafkaError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{:?}] {}", self.kind, self.message)?;
        if let Some(ref detail) = self.detail {
            write!(f, " — {}", detail)?;
        }
        Ok(())
    }
}

impl std::error::Error for KafkaError {}

impl From<rdkafka::error::KafkaError> for KafkaError {
    fn from(e: rdkafka::error::KafkaError) -> Self {
        let kind = match &e {
            rdkafka::error::KafkaError::ClientCreation(_) => KafkaErrorKind::ConnectionFailed,
            rdkafka::error::KafkaError::AdminOp(_) => KafkaErrorKind::AdminError,
            rdkafka::error::KafkaError::MessageProduction(_) => KafkaErrorKind::ProducerError,
            rdkafka::error::KafkaError::MessageConsumption(_) => KafkaErrorKind::ConsumerError,
            _ => KafkaErrorKind::BrokerError,
        };
        Self::new(kind, e.to_string())
    }
}

impl From<serde_json::Error> for KafkaError {
    fn from(e: serde_json::Error) -> Self {
        Self::serialization_error(e.to_string())
    }
}

impl From<reqwest::Error> for KafkaError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            Self::timeout(e.to_string())
        } else if e.is_connect() {
            Self::connection_failed(e.to_string())
        } else {
            Self::new(KafkaErrorKind::ConnectError, e.to_string())
        }
    }
}

impl From<url::ParseError> for KafkaError {
    fn from(e: url::ParseError) -> Self {
        Self::invalid_config(format!("Invalid URL: {}", e))
    }
}

pub type KafkaResult<T> = Result<T, KafkaError>;
