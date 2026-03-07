use crate::client::OciClient;
use crate::error::OciResult;
use crate::types::{OciBlockVolume, OciBucket, OciObject, OciVolumeAttachment};

/// Storage operations for block volumes and Object Storage.
pub struct StorageManager;

impl StorageManager {
    // ── Block Volumes ────────────────────────────────────────────────

    pub async fn list_block_volumes(
        client: &OciClient,
        compartment_id: &str,
        availability_domain: Option<&str>,
    ) -> OciResult<Vec<OciBlockVolume>> {
        let mut path = format!("/20160918/volumes?compartmentId={compartment_id}");
        if let Some(ad) = availability_domain {
            path.push_str(&format!("&availabilityDomain={ad}"));
        }
        client.get("iaas", &path).await
    }

    pub async fn get_block_volume(
        client: &OciClient,
        volume_id: &str,
    ) -> OciResult<OciBlockVolume> {
        client
            .get("iaas", &format!("/20160918/volumes/{volume_id}"))
            .await
    }

    pub async fn create_block_volume(
        client: &OciClient,
        compartment_id: &str,
        availability_domain: &str,
        display_name: &str,
        size_in_gbs: u64,
    ) -> OciResult<OciBlockVolume> {
        client
            .post(
                "iaas",
                "/20160918/volumes",
                &serde_json::json!({
                    "compartmentId": compartment_id,
                    "availabilityDomain": availability_domain,
                    "displayName": display_name,
                    "sizeInGBs": size_in_gbs,
                }),
            )
            .await
    }

    pub async fn delete_block_volume(client: &OciClient, volume_id: &str) -> OciResult<()> {
        client
            .delete("iaas", &format!("/20160918/volumes/{volume_id}"))
            .await
    }

    // ── Volume Attachments ───────────────────────────────────────────

    pub async fn list_volume_attachments(
        client: &OciClient,
        compartment_id: &str,
        instance_id: Option<&str>,
    ) -> OciResult<Vec<OciVolumeAttachment>> {
        let mut path = format!("/20160918/volumeAttachments?compartmentId={compartment_id}");
        if let Some(iid) = instance_id {
            path.push_str(&format!("&instanceId={iid}"));
        }
        client.get("iaas", &path).await
    }

    pub async fn attach_volume(
        client: &OciClient,
        instance_id: &str,
        volume_id: &str,
        attachment_type: &str,
    ) -> OciResult<OciVolumeAttachment> {
        client
            .post(
                "iaas",
                "/20160918/volumeAttachments",
                &serde_json::json!({
                    "instanceId": instance_id,
                    "volumeId": volume_id,
                    "type": attachment_type,
                }),
            )
            .await
    }

    pub async fn detach_volume(client: &OciClient, attachment_id: &str) -> OciResult<()> {
        client
            .delete("iaas", &format!("/20160918/volumeAttachments/{attachment_id}"))
            .await
    }

    // ── Object Storage — Buckets ─────────────────────────────────────

    pub async fn list_buckets(
        client: &OciClient,
        namespace: &str,
        compartment_id: &str,
    ) -> OciResult<Vec<OciBucket>> {
        client
            .get(
                "objectstorage",
                &format!("/n/{namespace}/b?compartmentId={compartment_id}"),
            )
            .await
    }

    pub async fn get_bucket(
        client: &OciClient,
        namespace: &str,
        bucket_name: &str,
    ) -> OciResult<OciBucket> {
        client
            .get(
                "objectstorage",
                &format!("/n/{namespace}/b/{bucket_name}"),
            )
            .await
    }

    pub async fn create_bucket(
        client: &OciClient,
        namespace: &str,
        compartment_id: &str,
        bucket_name: &str,
    ) -> OciResult<OciBucket> {
        client
            .post(
                "objectstorage",
                &format!("/n/{namespace}/b"),
                &serde_json::json!({
                    "compartmentId": compartment_id,
                    "name": bucket_name,
                }),
            )
            .await
    }

    pub async fn delete_bucket(
        client: &OciClient,
        namespace: &str,
        bucket_name: &str,
    ) -> OciResult<()> {
        client
            .delete(
                "objectstorage",
                &format!("/n/{namespace}/b/{bucket_name}"),
            )
            .await
    }

    // ── Object Storage — Objects ─────────────────────────────────────

    pub async fn list_objects(
        client: &OciClient,
        namespace: &str,
        bucket_name: &str,
        prefix: Option<&str>,
    ) -> OciResult<Vec<OciObject>> {
        let mut path = format!("/n/{namespace}/b/{bucket_name}/o");
        if let Some(p) = prefix {
            path.push_str(&format!("?prefix={p}"));
        }
        client.get("objectstorage", &path).await
    }

    pub async fn get_object(
        client: &OciClient,
        namespace: &str,
        bucket_name: &str,
        object_name: &str,
    ) -> OciResult<OciObject> {
        client
            .get(
                "objectstorage",
                &format!("/n/{namespace}/b/{bucket_name}/o/{object_name}"),
            )
            .await
    }

    pub async fn put_object(
        client: &OciClient,
        namespace: &str,
        bucket_name: &str,
        object_name: &str,
        body: &serde_json::Value,
    ) -> OciResult<OciObject> {
        client
            .put(
                "objectstorage",
                &format!("/n/{namespace}/b/{bucket_name}/o/{object_name}"),
                body,
            )
            .await
    }

    pub async fn delete_object(
        client: &OciClient,
        namespace: &str,
        bucket_name: &str,
        object_name: &str,
    ) -> OciResult<()> {
        client
            .delete(
                "objectstorage",
                &format!("/n/{namespace}/b/{bucket_name}/o/{object_name}"),
            )
            .await
    }
}
