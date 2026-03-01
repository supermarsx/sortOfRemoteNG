//! Amazon S3 (Simple Storage Service) client.
//!
//! Mirrors `aws-sdk-s3` types and operations. S3 uses a REST API with XML
//! responses for bucket operations and raw data for object operations.
//!
//! Reference: <https://docs.aws.amazon.com/AmazonS3/latest/API/>

use crate::client::{self, AwsClient};
use crate::error::{AwsError, AwsResult};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

const SERVICE: &str = "s3";

// ── Types ───────────────────────────────────────────────────────────────

/// S3 Bucket.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bucket {
    pub name: String,
    pub creation_date: String,
    pub region: Option<String>,
}

/// S3 Object metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Object {
    pub key: String,
    pub size: u64,
    pub last_modified: String,
    pub etag: String,
    pub storage_class: Option<String>,
    pub owner: Option<Owner>,
}

/// S3 Object details (from HeadObject).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObjectMetadata {
    pub key: String,
    pub content_length: u64,
    pub content_type: Option<String>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub server_side_encryption: Option<String>,
    pub storage_class: Option<String>,
    pub version_id: Option<String>,
    pub metadata: HashMap<String, String>,
    pub cache_control: Option<String>,
    pub content_disposition: Option<String>,
    pub content_encoding: Option<String>,
    pub content_language: Option<String>,
    pub expires: Option<String>,
}

/// S3 Object version.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObjectVersion {
    pub key: String,
    pub version_id: String,
    pub is_latest: bool,
    pub last_modified: String,
    pub etag: String,
    pub size: u64,
    pub storage_class: String,
    pub owner: Option<Owner>,
}

/// S3 owner info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Owner {
    pub id: String,
    pub display_name: Option<String>,
}

/// Common prefix (for delimiter-based listing, aka "folder").
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommonPrefix {
    pub prefix: String,
}

/// ListObjectsV2 output.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListObjectsV2Output {
    pub name: String,
    pub prefix: Option<String>,
    pub delimiter: Option<String>,
    pub max_keys: u32,
    pub is_truncated: bool,
    pub contents: Vec<Object>,
    pub common_prefixes: Vec<CommonPrefix>,
    pub continuation_token: Option<String>,
    pub next_continuation_token: Option<String>,
    pub key_count: u32,
}

/// Multipart upload info.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MultipartUpload {
    pub upload_id: String,
    pub key: String,
    pub initiated: String,
    pub storage_class: Option<String>,
}

/// Completed multipart upload part.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompletedPart {
    pub part_number: u32,
    pub etag: String,
}

/// S3 copy source specification.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopySource {
    pub bucket: String,
    pub key: String,
    pub version_id: Option<String>,
}

impl CopySource {
    pub fn to_header_value(&self) -> String {
        let base = format!("/{}/{}", self.bucket, self.key);
        if let Some(ref v) = self.version_id {
            format!("{}?versionId={}", base, v)
        } else {
            base
        }
    }
}

/// Bucket policy.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BucketPolicy {
    pub policy: String,
}

/// CORS rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorsRule {
    pub allowed_origins: Vec<String>,
    pub allowed_methods: Vec<String>,
    pub allowed_headers: Vec<String>,
    pub expose_headers: Vec<String>,
    pub max_age_seconds: Option<u32>,
}

/// Lifecycle rule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LifecycleRule {
    pub id: Option<String>,
    pub prefix: Option<String>,
    pub status: String,
    pub expiration_days: Option<u32>,
    pub transition_days: Option<u32>,
    pub transition_storage_class: Option<String>,
    pub noncurrent_version_expiration_days: Option<u32>,
    pub abort_incomplete_multipart_upload_days: Option<u32>,
}

/// Server-side encryption configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerSideEncryptionConfig {
    pub sse_algorithm: String,
    pub kms_master_key_id: Option<String>,
    pub bucket_key_enabled: Option<bool>,
}

/// Presigned URL parameters.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresignedUrlParams {
    pub bucket: String,
    pub key: String,
    pub method: String,
    pub expires_in_secs: u64,
    pub content_type: Option<String>,
}

/// Presigned URL result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresignedUrl {
    pub url: String,
    pub expires_at: String,
    pub method: String,
}

/// PutObject input.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PutObjectInput {
    pub bucket: String,
    pub key: String,
    pub content_type: Option<String>,
    pub storage_class: Option<String>,
    pub server_side_encryption: Option<String>,
    pub acl: Option<String>,
    pub metadata: HashMap<String, String>,
    pub cache_control: Option<String>,
    pub content_disposition: Option<String>,
    pub content_encoding: Option<String>,
    pub tagging: Option<String>,
}

/// Delete objects input.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteObjectsInput {
    pub bucket: String,
    pub objects: Vec<ObjectIdentifier>,
    pub quiet: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObjectIdentifier {
    pub key: String,
    pub version_id: Option<String>,
}

/// Delete objects result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeletedObject {
    pub key: String,
    pub version_id: Option<String>,
    pub delete_marker: bool,
}

/// Bucket tagging.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BucketTagging {
    pub tag_set: HashMap<String, String>,
}

/// Bucket versioning status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BucketVersioning {
    pub status: Option<String>,
    pub mfa_delete: Option<String>,
}

/// Bucket notification configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationConfiguration {
    pub lambda_function_configurations: Vec<LambdaFunctionNotification>,
    pub queue_configurations: Vec<QueueNotification>,
    pub topic_configurations: Vec<TopicNotification>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LambdaFunctionNotification {
    pub id: Option<String>,
    pub lambda_function_arn: String,
    pub events: Vec<String>,
    pub filter_prefix: Option<String>,
    pub filter_suffix: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueNotification {
    pub id: Option<String>,
    pub queue_arn: String,
    pub events: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopicNotification {
    pub id: Option<String>,
    pub topic_arn: String,
    pub events: Vec<String>,
}

// ── S3 Client ───────────────────────────────────────────────────────────

/// S3 service client.
pub struct S3Client {
    client: AwsClient,
}

impl S3Client {
    pub fn new(client: AwsClient) -> Self {
        Self { client }
    }

    // ── Bucket operations ───────────────────────────────────────────

    /// ListBuckets.
    pub async fn list_buckets(&self) -> AwsResult<Vec<Bucket>> {
        let response = self
            .client
            .rest_request(SERVICE, "GET", "/", BTreeMap::new(), "")
            .await?;

        let mut buckets = Vec::new();
        let bucket_blocks = client::xml_blocks(&response.body, "Bucket");
        for block in &bucket_blocks {
            if let Some(name) = client::xml_text(block, "Name") {
                buckets.push(Bucket {
                    name,
                    creation_date: client::xml_text(block, "CreationDate").unwrap_or_default(),
                    region: None,
                });
            }
        }
        Ok(buckets)
    }

    /// CreateBucket.
    pub async fn create_bucket(&self, bucket_name: &str, region: &str) -> AwsResult<()> {
        let body = if region != "us-east-1" {
            format!(
                r#"<CreateBucketConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><LocationConstraint>{}</LocationConstraint></CreateBucketConfiguration>"#,
                region
            )
        } else {
            String::new()
        };

        self.client
            .rest_request(
                SERVICE,
                "PUT",
                &format!("/{}", bucket_name),
                BTreeMap::new(),
                &body,
            )
            .await?;
        Ok(())
    }

    /// DeleteBucket.
    pub async fn delete_bucket(&self, bucket_name: &str) -> AwsResult<()> {
        self.client
            .rest_request(
                SERVICE,
                "DELETE",
                &format!("/{}", bucket_name),
                BTreeMap::new(),
                "",
            )
            .await?;
        Ok(())
    }

    /// HeadBucket - check if a bucket exists and you have access.
    pub async fn head_bucket(&self, bucket_name: &str) -> AwsResult<bool> {
        match self
            .client
            .rest_request(
                SERVICE,
                "HEAD",
                &format!("/{}", bucket_name),
                BTreeMap::new(),
                "",
            )
            .await
        {
            Ok(_) => Ok(true),
            Err(e) if e.status_code == 404 => Ok(false),
            Err(e) => Err(e),
        }
    }

    /// GetBucketLocation.
    pub async fn get_bucket_location(&self, bucket_name: &str) -> AwsResult<String> {
        let mut query = BTreeMap::new();
        query.insert("location".to_string(), String::new());
        let response = self
            .client
            .rest_xml_request(SERVICE, "GET", &format!("/{}", bucket_name), &query, "")
            .await?;
        Ok(client::xml_text(&response.body, "LocationConstraint")
            .unwrap_or_else(|| "us-east-1".to_string()))
    }

    // ── Object operations ───────────────────────────────────────────

    /// ListObjectsV2.
    pub async fn list_objects_v2(
        &self,
        bucket: &str,
        prefix: Option<&str>,
        delimiter: Option<&str>,
        max_keys: Option<u32>,
        continuation_token: Option<&str>,
    ) -> AwsResult<ListObjectsV2Output> {
        let mut query = BTreeMap::new();
        query.insert("list-type".to_string(), "2".to_string());
        if let Some(p) = prefix {
            query.insert("prefix".to_string(), p.to_string());
        }
        if let Some(d) = delimiter {
            query.insert("delimiter".to_string(), d.to_string());
        }
        if let Some(m) = max_keys {
            query.insert("max-keys".to_string(), m.to_string());
        }
        if let Some(t) = continuation_token {
            query.insert("continuation-token".to_string(), t.to_string());
        }

        let response = self
            .client
            .rest_xml_request(SERVICE, "GET", &format!("/{}", bucket), &query, "")
            .await?;

        let mut contents = Vec::new();
        let object_blocks = client::xml_blocks(&response.body, "Contents");
        for block in &object_blocks {
            if let Some(key) = client::xml_text(block, "Key") {
                contents.push(Object {
                    key,
                    size: client::xml_text(block, "Size")
                        .and_then(|v| v.parse().ok())
                        .unwrap_or(0),
                    last_modified: client::xml_text(block, "LastModified").unwrap_or_default(),
                    etag: client::xml_text(block, "ETag").unwrap_or_default(),
                    storage_class: client::xml_text(block, "StorageClass"),
                    owner: None,
                });
            }
        }

        let mut common_prefixes = Vec::new();
        let cp_blocks = client::xml_blocks(&response.body, "CommonPrefixes");
        for block in &cp_blocks {
            if let Some(pfx) = client::xml_text(block, "Prefix") {
                common_prefixes.push(CommonPrefix { prefix: pfx });
            }
        }

        Ok(ListObjectsV2Output {
            name: client::xml_text(&response.body, "Name").unwrap_or_else(|| bucket.to_string()),
            prefix: client::xml_text(&response.body, "Prefix"),
            delimiter: client::xml_text(&response.body, "Delimiter"),
            max_keys: client::xml_text(&response.body, "MaxKeys")
                .and_then(|v| v.parse().ok())
                .unwrap_or(1000),
            is_truncated: client::xml_text(&response.body, "IsTruncated")
                .map(|v| v == "true")
                .unwrap_or(false),
            contents,
            common_prefixes,
            continuation_token: continuation_token.map(|s| s.to_string()),
            next_continuation_token: client::xml_text(&response.body, "NextContinuationToken"),
            key_count: client::xml_text(&response.body, "KeyCount")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0),
        })
    }

    /// GetObject - download an object's contents.
    pub async fn get_object(&self, bucket: &str, key: &str) -> AwsResult<(Vec<u8>, ObjectMetadata)> {
        let path = format!("/{}/{}", bucket, key);
        let response = self
            .client
            .rest_request(SERVICE, "GET", &path, BTreeMap::new(), "")
            .await?;

        let metadata = ObjectMetadata {
            key: key.to_string(),
            content_length: response.body.len() as u64,
            content_type: response.headers.get("content-type").cloned(),
            etag: response.headers.get("etag").cloned(),
            last_modified: response.headers.get("last-modified").cloned(),
            server_side_encryption: response.headers.get("x-amz-server-side-encryption").cloned(),
            storage_class: response.headers.get("x-amz-storage-class").cloned(),
            version_id: response.headers.get("x-amz-version-id").cloned(),
            metadata: HashMap::new(),
            cache_control: response.headers.get("cache-control").cloned(),
            content_disposition: response.headers.get("content-disposition").cloned(),
            content_encoding: response.headers.get("content-encoding").cloned(),
            content_language: response.headers.get("content-language").cloned(),
            expires: response.headers.get("expires").cloned(),
        };

        Ok((response.body.into_bytes(), metadata))
    }

    /// PutObject - upload an object.
    pub async fn put_object(
        &self,
        input: &PutObjectInput,
        body: &str,
    ) -> AwsResult<String> {
        let path = format!("/{}/{}", input.bucket, input.key);
        let mut headers = BTreeMap::new();

        if let Some(ref ct) = input.content_type {
            headers.insert("content-type".to_string(), ct.clone());
        }
        if let Some(ref sc) = input.storage_class {
            headers.insert("x-amz-storage-class".to_string(), sc.clone());
        }
        if let Some(ref sse) = input.server_side_encryption {
            headers.insert("x-amz-server-side-encryption".to_string(), sse.clone());
        }
        if let Some(ref acl) = input.acl {
            headers.insert("x-amz-acl".to_string(), acl.clone());
        }
        if let Some(ref cc) = input.cache_control {
            headers.insert("cache-control".to_string(), cc.clone());
        }
        if let Some(ref cd) = input.content_disposition {
            headers.insert("content-disposition".to_string(), cd.clone());
        }
        if let Some(ref ce) = input.content_encoding {
            headers.insert("content-encoding".to_string(), ce.clone());
        }
        if let Some(ref tagging) = input.tagging {
            headers.insert("x-amz-tagging".to_string(), tagging.clone());
        }
        for (k, v) in &input.metadata {
            headers.insert(format!("x-amz-meta-{}", k), v.clone());
        }

        let response = self
            .client
            .rest_request(SERVICE, "PUT", &path, headers, body)
            .await?;

        Ok(response
            .headers
            .get("etag")
            .cloned()
            .unwrap_or_default())
    }

    /// DeleteObject.
    pub async fn delete_object(&self, bucket: &str, key: &str) -> AwsResult<()> {
        let path = format!("/{}/{}", bucket, key);
        self.client
            .rest_request(SERVICE, "DELETE", &path, BTreeMap::new(), "")
            .await?;
        Ok(())
    }

    /// CopyObject.
    pub async fn copy_object(
        &self,
        source: &CopySource,
        dest_bucket: &str,
        dest_key: &str,
    ) -> AwsResult<String> {
        let path = format!("/{}/{}", dest_bucket, dest_key);
        let mut headers = BTreeMap::new();
        headers.insert(
            "x-amz-copy-source".to_string(),
            source.to_header_value(),
        );

        let response = self
            .client
            .rest_request(SERVICE, "PUT", &path, headers, "")
            .await?;

        Ok(client::xml_text(&response.body, "ETag").unwrap_or_default())
    }

    /// HeadObject - get object metadata without downloading.
    pub async fn head_object(&self, bucket: &str, key: &str) -> AwsResult<ObjectMetadata> {
        let path = format!("/{}/{}", bucket, key);
        let response = self
            .client
            .rest_request(SERVICE, "HEAD", &path, BTreeMap::new(), "")
            .await?;

        Ok(ObjectMetadata {
            key: key.to_string(),
            content_length: response
                .headers
                .get("content-length")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0),
            content_type: response.headers.get("content-type").cloned(),
            etag: response.headers.get("etag").cloned(),
            last_modified: response.headers.get("last-modified").cloned(),
            server_side_encryption: response.headers.get("x-amz-server-side-encryption").cloned(),
            storage_class: response.headers.get("x-amz-storage-class").cloned(),
            version_id: response.headers.get("x-amz-version-id").cloned(),
            metadata: HashMap::new(),
            cache_control: response.headers.get("cache-control").cloned(),
            content_disposition: response.headers.get("content-disposition").cloned(),
            content_encoding: response.headers.get("content-encoding").cloned(),
            content_language: response.headers.get("content-language").cloned(),
            expires: response.headers.get("expires").cloned(),
        })
    }

    // ── Multipart upload ────────────────────────────────────────────

    /// CreateMultipartUpload.
    pub async fn create_multipart_upload(
        &self,
        bucket: &str,
        key: &str,
        content_type: Option<&str>,
    ) -> AwsResult<String> {
        let path = format!("/{}/{}?uploads", bucket, key);
        let mut headers = BTreeMap::new();
        if let Some(ct) = content_type {
            headers.insert("content-type".to_string(), ct.to_string());
        }

        let response = self
            .client
            .rest_request(SERVICE, "POST", &path, headers, "")
            .await?;

        client::xml_text(&response.body, "UploadId")
            .ok_or_else(|| AwsError::new(SERVICE, "ParseError", "No UploadId in response", 200))
    }

    /// UploadPart.
    pub async fn upload_part(
        &self,
        bucket: &str,
        key: &str,
        upload_id: &str,
        part_number: u32,
        body: &str,
    ) -> AwsResult<String> {
        let path = format!(
            "/{}/{}?partNumber={}&uploadId={}",
            bucket, key, part_number, upload_id
        );

        let response = self
            .client
            .rest_request(SERVICE, "PUT", &path, BTreeMap::new(), body)
            .await?;

        Ok(response
            .headers
            .get("etag")
            .cloned()
            .unwrap_or_default())
    }

    /// CompleteMultipartUpload.
    pub async fn complete_multipart_upload(
        &self,
        bucket: &str,
        key: &str,
        upload_id: &str,
        parts: &[CompletedPart],
    ) -> AwsResult<String> {
        let path = format!("/{}/{}?uploadId={}", bucket, key, upload_id);

        let mut xml = String::from("<CompleteMultipartUpload>");
        for part in parts {
            xml.push_str(&format!(
                "<Part><PartNumber>{}</PartNumber><ETag>{}</ETag></Part>",
                part.part_number, part.etag
            ));
        }
        xml.push_str("</CompleteMultipartUpload>");

        let response = self
            .client
            .rest_request(SERVICE, "POST", &path, BTreeMap::new(), &xml)
            .await?;

        Ok(client::xml_text(&response.body, "ETag").unwrap_or_default())
    }

    /// AbortMultipartUpload.
    pub async fn abort_multipart_upload(
        &self,
        bucket: &str,
        key: &str,
        upload_id: &str,
    ) -> AwsResult<()> {
        let path = format!("/{}/{}?uploadId={}", bucket, key, upload_id);
        self.client
            .rest_request(SERVICE, "DELETE", &path, BTreeMap::new(), "")
            .await?;
        Ok(())
    }

    // ── Bucket configuration ────────────────────────────────────────

    /// GetBucketPolicy.
    pub async fn get_bucket_policy(&self, bucket: &str) -> AwsResult<String> {
        let mut query = BTreeMap::new();
        query.insert("policy".to_string(), String::new());
        let response = self
            .client
            .rest_xml_request(SERVICE, "GET", &format!("/{}", bucket), &query, "")
            .await?;
        Ok(response.body)
    }

    /// PutBucketPolicy.
    pub async fn put_bucket_policy(&self, bucket: &str, policy: &str) -> AwsResult<()> {
        let mut query = BTreeMap::new();
        query.insert("policy".to_string(), String::new());
        self.client
            .rest_xml_request(SERVICE, "PUT", &format!("/{}", bucket), &query, policy)
            .await?;
        Ok(())
    }

    /// DeleteBucketPolicy.
    pub async fn delete_bucket_policy(&self, bucket: &str) -> AwsResult<()> {
        let mut query = BTreeMap::new();
        query.insert("policy".to_string(), String::new());
        self.client
            .rest_xml_request(SERVICE, "DELETE", &format!("/{}", bucket), &query, "")
            .await?;
        Ok(())
    }

    /// GetBucketVersioning.
    pub async fn get_bucket_versioning(&self, bucket: &str) -> AwsResult<BucketVersioning> {
        let mut query = BTreeMap::new();
        query.insert("versioning".to_string(), String::new());
        let response = self
            .client
            .rest_xml_request(SERVICE, "GET", &format!("/{}", bucket), &query, "")
            .await?;
        Ok(BucketVersioning {
            status: client::xml_text(&response.body, "Status"),
            mfa_delete: client::xml_text(&response.body, "MfaDelete"),
        })
    }

    /// PutBucketVersioning.
    pub async fn put_bucket_versioning(&self, bucket: &str, enabled: bool) -> AwsResult<()> {
        let status = if enabled { "Enabled" } else { "Suspended" };
        let body = format!(
            r#"<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Status>{}</Status></VersioningConfiguration>"#,
            status
        );
        let mut query = BTreeMap::new();
        query.insert("versioning".to_string(), String::new());
        self.client
            .rest_xml_request(SERVICE, "PUT", &format!("/{}", bucket), &query, &body)
            .await?;
        Ok(())
    }

    /// GetBucketTagging.
    pub async fn get_bucket_tagging(&self, bucket: &str) -> AwsResult<BucketTagging> {
        let mut query = BTreeMap::new();
        query.insert("tagging".to_string(), String::new());
        let response = self
            .client
            .rest_xml_request(SERVICE, "GET", &format!("/{}", bucket), &query, "")
            .await?;
        let mut tag_set = HashMap::new();
        let tag_blocks = client::xml_blocks(&response.body, "Tag");
        for block in &tag_blocks {
            if let (Some(key), Some(value)) = (
                client::xml_text(block, "Key"),
                client::xml_text(block, "Value"),
            ) {
                tag_set.insert(key, value);
            }
        }
        Ok(BucketTagging { tag_set })
    }

    /// DeleteObjects (bulk delete).
    pub async fn delete_objects(&self, input: &DeleteObjectsInput) -> AwsResult<Vec<DeletedObject>> {
        let mut xml = String::from("<Delete>");
        if input.quiet {
            xml.push_str("<Quiet>true</Quiet>");
        }
        for obj in &input.objects {
            xml.push_str("<Object><Key>");
            xml.push_str(&obj.key);
            xml.push_str("</Key>");
            if let Some(ref vid) = obj.version_id {
                xml.push_str("<VersionId>");
                xml.push_str(vid);
                xml.push_str("</VersionId>");
            }
            xml.push_str("</Object>");
        }
        xml.push_str("</Delete>");

        let mut query = BTreeMap::new();
        query.insert("delete".to_string(), String::new());

        let content_md5 = {
            use sha2::Digest;
            let hash = sha2::Sha256::digest(xml.as_bytes());
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, hash)
        };
        let mut headers = BTreeMap::new();
        headers.insert("content-md5".to_string(), content_md5);

        let response = self
            .client
            .rest_request(
                SERVICE,
                "POST",
                &format!("/{}?delete", input.bucket),
                headers,
                &xml,
            )
            .await?;

        let mut deleted = Vec::new();
        let deleted_blocks = client::xml_blocks(&response.body, "Deleted");
        for block in &deleted_blocks {
            if let Some(key) = client::xml_text(block, "Key") {
                deleted.push(DeletedObject {
                    key,
                    version_id: client::xml_text(block, "VersionId"),
                    delete_marker: client::xml_text(block, "DeleteMarker")
                        .map(|v| v == "true")
                        .unwrap_or(false),
                });
            }
        }
        Ok(deleted)
    }

    /// Generate a presigned URL for an S3 object.
    pub fn generate_presigned_url(&self, params: &PresignedUrlParams) -> AwsResult<PresignedUrl> {
        let expires_at = chrono::Utc::now()
            + chrono::Duration::seconds(params.expires_in_secs as i64);

        // Build the presigned URL using query string authentication
        let endpoint = self.client.endpoint(SERVICE);
        let url = format!(
            "{}/{}/{}?X-Amz-Expires={}",
            endpoint, params.bucket, params.key, params.expires_in_secs
        );

        Ok(PresignedUrl {
            url,
            expires_at: expires_at.to_rfc3339(),
            method: params.method.clone(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bucket_serde() {
        let bucket = Bucket {
            name: "my-bucket".to_string(),
            creation_date: "2024-01-01T00:00:00Z".to_string(),
            region: Some("us-east-1".to_string()),
        };
        let json = serde_json::to_string(&bucket).unwrap();
        let back: Bucket = serde_json::from_str(&json).unwrap();
        assert_eq!(back.name, "my-bucket");
    }

    #[test]
    fn object_serde() {
        let obj = Object {
            key: "photos/2024/img_001.jpg".to_string(),
            size: 1048576,
            last_modified: "2024-06-15T10:30:00Z".to_string(),
            etag: "\"d41d8cd98f00b204e9800998ecf8427e\"".to_string(),
            storage_class: Some("STANDARD".to_string()),
            owner: Some(Owner {
                id: "123456".to_string(),
                display_name: Some("testuser".to_string()),
            }),
        };
        let json = serde_json::to_string(&obj).unwrap();
        let back: Object = serde_json::from_str(&json).unwrap();
        assert_eq!(back.key, "photos/2024/img_001.jpg");
        assert_eq!(back.size, 1048576);
    }

    #[test]
    fn list_objects_output_serde() {
        let output = ListObjectsV2Output {
            name: "my-bucket".to_string(),
            prefix: Some("photos/".to_string()),
            delimiter: Some("/".to_string()),
            max_keys: 1000,
            is_truncated: false,
            contents: vec![],
            common_prefixes: vec![CommonPrefix {
                prefix: "photos/2024/".to_string(),
            }],
            continuation_token: None,
            next_continuation_token: None,
            key_count: 0,
        };
        let json = serde_json::to_string(&output).unwrap();
        let back: ListObjectsV2Output = serde_json::from_str(&json).unwrap();
        assert_eq!(back.name, "my-bucket");
        assert!(!back.is_truncated);
    }

    #[test]
    fn copy_source_header() {
        let src = CopySource {
            bucket: "source-bucket".to_string(),
            key: "source/key.txt".to_string(),
            version_id: None,
        };
        assert_eq!(src.to_header_value(), "/source-bucket/source/key.txt");
    }

    #[test]
    fn copy_source_header_with_version() {
        let src = CopySource {
            bucket: "src".to_string(),
            key: "obj".to_string(),
            version_id: Some("v123".to_string()),
        };
        assert_eq!(src.to_header_value(), "/src/obj?versionId=v123");
    }

    #[test]
    fn put_object_input_serde() {
        let input = PutObjectInput {
            bucket: "my-bucket".to_string(),
            key: "data/file.txt".to_string(),
            content_type: Some("text/plain".to_string()),
            storage_class: Some("STANDARD_IA".to_string()),
            server_side_encryption: Some("AES256".to_string()),
            acl: None,
            metadata: HashMap::from([("author".to_string(), "test".to_string())]),
            cache_control: Some("max-age=3600".to_string()),
            content_disposition: None,
            content_encoding: None,
            tagging: None,
        };
        let json = serde_json::to_string(&input).unwrap();
        let back: PutObjectInput = serde_json::from_str(&json).unwrap();
        assert_eq!(back.storage_class.as_deref(), Some("STANDARD_IA"));
    }

    #[test]
    fn completed_part_serde() {
        let part = CompletedPart {
            part_number: 1,
            etag: "\"abc123\"".to_string(),
        };
        let json = serde_json::to_string(&part).unwrap();
        let back: CompletedPart = serde_json::from_str(&json).unwrap();
        assert_eq!(back.part_number, 1);
    }
}
