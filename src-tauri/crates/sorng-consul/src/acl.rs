// ── sorng-consul – ACL operations ────────────────────────────────────────────
//! Consul ACL API: tokens, policies, roles management.

use crate::client::ConsulClient;
use crate::error::ConsulResult;
use crate::types::*;
use log::debug;

/// Manager for Consul ACL operations.
pub struct AclManager;

impl AclManager {
    // ── Bootstrap ───────────────────────────────────────────────────

    /// PUT /v1/acl/bootstrap — bootstrap the ACL system, returns the initial management token.
    pub async fn bootstrap_acl(client: &ConsulClient) -> ConsulResult<ConsulAclToken> {
        debug!("CONSUL ACL bootstrap");
        client
            .put_body("/v1/acl/bootstrap", &serde_json::json!({}))
            .await
    }

    // ── Tokens ──────────────────────────────────────────────────────

    /// GET /v1/acl/tokens — list all ACL tokens.
    pub async fn list_tokens(client: &ConsulClient) -> ConsulResult<Vec<ConsulAclToken>> {
        debug!("CONSUL ACL list tokens");
        client.get("/v1/acl/tokens").await
    }

    /// GET /v1/acl/token/:id — read a specific token by AccessorID.
    pub async fn get_token(
        client: &ConsulClient,
        accessor_id: &str,
    ) -> ConsulResult<ConsulAclToken> {
        let path = format!("/v1/acl/token/{}", accessor_id);
        debug!("CONSUL ACL get token: {accessor_id}");
        client.get(&path).await
    }

    /// PUT /v1/acl/token — create a new ACL token.
    pub async fn create_token(
        client: &ConsulClient,
        req: &AclTokenCreateRequest,
    ) -> ConsulResult<ConsulAclToken> {
        debug!("CONSUL ACL create token");
        let body = build_token_create_body(req);
        client.put_body("/v1/acl/token", &body).await
    }

    /// PUT /v1/acl/token/:id — update an existing ACL token.
    pub async fn update_token(
        client: &ConsulClient,
        accessor_id: &str,
        req: &AclTokenCreateRequest,
    ) -> ConsulResult<ConsulAclToken> {
        let path = format!("/v1/acl/token/{}", accessor_id);
        debug!("CONSUL ACL update token: {accessor_id}");
        let body = build_token_create_body(req);
        client.put_body(&path, &body).await
    }

    /// DELETE /v1/acl/token/:id — delete an ACL token.
    pub async fn delete_token(client: &ConsulClient, accessor_id: &str) -> ConsulResult<()> {
        let path = format!("/v1/acl/token/{}", accessor_id);
        debug!("CONSUL ACL delete token: {accessor_id}");
        client.delete(&path).await
    }

    // ── Policies ────────────────────────────────────────────────────

    /// GET /v1/acl/policies — list all ACL policies.
    pub async fn list_policies(client: &ConsulClient) -> ConsulResult<Vec<ConsulAclPolicy>> {
        debug!("CONSUL ACL list policies");
        client.get("/v1/acl/policies").await
    }

    /// GET /v1/acl/policy/:id — read a specific policy.
    pub async fn get_policy(
        client: &ConsulClient,
        policy_id: &str,
    ) -> ConsulResult<ConsulAclPolicy> {
        let path = format!("/v1/acl/policy/{}", policy_id);
        debug!("CONSUL ACL get policy: {policy_id}");
        client.get(&path).await
    }

    /// PUT /v1/acl/policy — create a new ACL policy.
    pub async fn create_policy(
        client: &ConsulClient,
        req: &AclPolicyCreateRequest,
    ) -> ConsulResult<ConsulAclPolicy> {
        debug!("CONSUL ACL create policy: {}", req.name);
        let body = build_policy_create_body(req);
        client.put_body("/v1/acl/policy", &body).await
    }

    /// PUT /v1/acl/policy/:id — update an existing ACL policy.
    pub async fn update_policy(
        client: &ConsulClient,
        policy_id: &str,
        req: &AclPolicyCreateRequest,
    ) -> ConsulResult<ConsulAclPolicy> {
        let path = format!("/v1/acl/policy/{}", policy_id);
        debug!("CONSUL ACL update policy: {policy_id}");
        let body = build_policy_create_body(req);
        client.put_body(&path, &body).await
    }

    /// DELETE /v1/acl/policy/:id — delete an ACL policy.
    pub async fn delete_policy(client: &ConsulClient, policy_id: &str) -> ConsulResult<()> {
        let path = format!("/v1/acl/policy/{}", policy_id);
        debug!("CONSUL ACL delete policy: {policy_id}");
        client.delete(&path).await
    }

    // ── Roles ───────────────────────────────────────────────────────

    /// GET /v1/acl/roles — list all ACL roles.
    pub async fn list_roles(client: &ConsulClient) -> ConsulResult<Vec<ConsulAclRole>> {
        debug!("CONSUL ACL list roles");
        client.get("/v1/acl/roles").await
    }

    /// GET /v1/acl/role/:id — read a specific role.
    pub async fn get_role(client: &ConsulClient, role_id: &str) -> ConsulResult<ConsulAclRole> {
        let path = format!("/v1/acl/role/{}", role_id);
        debug!("CONSUL ACL get role: {role_id}");
        client.get(&path).await
    }

    /// PUT /v1/acl/role — create a new ACL role.
    pub async fn create_role(
        client: &ConsulClient,
        req: &AclRoleCreateRequest,
    ) -> ConsulResult<ConsulAclRole> {
        debug!("CONSUL ACL create role: {}", req.name);
        let body = build_role_create_body(req);
        client.put_body("/v1/acl/role", &body).await
    }

    /// PUT /v1/acl/role/:id — update an existing ACL role.
    pub async fn update_role(
        client: &ConsulClient,
        role_id: &str,
        req: &AclRoleCreateRequest,
    ) -> ConsulResult<ConsulAclRole> {
        let path = format!("/v1/acl/role/{}", role_id);
        debug!("CONSUL ACL update role: {role_id}");
        let body = build_role_create_body(req);
        client.put_body(&path, &body).await
    }

    /// DELETE /v1/acl/role/:id — delete an ACL role.
    pub async fn delete_role(client: &ConsulClient, role_id: &str) -> ConsulResult<()> {
        let path = format!("/v1/acl/role/{}", role_id);
        debug!("CONSUL ACL delete role: {role_id}");
        client.delete(&path).await
    }
}

// ── helpers ──────────────────────────────────────────────────────────────────

fn build_token_create_body(req: &AclTokenCreateRequest) -> serde_json::Value {
    let mut body = serde_json::json!({});
    let obj = body.as_object_mut().expect("json! macro creates an Object");
    if let Some(ref d) = req.description {
        obj.insert("Description".into(), serde_json::json!(d));
    }
    if let Some(ref pols) = req.policies {
        let arr: Vec<serde_json::Value> = pols
            .iter()
            .map(|p| {
                let mut m = serde_json::Map::new();
                if let Some(ref id) = p.id {
                    m.insert("ID".into(), serde_json::json!(id));
                }
                if let Some(ref name) = p.name {
                    m.insert("Name".into(), serde_json::json!(name));
                }
                serde_json::Value::Object(m)
            })
            .collect();
        obj.insert("Policies".into(), serde_json::json!(arr));
    }
    if let Some(ref roles) = req.roles {
        let arr: Vec<serde_json::Value> = roles
            .iter()
            .map(|r| {
                let mut m = serde_json::Map::new();
                if let Some(ref id) = r.id {
                    m.insert("ID".into(), serde_json::json!(id));
                }
                if let Some(ref name) = r.name {
                    m.insert("Name".into(), serde_json::json!(name));
                }
                serde_json::Value::Object(m)
            })
            .collect();
        obj.insert("Roles".into(), serde_json::json!(arr));
    }
    if let Some(ref si) = req.service_identities {
        let arr: Vec<serde_json::Value> = si
            .iter()
            .map(|s| {
                let mut m = serde_json::Map::new();
                m.insert("ServiceName".into(), serde_json::json!(s.service_name));
                if let Some(ref dcs) = s.datacenters {
                    m.insert("Datacenters".into(), serde_json::json!(dcs));
                }
                serde_json::Value::Object(m)
            })
            .collect();
        obj.insert("ServiceIdentities".into(), serde_json::json!(arr));
    }
    if let Some(ref ni) = req.node_identities {
        let arr: Vec<serde_json::Value> = ni
            .iter()
            .map(|n| serde_json::json!({"NodeName": n.node_name, "Datacenter": n.datacenter}))
            .collect();
        obj.insert("NodeIdentities".into(), serde_json::json!(arr));
    }
    if let Some(local) = req.local {
        obj.insert("Local".into(), serde_json::json!(local));
    }
    if let Some(ref et) = req.expiration_time {
        obj.insert("ExpirationTime".into(), serde_json::json!(et));
    }
    if let Some(ref ettl) = req.expiration_ttl {
        obj.insert("ExpirationTTL".into(), serde_json::json!(ettl));
    }
    body
}

fn build_policy_create_body(req: &AclPolicyCreateRequest) -> serde_json::Value {
    let mut body = serde_json::json!({
        "Name": req.name,
        "Rules": req.rules,
    });
    let obj = body.as_object_mut().expect("json! macro creates an Object");
    if let Some(ref d) = req.description {
        obj.insert("Description".into(), serde_json::json!(d));
    }
    if let Some(ref dcs) = req.datacenters {
        obj.insert("Datacenters".into(), serde_json::json!(dcs));
    }
    body
}

fn build_role_create_body(req: &AclRoleCreateRequest) -> serde_json::Value {
    let mut body = serde_json::json!({ "Name": req.name });
    let obj = body.as_object_mut().expect("json! macro creates an Object");
    if let Some(ref d) = req.description {
        obj.insert("Description".into(), serde_json::json!(d));
    }
    if let Some(ref pols) = req.policies {
        let arr: Vec<serde_json::Value> = pols
            .iter()
            .map(|p| {
                let mut m = serde_json::Map::new();
                if let Some(ref id) = p.id {
                    m.insert("ID".into(), serde_json::json!(id));
                }
                if let Some(ref name) = p.name {
                    m.insert("Name".into(), serde_json::json!(name));
                }
                serde_json::Value::Object(m)
            })
            .collect();
        obj.insert("Policies".into(), serde_json::json!(arr));
    }
    if let Some(ref si) = req.service_identities {
        let arr: Vec<serde_json::Value> = si
            .iter()
            .map(|s| {
                let mut m = serde_json::Map::new();
                m.insert("ServiceName".into(), serde_json::json!(s.service_name));
                if let Some(ref dcs) = s.datacenters {
                    m.insert("Datacenters".into(), serde_json::json!(dcs));
                }
                serde_json::Value::Object(m)
            })
            .collect();
        obj.insert("ServiceIdentities".into(), serde_json::json!(arr));
    }
    if let Some(ref ni) = req.node_identities {
        let arr: Vec<serde_json::Value> = ni
            .iter()
            .map(|n| serde_json::json!({"NodeName": n.node_name, "Datacenter": n.datacenter}))
            .collect();
        obj.insert("NodeIdentities".into(), serde_json::json!(arr));
    }
    body
}
