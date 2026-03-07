// ── sorng-netbox/src/contacts.rs ─────────────────────────────────────────────
//! Contact management via NetBox REST API.

use crate::client::NetboxClient;
use crate::error::NetboxResult;
use crate::types::*;

pub struct ContactManager;

impl ContactManager {
    // ── Contacts ─────────────────────────────────────────────────────

    pub async fn list(
        client: &NetboxClient,
        params: &[(&str, &str)],
    ) -> NetboxResult<PaginatedResponse<Contact>> {
        client.api_get_paginated("tenancy/contacts", params).await
    }

    pub async fn get(client: &NetboxClient, id: i64) -> NetboxResult<Contact> {
        client.api_get(&format!("tenancy/contacts/{id}")).await
    }

    pub async fn create(
        client: &NetboxClient,
        data: &serde_json::Value,
    ) -> NetboxResult<Contact> {
        client.api_post("tenancy/contacts", data).await
    }

    pub async fn update(
        client: &NetboxClient,
        id: i64,
        data: &serde_json::Value,
    ) -> NetboxResult<Contact> {
        client.api_put(&format!("tenancy/contacts/{id}"), data).await
    }

    pub async fn partial_update(
        client: &NetboxClient,
        id: i64,
        data: &serde_json::Value,
    ) -> NetboxResult<Contact> {
        client.api_patch(&format!("tenancy/contacts/{id}"), data).await
    }

    pub async fn delete(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("tenancy/contacts/{id}")).await
    }

    // ── Contact Groups ───────────────────────────────────────────────

    pub async fn list_groups(
        client: &NetboxClient,
    ) -> NetboxResult<PaginatedResponse<ContactGroup>> {
        client.api_get_paginated("tenancy/contact-groups", &[]).await
    }

    pub async fn get_group(client: &NetboxClient, id: i64) -> NetboxResult<ContactGroup> {
        client.api_get(&format!("tenancy/contact-groups/{id}")).await
    }

    pub async fn create_group(
        client: &NetboxClient,
        data: &serde_json::Value,
    ) -> NetboxResult<ContactGroup> {
        client.api_post("tenancy/contact-groups", data).await
    }

    pub async fn update_group(
        client: &NetboxClient,
        id: i64,
        data: &serde_json::Value,
    ) -> NetboxResult<ContactGroup> {
        client.api_put(&format!("tenancy/contact-groups/{id}"), data).await
    }

    pub async fn delete_group(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("tenancy/contact-groups/{id}")).await
    }

    // ── Contact Roles ────────────────────────────────────────────────

    pub async fn list_roles(
        client: &NetboxClient,
    ) -> NetboxResult<PaginatedResponse<ContactRole>> {
        client.api_get_paginated("tenancy/contact-roles", &[]).await
    }

    // ── Contact Assignments ──────────────────────────────────────────

    pub async fn list_assignments(
        client: &NetboxClient,
    ) -> NetboxResult<PaginatedResponse<ContactAssignment>> {
        client.api_get_paginated("tenancy/contact-assignments", &[]).await
    }
}
