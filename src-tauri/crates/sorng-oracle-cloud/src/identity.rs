use crate::client::OciClient;
use crate::error::OciResult;
use crate::types::{OciCompartment, OciGroup, OciPolicy, OciUser};

/// Identity and Access Management operations.
pub struct IdentityManager;

impl IdentityManager {
    // ── Compartments ─────────────────────────────────────────────────

    pub async fn list_compartments(
        client: &OciClient,
        compartment_id: &str,
    ) -> OciResult<Vec<OciCompartment>> {
        client
            .get(
                "identity",
                &format!("/20160918/compartments?compartmentId={compartment_id}"),
            )
            .await
    }

    pub async fn get_compartment(
        client: &OciClient,
        compartment_id: &str,
    ) -> OciResult<OciCompartment> {
        client
            .get(
                "identity",
                &format!("/20160918/compartments/{compartment_id}"),
            )
            .await
    }

    pub async fn create_compartment(
        client: &OciClient,
        parent_compartment_id: &str,
        name: &str,
        description: &str,
    ) -> OciResult<OciCompartment> {
        client
            .post(
                "identity",
                "/20160918/compartments",
                &serde_json::json!({
                    "compartmentId": parent_compartment_id,
                    "name": name,
                    "description": description,
                }),
            )
            .await
    }

    pub async fn delete_compartment(
        client: &OciClient,
        compartment_id: &str,
    ) -> OciResult<()> {
        client
            .delete(
                "identity",
                &format!("/20160918/compartments/{compartment_id}"),
            )
            .await
    }

    // ── Users ────────────────────────────────────────────────────────

    pub async fn list_users(
        client: &OciClient,
        compartment_id: &str,
    ) -> OciResult<Vec<OciUser>> {
        client
            .get(
                "identity",
                &format!("/20160918/users?compartmentId={compartment_id}"),
            )
            .await
    }

    pub async fn get_user(client: &OciClient, user_id: &str) -> OciResult<OciUser> {
        client
            .get("identity", &format!("/20160918/users/{user_id}"))
            .await
    }

    pub async fn create_user(
        client: &OciClient,
        compartment_id: &str,
        name: &str,
        description: &str,
        email: Option<&str>,
    ) -> OciResult<OciUser> {
        let mut body = serde_json::json!({
            "compartmentId": compartment_id,
            "name": name,
            "description": description,
        });
        if let Some(e) = email {
            body["email"] = serde_json::Value::String(e.to_string());
        }
        client.post("identity", "/20160918/users", &body).await
    }

    pub async fn delete_user(client: &OciClient, user_id: &str) -> OciResult<()> {
        client
            .delete("identity", &format!("/20160918/users/{user_id}"))
            .await
    }

    // ── Groups ───────────────────────────────────────────────────────

    pub async fn list_groups(
        client: &OciClient,
        compartment_id: &str,
    ) -> OciResult<Vec<OciGroup>> {
        client
            .get(
                "identity",
                &format!("/20160918/groups?compartmentId={compartment_id}"),
            )
            .await
    }

    pub async fn get_group(client: &OciClient, group_id: &str) -> OciResult<OciGroup> {
        client
            .get("identity", &format!("/20160918/groups/{group_id}"))
            .await
    }

    pub async fn add_user_to_group(
        client: &OciClient,
        user_id: &str,
        group_id: &str,
    ) -> OciResult<serde_json::Value> {
        client
            .post(
                "identity",
                "/20160918/userGroupMemberships",
                &serde_json::json!({
                    "userId": user_id,
                    "groupId": group_id,
                }),
            )
            .await
    }

    pub async fn remove_user_from_group(
        client: &OciClient,
        membership_id: &str,
    ) -> OciResult<()> {
        client
            .delete(
                "identity",
                &format!("/20160918/userGroupMemberships/{membership_id}"),
            )
            .await
    }

    // ── Policies ─────────────────────────────────────────────────────

    pub async fn list_policies(
        client: &OciClient,
        compartment_id: &str,
    ) -> OciResult<Vec<OciPolicy>> {
        client
            .get(
                "identity",
                &format!("/20160918/policies?compartmentId={compartment_id}"),
            )
            .await
    }

    pub async fn get_policy(client: &OciClient, policy_id: &str) -> OciResult<OciPolicy> {
        client
            .get("identity", &format!("/20160918/policies/{policy_id}"))
            .await
    }

    pub async fn create_policy(
        client: &OciClient,
        compartment_id: &str,
        name: &str,
        description: &str,
        statements: &[String],
    ) -> OciResult<OciPolicy> {
        client
            .post(
                "identity",
                "/20160918/policies",
                &serde_json::json!({
                    "compartmentId": compartment_id,
                    "name": name,
                    "description": description,
                    "statements": statements,
                }),
            )
            .await
    }

    pub async fn delete_policy(client: &OciClient, policy_id: &str) -> OciResult<()> {
        client
            .delete("identity", &format!("/20160918/policies/{policy_id}"))
            .await
    }
}
