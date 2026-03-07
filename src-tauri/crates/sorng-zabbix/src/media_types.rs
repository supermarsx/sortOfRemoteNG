// ── sorng-zabbix/src/media_types.rs ──────────────────────────────────────────
//! Media type management via Zabbix JSON-RPC API.

use crate::client::ZabbixClient;
use crate::error::ZabbixError;
use crate::types::*;
use serde_json::Value;

pub struct MediaTypeManager;

impl MediaTypeManager {
    /// Retrieve media types.  method: mediatype.get
    pub async fn get(
        client: &ZabbixClient,
        params: Value,
    ) -> Result<Vec<ZabbixMediaType>, ZabbixError> {
        client.request_typed("mediatype.get", params).await
    }

    /// Create a media type.  method: mediatype.create
    pub async fn create(
        client: &ZabbixClient,
        media_type: &ZabbixMediaType,
    ) -> Result<Value, ZabbixError> {
        client.request("mediatype.create", media_type).await
    }

    /// Update a media type.  method: mediatype.update
    pub async fn update(
        client: &ZabbixClient,
        media_type: &ZabbixMediaType,
    ) -> Result<Value, ZabbixError> {
        client.request("mediatype.update", media_type).await
    }

    /// Delete media types by IDs.  method: mediatype.delete
    pub async fn delete(
        client: &ZabbixClient,
        ids: Vec<String>,
    ) -> Result<Value, ZabbixError> {
        client.request("mediatype.delete", ids).await
    }
}
