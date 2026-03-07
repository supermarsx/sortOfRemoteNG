use crate::client::OciClient;
use crate::error::OciResult;
use crate::types::{OciFunction, OciFunctionApplication};

/// Oracle Functions operations for applications and serverless functions.
pub struct FunctionsManager;

impl FunctionsManager {
    // ── Applications ─────────────────────────────────────────────────

    pub async fn list_applications(
        client: &OciClient,
        compartment_id: &str,
    ) -> OciResult<Vec<OciFunctionApplication>> {
        client
            .get(
                "functions",
                &format!("/20181201/applications?compartmentId={compartment_id}"),
            )
            .await
    }

    pub async fn get_application(
        client: &OciClient,
        application_id: &str,
    ) -> OciResult<OciFunctionApplication> {
        client
            .get(
                "functions",
                &format!("/20181201/applications/{application_id}"),
            )
            .await
    }

    pub async fn create_application(
        client: &OciClient,
        compartment_id: &str,
        display_name: &str,
        subnet_ids: &[String],
    ) -> OciResult<OciFunctionApplication> {
        client
            .post(
                "functions",
                "/20181201/applications",
                &serde_json::json!({
                    "compartmentId": compartment_id,
                    "displayName": display_name,
                    "subnetIds": subnet_ids,
                }),
            )
            .await
    }

    pub async fn delete_application(
        client: &OciClient,
        application_id: &str,
    ) -> OciResult<()> {
        client
            .delete(
                "functions",
                &format!("/20181201/applications/{application_id}"),
            )
            .await
    }

    // ── Functions ────────────────────────────────────────────────────

    pub async fn list_functions(
        client: &OciClient,
        application_id: &str,
    ) -> OciResult<Vec<OciFunction>> {
        client
            .get(
                "functions",
                &format!("/20181201/functions?applicationId={application_id}"),
            )
            .await
    }

    pub async fn get_function(
        client: &OciClient,
        function_id: &str,
    ) -> OciResult<OciFunction> {
        client
            .get(
                "functions",
                &format!("/20181201/functions/{function_id}"),
            )
            .await
    }

    pub async fn create_function(
        client: &OciClient,
        body: &serde_json::Value,
    ) -> OciResult<OciFunction> {
        client.post("functions", "/20181201/functions", body).await
    }

    pub async fn delete_function(client: &OciClient, function_id: &str) -> OciResult<()> {
        client
            .delete(
                "functions",
                &format!("/20181201/functions/{function_id}"),
            )
            .await
    }

    pub async fn invoke_function(
        client: &OciClient,
        function_id: &str,
        payload: &serde_json::Value,
    ) -> OciResult<serde_json::Value> {
        client
            .post(
                "functions",
                &format!("/20181201/functions/{function_id}/actions/invoke"),
                payload,
            )
            .await
    }
}
