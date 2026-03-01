//! Google Cloud Storage client.
//!
//! Covers buckets, objects, ACLs, lifecycle policies and signed URLs.
//!
//! API base: `https://storage.googleapis.com/storage/v1`

use crate::client::GcpClient;
use crate::error::GcpResult;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const SERVICE: &str = "storage";
const V1: &str = "/storage/v1";

// ── Types ───────────────────────────────────────────────────────────────

/// Cloud Storage bucket.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bucket {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub location: String,
    #[serde(default, rename = "storageClass")]
    pub storage_class: String,
    #[serde(default, rename = "timeCreated")]
    pub time_created: String,
    #[serde(default)]
    pub updated: String,
    #[serde(default)]
    pub labels: HashMap<String, String>,
    #[serde(default)]
    pub versioning: Option<Versioning>,
    #[serde(default)]
    pub lifecycle: Option<Lifecycle>,
    #[serde(default, rename = "locationType")]
    pub location_type: String,
    #[serde(default, rename = "iamConfiguration")]
    pub iam_configuration: Option<IamConfiguration>,
    #[serde(default, rename = "selfLink")]
    pub self_link: String,
    #[serde(default, rename = "projectNumber")]
    pub project_number: Option<String>,
    #[serde(default, rename = "defaultEventBasedHold")]
    pub default_event_based_hold: Option<bool>,
    #[serde(default)]
    pub encryption: Option<BucketEncryption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Versioning {
    #[serde(default)]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lifecycle {
    #[serde(default)]
    pub rule: Vec<LifecycleRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LifecycleRule {
    pub action: LifecycleAction,
    pub condition: LifecycleCondition,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LifecycleAction {
    #[serde(default, rename = "type")]
    pub action_type: String,
    #[serde(default, rename = "storageClass")]
    pub storage_class: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LifecycleCondition {
    #[serde(default)]
    pub age: Option<u32>,
    #[serde(default, rename = "numNewerVersions")]
    pub num_newer_versions: Option<u32>,
    #[serde(default, rename = "isLive")]
    pub is_live: Option<bool>,
    #[serde(default, rename = "matchesStorageClass")]
    pub matches_storage_class: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IamConfiguration {
    #[serde(default, rename = "uniformBucketLevelAccess")]
    pub uniform_bucket_level_access: Option<UniformBucketLevelAccess>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UniformBucketLevelAccess {
    pub enabled: bool,
    #[serde(default, rename = "lockedTime")]
    pub locked_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BucketEncryption {
    #[serde(default, rename = "defaultKmsKeyName")]
    pub default_kms_key_name: Option<String>,
}

/// Cloud Storage object (blob).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Object {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub bucket: String,
    #[serde(default)]
    pub size: String,
    #[serde(default, rename = "contentType")]
    pub content_type: Option<String>,
    #[serde(default, rename = "timeCreated")]
    pub time_created: String,
    #[serde(default)]
    pub updated: String,
    #[serde(default)]
    pub generation: String,
    #[serde(default)]
    pub md5Hash: Option<String>,
    #[serde(default)]
    pub crc32c: Option<String>,
    #[serde(default, rename = "storageClass")]
    pub storage_class: String,
    #[serde(default)]
    pub metadata: HashMap<String, String>,
    #[serde(default, rename = "selfLink")]
    pub self_link: String,
    #[serde(default, rename = "mediaLink")]
    pub media_link: Option<String>,
    #[serde(default, rename = "contentEncoding")]
    pub content_encoding: Option<String>,
    #[serde(default, rename = "contentDisposition")]
    pub content_disposition: Option<String>,
    #[serde(default)]
    pub etag: Option<String>,
}

/// Bucket ACL entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BucketAccessControl {
    #[serde(default)]
    pub entity: String,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub domain: Option<String>,
    #[serde(default, rename = "projectTeam")]
    pub project_team: Option<ProjectTeam>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectTeam {
    #[serde(default, rename = "projectNumber")]
    pub project_number: String,
    #[serde(default)]
    pub team: String,
}

// ── List wrappers ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
struct BucketList {
    #[serde(default)]
    items: Vec<Bucket>,
    #[serde(default, rename = "nextPageToken")]
    next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ObjectList {
    #[serde(default)]
    items: Vec<Object>,
    #[serde(default)]
    prefixes: Vec<String>,
    #[serde(default, rename = "nextPageToken")]
    next_page_token: Option<String>,
}

// ── Storage Client ──────────────────────────────────────────────────────

pub struct StorageClient;

impl StorageClient {
    // ── Buckets ─────────────────────────────────────────────────────

    /// List buckets in a project.
    pub async fn list_buckets(
        client: &mut GcpClient,
        project: &str,
    ) -> GcpResult<Vec<Bucket>> {
        let path = format!("{}/b", V1);
        let query = [("project", project)];
        let resp: BucketList = client.get(SERVICE, &path, &query).await?;
        Ok(resp.items)
    }

    /// Get a bucket by name.
    pub async fn get_bucket(
        client: &mut GcpClient,
        bucket_name: &str,
    ) -> GcpResult<Bucket> {
        let path = format!("{}/b/{}", V1, bucket_name);
        client.get(SERVICE, &path, &[]).await
    }

    /// Create a bucket.
    pub async fn create_bucket(
        client: &mut GcpClient,
        project: &str,
        bucket_name: &str,
        location: &str,
        storage_class: Option<&str>,
    ) -> GcpResult<Bucket> {
        let body = serde_json::json!({
            "name": bucket_name,
            "location": location,
            "storageClass": storage_class.unwrap_or("STANDARD"),
        });
        // project must be query param
        let path = format!("{}/b?project={}", V1, project);
        client.post(SERVICE, &path, &body).await
    }

    /// Delete a bucket (must be empty).
    pub async fn delete_bucket(
        client: &mut GcpClient,
        bucket_name: &str,
    ) -> GcpResult<()> {
        let path = format!("{}/b/{}", V1, bucket_name);
        client.delete(SERVICE, &path).await?;
        Ok(())
    }

    /// Get bucket IAM policy.
    pub async fn get_bucket_iam_policy(
        client: &mut GcpClient,
        bucket_name: &str,
    ) -> GcpResult<serde_json::Value> {
        let path = format!("{}/b/{}/iam", V1, bucket_name);
        client.get(SERVICE, &path, &[]).await
    }

    /// Update bucket labels.
    pub async fn update_bucket_labels(
        client: &mut GcpClient,
        bucket_name: &str,
        labels: HashMap<String, String>,
    ) -> GcpResult<Bucket> {
        let path = format!("{}/b/{}", V1, bucket_name);
        let body = serde_json::json!({ "labels": labels });
        client.patch(SERVICE, &path, &body, &[]).await
    }

    // ── Objects ─────────────────────────────────────────────────────

    /// List objects in a bucket.
    pub async fn list_objects(
        client: &mut GcpClient,
        bucket_name: &str,
        prefix: Option<&str>,
        delimiter: Option<&str>,
        max_results: Option<u32>,
    ) -> GcpResult<(Vec<Object>, Vec<String>)> {
        let path = format!("{}/b/{}/o", V1, bucket_name);
        let mut query: Vec<(&str, &str)> = Vec::new();
        let prefix_str;
        if let Some(p) = prefix {
            prefix_str = p.to_string();
            query.push(("prefix", &prefix_str));
        }
        let delim_str;
        if let Some(d) = delimiter {
            delim_str = d.to_string();
            query.push(("delimiter", &delim_str));
        }
        let max_str;
        if let Some(m) = max_results {
            max_str = m.to_string();
            query.push(("maxResults", &max_str));
        }
        let resp: ObjectList = client.get(SERVICE, &path, &query).await?;
        Ok((resp.items, resp.prefixes))
    }

    /// Get object metadata.
    pub async fn get_object(
        client: &mut GcpClient,
        bucket_name: &str,
        object_name: &str,
    ) -> GcpResult<Object> {
        let encoded = percent_encoding::utf8_percent_encode(
            object_name,
            percent_encoding::NON_ALPHANUMERIC,
        )
        .to_string();
        let path = format!("{}/b/{}/o/{}", V1, bucket_name, encoded);
        client.get(SERVICE, &path, &[]).await
    }

    /// Download object content as text.
    pub async fn download_object_text(
        client: &mut GcpClient,
        bucket_name: &str,
        object_name: &str,
    ) -> GcpResult<String> {
        let encoded = percent_encoding::utf8_percent_encode(
            object_name,
            percent_encoding::NON_ALPHANUMERIC,
        )
        .to_string();
        let path = format!("{}/b/{}/o/{}", V1, bucket_name, encoded);
        let query = [("alt", "media")];
        client.get_text(SERVICE, &path, &query).await
    }

    /// Delete an object.
    pub async fn delete_object(
        client: &mut GcpClient,
        bucket_name: &str,
        object_name: &str,
    ) -> GcpResult<()> {
        let encoded = percent_encoding::utf8_percent_encode(
            object_name,
            percent_encoding::NON_ALPHANUMERIC,
        )
        .to_string();
        let path = format!("{}/b/{}/o/{}", V1, bucket_name, encoded);
        client.delete(SERVICE, &path).await?;
        Ok(())
    }

    /// Copy an object.
    pub async fn copy_object(
        client: &mut GcpClient,
        source_bucket: &str,
        source_object: &str,
        dest_bucket: &str,
        dest_object: &str,
    ) -> GcpResult<Object> {
        let src_encoded = percent_encoding::utf8_percent_encode(
            source_object,
            percent_encoding::NON_ALPHANUMERIC,
        )
        .to_string();
        let dst_encoded = percent_encoding::utf8_percent_encode(
            dest_object,
            percent_encoding::NON_ALPHANUMERIC,
        )
        .to_string();
        let path = format!(
            "{}/b/{}/o/{}/copyTo/b/{}/o/{}",
            V1, source_bucket, src_encoded, dest_bucket, dst_encoded
        );
        client
            .post(SERVICE, &path, &serde_json::Value::Null)
            .await
    }

    /// Update object metadata.
    pub async fn update_object_metadata(
        client: &mut GcpClient,
        bucket_name: &str,
        object_name: &str,
        metadata: HashMap<String, String>,
    ) -> GcpResult<Object> {
        let encoded = percent_encoding::utf8_percent_encode(
            object_name,
            percent_encoding::NON_ALPHANUMERIC,
        )
        .to_string();
        let path = format!("{}/b/{}/o/{}", V1, bucket_name, encoded);
        let body = serde_json::json!({ "metadata": metadata });
        client.patch(SERVICE, &path, &body, &[]).await
    }
}
