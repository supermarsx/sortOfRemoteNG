// ── sorng-netbox – Contacts module ───────────────────────────────────────────
//! Contacts, contact groups, contact roles, contact assignments.

use crate::client::NetboxClient;
use crate::error::{NetboxError, NetboxResult};
use crate::types::*;

pub struct ContactManager;

impl ContactManager {
    // ── Contacts ─────────────────────────────────────────────────────

    pub async fn list_contacts(client: &NetboxClient) -> NetboxResult<Vec<Contact>> {
        client.api_get_list("/tenancy/contacts/").await
    }

    pub async fn get_contact(client: &NetboxClient, id: i64) -> NetboxResult<Contact> {
        let body = client.api_get(&format!("/tenancy/contacts/{id}/")).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("get_contact: {e}")))
    }

    pub async fn create_contact(client: &NetboxClient, data: &serde_json::Value) -> NetboxResult<Contact> {
        let body = client.api_post("/tenancy/contacts/", &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("create_contact: {e}")))
    }

    pub async fn update_contact(client: &NetboxClient, id: i64, data: &serde_json::Value) -> NetboxResult<Contact> {
        let body = client.api_patch(&format!("/tenancy/contacts/{id}/"), &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("update_contact: {e}")))
    }

    pub async fn delete_contact(client: &NetboxClient, id: i64) -> NetboxResult<()> {
        client.api_delete(&format!("/tenancy/contacts/{id}/")).await?;
        Ok(())
    }

    // ── Contact groups ───────────────────────────────────────────────

    pub async fn list_contact_groups(client: &NetboxClient) -> NetboxResult<Vec<ContactGroup>> {
        client.api_get_list("/tenancy/contact-groups/").await
    }

    // ── Contact roles ────────────────────────────────────────────────

    pub async fn list_contact_roles(client: &NetboxClient) -> NetboxResult<Vec<ContactRole>> {
        client.api_get_list("/tenancy/contact-roles/").await
    }

    // ── Contact assignments ──────────────────────────────────────────

    pub async fn list_contact_assignments(client: &NetboxClient) -> NetboxResult<Vec<ContactAssignment>> {
        client.api_get_list("/tenancy/contact-assignments/").await
    }

    pub async fn create_contact_assignment(client: &NetboxClient, data: &serde_json::Value) -> NetboxResult<ContactAssignment> {
        let body = client.api_post("/tenancy/contact-assignments/", &data.to_string()).await?;
        serde_json::from_str(&body)
            .map_err(|e| NetboxError::parse(format!("create_contact_assignment: {e}")))
    }
}
