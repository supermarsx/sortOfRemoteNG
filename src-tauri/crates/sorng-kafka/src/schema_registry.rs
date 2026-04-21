use std::collections::HashMap;

use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::error::{KafkaError, KafkaResult};
use crate::types::*;

/// Client for the Confluent Schema Registry HTTP API.
pub struct SchemaRegistryClient {
    client: Client,
    base_url: String,
    auth: Option<(String, String)>,
}

/// Response from registering a schema.
#[derive(Debug, Deserialize)]
struct RegisterSchemaResponse {
    id: i32,
}

/// Response from getting schema by ID.
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct SchemaByIdResponse {
    schema: String,
    #[serde(default)]
    schema_type: Option<String>,
    #[serde(default)]
    references: Option<Vec<SchemaReference>>,
}

/// Response from getting a subject version.
#[derive(Debug, Deserialize)]
struct SubjectVersionResponse {
    subject: String,
    id: i32,
    version: i32,
    schema: String,
    #[serde(default, rename = "schemaType")]
    schema_type: Option<String>,
    #[serde(default)]
    references: Option<Vec<SchemaReference>>,
}

/// Compatibility check response.
#[derive(Debug, Deserialize)]
struct CompatibilityResponse {
    is_compatible: bool,
}

/// Config response.
#[derive(Debug, Deserialize)]
struct ConfigResponse {
    #[serde(rename = "compatibilityLevel")]
    compatibility_level: String,
}

/// Request body for registering a schema.
#[derive(Debug, Serialize)]
struct RegisterSchemaRequest {
    schema: String,
    #[serde(rename = "schemaType", skip_serializing_if = "Option::is_none")]
    schema_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    references: Option<Vec<SchemaReference>>,
}

/// Request body for setting compatibility.
#[derive(Debug, Serialize)]
struct SetCompatibilityRequest {
    compatibility: String,
}

/// Request body for compatibility check.
#[derive(Debug, Serialize)]
struct CheckCompatibilityRequest {
    schema: String,
    #[serde(rename = "schemaType", skip_serializing_if = "Option::is_none")]
    schema_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    references: Option<Vec<SchemaReference>>,
}

impl SchemaRegistryClient {
    /// Create a new Schema Registry client.
    pub fn new(base_url: &str) -> Self {
        let url = base_url.trim_end_matches('/').to_string();
        Self {
            client: Client::new(),
            base_url: url,
            auth: None,
        }
    }

    /// Create a new Schema Registry client with basic authentication.
    pub fn with_auth(base_url: &str, username: &str, password: &str) -> Self {
        let url = base_url.trim_end_matches('/').to_string();
        Self {
            client: Client::new(),
            base_url: url,
            auth: Some((username.to_string(), password.to_string())),
        }
    }

    fn request(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        let url = format!("{}{}", self.base_url, path);
        let mut req = self.client.request(method, &url);
        req = req.header("Content-Type", "application/vnd.schemaregistry.v1+json");
        req = req.header("Accept", "application/vnd.schemaregistry.v1+json");
        if let Some((ref user, ref pass)) = self.auth {
            req = req.basic_auth(user, Some(pass));
        }
        req
    }

    /// List all subjects in the registry.
    pub async fn list_subjects(&self) -> KafkaResult<Vec<String>> {
        let resp = self
            .request(reqwest::Method::GET, "/subjects")
            .send()
            .await
            .map_err(|e| KafkaError::schema_registry_error(format!("Request failed: {}", e)))?;

        if !resp.status().is_success() {
            return Err(KafkaError::schema_registry_error(format!(
                "List subjects failed with status: {}",
                resp.status()
            )));
        }

        resp.json::<Vec<String>>()
            .await
            .map_err(|e| KafkaError::schema_registry_error(format!("Parse error: {}", e)))
    }

    /// Get all versions for a subject.
    pub async fn list_versions(&self, subject: &str) -> KafkaResult<Vec<i32>> {
        let path = format!("/subjects/{}/versions", encode_subject(subject));
        let resp = self
            .request(reqwest::Method::GET, &path)
            .send()
            .await
            .map_err(|e| KafkaError::schema_registry_error(format!("Request failed: {}", e)))?;

        if !resp.status().is_success() {
            return Err(KafkaError::schema_registry_error(format!(
                "List versions failed with status: {}",
                resp.status()
            )));
        }

        resp.json::<Vec<i32>>()
            .await
            .map_err(|e| KafkaError::schema_registry_error(format!("Parse error: {}", e)))
    }

    /// Get schema info for a specific subject version.
    pub async fn get_schema(&self, subject: &str, version: i32) -> KafkaResult<SchemaInfo> {
        let path = format!("/subjects/{}/versions/{}", encode_subject(subject), version);
        let resp = self
            .request(reqwest::Method::GET, &path)
            .send()
            .await
            .map_err(|e| KafkaError::schema_registry_error(format!("Request failed: {}", e)))?;

        if !resp.status().is_success() {
            return Err(KafkaError::schema_registry_error(format!(
                "Get schema failed with status: {}",
                resp.status()
            )));
        }

        let sv: SubjectVersionResponse = resp
            .json()
            .await
            .map_err(|e| KafkaError::schema_registry_error(format!("Parse error: {}", e)))?;

        Ok(SchemaInfo {
            id: sv.id,
            subject: sv.subject,
            version: sv.version,
            schema_type: parse_schema_type(sv.schema_type.as_deref()),
            schema: sv.schema,
            references: sv.references.unwrap_or_default(),
            compatibility: None,
        })
    }

    /// Get the latest schema for a subject.
    pub async fn get_latest_schema(&self, subject: &str) -> KafkaResult<SchemaInfo> {
        let path = format!("/subjects/{}/versions/latest", encode_subject(subject));
        let resp = self
            .request(reqwest::Method::GET, &path)
            .send()
            .await
            .map_err(|e| KafkaError::schema_registry_error(format!("Request failed: {}", e)))?;

        if !resp.status().is_success() {
            return Err(KafkaError::schema_registry_error(format!(
                "Get latest schema failed with status: {}",
                resp.status()
            )));
        }

        let sv: SubjectVersionResponse = resp
            .json()
            .await
            .map_err(|e| KafkaError::schema_registry_error(format!("Parse error: {}", e)))?;

        Ok(SchemaInfo {
            id: sv.id,
            subject: sv.subject,
            version: sv.version,
            schema_type: parse_schema_type(sv.schema_type.as_deref()),
            schema: sv.schema,
            references: sv.references.unwrap_or_default(),
            compatibility: None,
        })
    }

    /// Get a schema by its global ID.
    pub async fn get_schema_by_id(&self, id: i32) -> KafkaResult<String> {
        let path = format!("/schemas/ids/{}", id);
        let resp = self
            .request(reqwest::Method::GET, &path)
            .send()
            .await
            .map_err(|e| KafkaError::schema_registry_error(format!("Request failed: {}", e)))?;

        if !resp.status().is_success() {
            return Err(KafkaError::schema_registry_error(format!(
                "Get schema by ID failed with status: {}",
                resp.status()
            )));
        }

        let body: SchemaByIdResponse = resp
            .json()
            .await
            .map_err(|e| KafkaError::schema_registry_error(format!("Parse error: {}", e)))?;

        Ok(body.schema)
    }

    /// Register a new schema under a subject. Returns the schema ID.
    pub async fn register_schema(
        &self,
        subject: &str,
        schema: &str,
        schema_type: &SchemaType,
        references: Option<Vec<SchemaReference>>,
    ) -> KafkaResult<i32> {
        let path = format!("/subjects/{}/versions", encode_subject(subject));

        let type_str = match schema_type {
            SchemaType::Avro => None, // Avro is default, no need to specify
            SchemaType::Json => Some("JSON".to_string()),
            SchemaType::Protobuf => Some("PROTOBUF".to_string()),
        };

        let body = RegisterSchemaRequest {
            schema: schema.to_string(),
            schema_type: type_str,
            references,
        };

        let resp = self
            .request(reqwest::Method::POST, &path)
            .json(&body)
            .send()
            .await
            .map_err(|e| KafkaError::schema_registry_error(format!("Request failed: {}", e)))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(KafkaError::schema_registry_error(format!(
                "Register schema failed ({}): {}",
                status, text
            )));
        }

        let result: RegisterSchemaResponse = resp
            .json()
            .await
            .map_err(|e| KafkaError::schema_registry_error(format!("Parse error: {}", e)))?;

        log::info!(
            "Registered schema under subject '{}' with ID {}",
            subject,
            result.id
        );
        Ok(result.id)
    }

    /// Delete a subject and all its versions.
    pub async fn delete_subject(&self, subject: &str) -> KafkaResult<Vec<i32>> {
        let path = format!("/subjects/{}", encode_subject(subject));
        let resp = self
            .request(reqwest::Method::DELETE, &path)
            .send()
            .await
            .map_err(|e| KafkaError::schema_registry_error(format!("Request failed: {}", e)))?;

        if !resp.status().is_success() {
            return Err(KafkaError::schema_registry_error(format!(
                "Delete subject failed with status: {}",
                resp.status()
            )));
        }

        resp.json::<Vec<i32>>()
            .await
            .map_err(|e| KafkaError::schema_registry_error(format!("Parse error: {}", e)))
    }

    /// Delete a specific version of a subject.
    pub async fn delete_schema_version(&self, subject: &str, version: i32) -> KafkaResult<i32> {
        let path = format!("/subjects/{}/versions/{}", encode_subject(subject), version);
        let resp = self
            .request(reqwest::Method::DELETE, &path)
            .send()
            .await
            .map_err(|e| KafkaError::schema_registry_error(format!("Request failed: {}", e)))?;

        if !resp.status().is_success() {
            return Err(KafkaError::schema_registry_error(format!(
                "Delete schema version failed with status: {}",
                resp.status()
            )));
        }

        resp.json::<i32>()
            .await
            .map_err(|e| KafkaError::schema_registry_error(format!("Parse error: {}", e)))
    }

    /// Check if a schema is compatible with the latest version of a subject.
    pub async fn check_compatibility(
        &self,
        subject: &str,
        schema: &str,
        schema_type: &SchemaType,
    ) -> KafkaResult<bool> {
        let path = format!(
            "/compatibility/subjects/{}/versions/latest",
            encode_subject(subject)
        );

        let type_str = match schema_type {
            SchemaType::Avro => None,
            SchemaType::Json => Some("JSON".to_string()),
            SchemaType::Protobuf => Some("PROTOBUF".to_string()),
        };

        let body = CheckCompatibilityRequest {
            schema: schema.to_string(),
            schema_type: type_str,
            references: None,
        };

        let resp = self
            .request(reqwest::Method::POST, &path)
            .json(&body)
            .send()
            .await
            .map_err(|e| KafkaError::schema_registry_error(format!("Request failed: {}", e)))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(KafkaError::schema_registry_error(format!(
                "Compatibility check failed ({}): {}",
                status, text
            )));
        }

        let result: CompatibilityResponse = resp
            .json()
            .await
            .map_err(|e| KafkaError::schema_registry_error(format!("Parse error: {}", e)))?;

        Ok(result.is_compatible)
    }

    /// Get the global compatibility configuration.
    pub async fn get_config(&self) -> KafkaResult<CompatibilityLevel> {
        let resp = self
            .request(reqwest::Method::GET, "/config")
            .send()
            .await
            .map_err(|e| KafkaError::schema_registry_error(format!("Request failed: {}", e)))?;

        if !resp.status().is_success() {
            return Err(KafkaError::schema_registry_error(format!(
                "Get config failed with status: {}",
                resp.status()
            )));
        }

        let config: ConfigResponse = resp
            .json()
            .await
            .map_err(|e| KafkaError::schema_registry_error(format!("Parse error: {}", e)))?;

        Ok(parse_compatibility_level(&config.compatibility_level))
    }

    /// Get the compatibility configuration for a specific subject.
    pub async fn get_subject_config(&self, subject: &str) -> KafkaResult<CompatibilityLevel> {
        let path = format!("/config/{}", encode_subject(subject));
        let resp = self
            .request(reqwest::Method::GET, &path)
            .send()
            .await
            .map_err(|e| KafkaError::schema_registry_error(format!("Request failed: {}", e)))?;

        if !resp.status().is_success() {
            return Err(KafkaError::schema_registry_error(format!(
                "Get subject config failed with status: {}",
                resp.status()
            )));
        }

        let config: ConfigResponse = resp
            .json()
            .await
            .map_err(|e| KafkaError::schema_registry_error(format!("Parse error: {}", e)))?;

        Ok(parse_compatibility_level(&config.compatibility_level))
    }

    /// Set the global compatibility configuration.
    pub async fn set_config(&self, level: &CompatibilityLevel) -> KafkaResult<()> {
        let body = SetCompatibilityRequest {
            compatibility: compatibility_to_string(level),
        };

        let resp = self
            .request(reqwest::Method::PUT, "/config")
            .json(&body)
            .send()
            .await
            .map_err(|e| KafkaError::schema_registry_error(format!("Request failed: {}", e)))?;

        if !resp.status().is_success() {
            return Err(KafkaError::schema_registry_error(format!(
                "Set config failed with status: {}",
                resp.status()
            )));
        }

        Ok(())
    }

    /// Set the compatibility configuration for a specific subject.
    pub async fn set_subject_config(
        &self,
        subject: &str,
        level: &CompatibilityLevel,
    ) -> KafkaResult<()> {
        let path = format!("/config/{}", encode_subject(subject));
        let body = SetCompatibilityRequest {
            compatibility: compatibility_to_string(level),
        };

        let resp = self
            .request(reqwest::Method::PUT, &path)
            .json(&body)
            .send()
            .await
            .map_err(|e| KafkaError::schema_registry_error(format!("Request failed: {}", e)))?;

        if !resp.status().is_success() {
            return Err(KafkaError::schema_registry_error(format!(
                "Set subject config failed with status: {}",
                resp.status()
            )));
        }

        Ok(())
    }

    /// Get the Schema Registry mode (READWRITE, READONLY, etc.).
    pub async fn get_mode(&self) -> KafkaResult<String> {
        let resp = self
            .request(reqwest::Method::GET, "/mode")
            .send()
            .await
            .map_err(|e| KafkaError::schema_registry_error(format!("Request failed: {}", e)))?;

        if !resp.status().is_success() {
            return Err(KafkaError::schema_registry_error(format!(
                "Get mode failed with status: {}",
                resp.status()
            )));
        }

        let body: HashMap<String, String> = resp
            .json()
            .await
            .map_err(|e| KafkaError::schema_registry_error(format!("Parse error: {}", e)))?;

        Ok(body
            .get("mode")
            .cloned()
            .unwrap_or_else(|| "UNKNOWN".to_string()))
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn encode_subject(subject: &str) -> String {
    // URL-encode forward slashes in subject names (e.g., strategy subjects)
    subject.replace('/', "%2F")
}

fn parse_schema_type(s: Option<&str>) -> SchemaType {
    match s {
        Some("JSON") => SchemaType::Json,
        Some("PROTOBUF") => SchemaType::Protobuf,
        _ => SchemaType::Avro,
    }
}

fn parse_compatibility_level(s: &str) -> CompatibilityLevel {
    match s.to_uppercase().as_str() {
        "BACKWARD" => CompatibilityLevel::Backward,
        "BACKWARD_TRANSITIVE" => CompatibilityLevel::BackwardTransitive,
        "FORWARD" => CompatibilityLevel::Forward,
        "FORWARD_TRANSITIVE" => CompatibilityLevel::ForwardTransitive,
        "FULL" => CompatibilityLevel::Full,
        "FULL_TRANSITIVE" => CompatibilityLevel::FullTransitive,
        "NONE" => CompatibilityLevel::None,
        _ => CompatibilityLevel::Backward,
    }
}

fn compatibility_to_string(level: &CompatibilityLevel) -> String {
    match level {
        CompatibilityLevel::Backward => "BACKWARD".to_string(),
        CompatibilityLevel::BackwardTransitive => "BACKWARD_TRANSITIVE".to_string(),
        CompatibilityLevel::Forward => "FORWARD".to_string(),
        CompatibilityLevel::ForwardTransitive => "FORWARD_TRANSITIVE".to_string(),
        CompatibilityLevel::Full => "FULL".to_string(),
        CompatibilityLevel::FullTransitive => "FULL_TRANSITIVE".to_string(),
        CompatibilityLevel::None => "NONE".to_string(),
    }
}
