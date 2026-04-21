use crate::client::OciClient;
use crate::error::OciResult;
use crate::types::{
    LaunchInstanceRequest, OciBootVolume, OciImage, OciInstance, OciShape, OciVnicAttachment,
};

/// Compute Engine operations for OCI instances, shapes, and images.
pub struct ComputeManager;

impl ComputeManager {
    // ── Instances ────────────────────────────────────────────────────

    pub async fn list_instances(
        client: &OciClient,
        compartment_id: &str,
    ) -> OciResult<Vec<OciInstance>> {
        client
            .get(
                "iaas",
                &format!("/20160918/instances?compartmentId={compartment_id}"),
            )
            .await
    }

    pub async fn get_instance(client: &OciClient, instance_id: &str) -> OciResult<OciInstance> {
        client
            .get("iaas", &format!("/20160918/instances/{instance_id}"))
            .await
    }

    pub async fn launch_instance(
        client: &OciClient,
        request: &LaunchInstanceRequest,
    ) -> OciResult<OciInstance> {
        client.post("iaas", "/20160918/instances", request).await
    }

    pub async fn terminate_instance(client: &OciClient, instance_id: &str) -> OciResult<()> {
        client
            .delete("iaas", &format!("/20160918/instances/{instance_id}"))
            .await
    }

    pub async fn instance_action(
        client: &OciClient,
        instance_id: &str,
        action: &str,
    ) -> OciResult<OciInstance> {
        client
            .post(
                "iaas",
                &format!("/20160918/instances/{instance_id}?action={action}"),
                &serde_json::json!({}),
            )
            .await
    }

    pub async fn start_instance(client: &OciClient, instance_id: &str) -> OciResult<OciInstance> {
        Self::instance_action(client, instance_id, "START").await
    }

    pub async fn stop_instance(client: &OciClient, instance_id: &str) -> OciResult<OciInstance> {
        Self::instance_action(client, instance_id, "STOP").await
    }

    pub async fn reboot_instance(client: &OciClient, instance_id: &str) -> OciResult<OciInstance> {
        Self::instance_action(client, instance_id, "SOFTRESET").await
    }

    // ── Shapes ──────────────────────────────────────────────────────

    pub async fn list_shapes(client: &OciClient, compartment_id: &str) -> OciResult<Vec<OciShape>> {
        client
            .get(
                "iaas",
                &format!("/20160918/shapes?compartmentId={compartment_id}"),
            )
            .await
    }

    // ── Images ──────────────────────────────────────────────────────

    pub async fn list_images(client: &OciClient, compartment_id: &str) -> OciResult<Vec<OciImage>> {
        client
            .get(
                "iaas",
                &format!("/20160918/images?compartmentId={compartment_id}"),
            )
            .await
    }

    pub async fn get_image(client: &OciClient, image_id: &str) -> OciResult<OciImage> {
        client
            .get("iaas", &format!("/20160918/images/{image_id}"))
            .await
    }

    // ── VNIC Attachments ────────────────────────────────────────────

    pub async fn list_vnic_attachments(
        client: &OciClient,
        compartment_id: &str,
        instance_id: Option<&str>,
    ) -> OciResult<Vec<OciVnicAttachment>> {
        let mut path = format!("/20160918/vnicAttachments?compartmentId={compartment_id}");
        if let Some(iid) = instance_id {
            path.push_str(&format!("&instanceId={iid}"));
        }
        client.get("iaas", &path).await
    }

    // ── Boot Volumes ────────────────────────────────────────────────

    pub async fn get_boot_volume(
        client: &OciClient,
        boot_volume_id: &str,
    ) -> OciResult<OciBootVolume> {
        client
            .get("iaas", &format!("/20160918/bootVolumes/{boot_volume_id}"))
            .await
    }
}
