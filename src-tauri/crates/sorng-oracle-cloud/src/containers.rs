use crate::client::OciClient;
use crate::error::OciResult;
use crate::types::{OciContainerInstance, OkeCluster, OkeNodePool};

/// Container Instances and OKE (Oracle Kubernetes Engine) operations.
pub struct ContainerManager;

impl ContainerManager {
    // ── Container Instances ──────────────────────────────────────────

    pub async fn list_container_instances(
        client: &OciClient,
        compartment_id: &str,
    ) -> OciResult<Vec<OciContainerInstance>> {
        client
            .get(
                "compute-containers",
                &format!("/20210415/containerInstances?compartmentId={compartment_id}"),
            )
            .await
    }

    pub async fn get_container_instance(
        client: &OciClient,
        container_instance_id: &str,
    ) -> OciResult<OciContainerInstance> {
        client
            .get(
                "compute-containers",
                &format!("/20210415/containerInstances/{container_instance_id}"),
            )
            .await
    }

    pub async fn create_container_instance(
        client: &OciClient,
        body: &serde_json::Value,
    ) -> OciResult<OciContainerInstance> {
        client
            .post("compute-containers", "/20210415/containerInstances", body)
            .await
    }

    pub async fn delete_container_instance(
        client: &OciClient,
        container_instance_id: &str,
    ) -> OciResult<()> {
        client
            .delete(
                "compute-containers",
                &format!("/20210415/containerInstances/{container_instance_id}"),
            )
            .await
    }

    // ── OKE Clusters ─────────────────────────────────────────────────

    pub async fn list_oke_clusters(
        client: &OciClient,
        compartment_id: &str,
    ) -> OciResult<Vec<OkeCluster>> {
        client
            .get(
                "containerEngine",
                &format!("/20180222/clusters?compartmentId={compartment_id}"),
            )
            .await
    }

    pub async fn get_oke_cluster(client: &OciClient, cluster_id: &str) -> OciResult<OkeCluster> {
        client
            .get(
                "containerEngine",
                &format!("/20180222/clusters/{cluster_id}"),
            )
            .await
    }

    pub async fn create_oke_cluster(
        client: &OciClient,
        body: &serde_json::Value,
    ) -> OciResult<OkeCluster> {
        client
            .post("containerEngine", "/20180222/clusters", body)
            .await
    }

    pub async fn delete_oke_cluster(client: &OciClient, cluster_id: &str) -> OciResult<()> {
        client
            .delete(
                "containerEngine",
                &format!("/20180222/clusters/{cluster_id}"),
            )
            .await
    }

    // ── Node Pools ───────────────────────────────────────────────────

    pub async fn list_node_pools(
        client: &OciClient,
        compartment_id: &str,
        cluster_id: Option<&str>,
    ) -> OciResult<Vec<OkeNodePool>> {
        let mut path = format!("/20180222/nodePools?compartmentId={compartment_id}");
        if let Some(cid) = cluster_id {
            path.push_str(&format!("&clusterId={cid}"));
        }
        client.get("containerEngine", &path).await
    }

    pub async fn get_node_pool(client: &OciClient, node_pool_id: &str) -> OciResult<OkeNodePool> {
        client
            .get(
                "containerEngine",
                &format!("/20180222/nodePools/{node_pool_id}"),
            )
            .await
    }

    pub async fn create_node_pool(
        client: &OciClient,
        body: &serde_json::Value,
    ) -> OciResult<OkeNodePool> {
        client
            .post("containerEngine", "/20180222/nodePools", body)
            .await
    }

    pub async fn delete_node_pool(client: &OciClient, node_pool_id: &str) -> OciResult<()> {
        client
            .delete(
                "containerEngine",
                &format!("/20180222/nodePools/{node_pool_id}"),
            )
            .await
    }
}
