// ── sorng-portainer/src/stacks.rs ────────────────────────────────────────────
//! Stacks (`/api/stacks`).

use crate::client::PortainerClient;
use crate::error::{PortainerError, PortainerResult};
use crate::types::{PortainerAuthMode, PortainerStack};
use reqwest::Method;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct RawStack {
    #[serde(rename = "Id")]
    id: u64,
    #[serde(rename = "Name", default)]
    name: String,
    #[serde(rename = "Type", default)]
    stack_type: u32,
    #[serde(rename = "EndpointId", default)]
    endpoint_id: u64,
    #[serde(rename = "Status", default)]
    status: u32,
}

pub(crate) fn parse_stacks(body: &[u8]) -> serde_json::Result<Vec<PortainerStack>> {
    let raw: Vec<RawStack> = serde_json::from_slice(body)?;
    Ok(raw
        .into_iter()
        .map(|s| PortainerStack {
            id: s.id,
            name: s.name,
            stack_type: s.stack_type,
            endpoint_id: s.endpoint_id,
            status: s.status,
        })
        .collect())
}

impl PortainerClient {
    /// `GET /api/stacks`
    pub async fn list_stacks(&self) -> PortainerResult<Vec<PortainerStack>> {
        let (status, bytes) = self.send_raw(Method::GET, "/stacks", None).await?;
        if !(200..300).contains(&status) {
            let text = String::from_utf8_lossy(&bytes);
            return Err(PortainerError::from_status(
                status,
                &text,
                self.auth_mode() == PortainerAuthMode::ApiKey,
            ));
        }
        parse_stacks(&bytes).map_err(|e| PortainerError::parse(format!("/stacks: {e}")))
    }

    /// `POST /api/stacks/{id}/start?endpointId={eid}`
    pub async fn start_stack(&self, stack_id: u64, endpoint_id: u64) -> PortainerResult<()> {
        let path = format!("/stacks/{stack_id}/start?endpointId={endpoint_id}");
        self.request_status(Method::POST, &path, None, &[200, 204])
            .await
    }

    /// `POST /api/stacks/{id}/stop?endpointId={eid}`
    pub async fn stop_stack(&self, stack_id: u64, endpoint_id: u64) -> PortainerResult<()> {
        let path = format!("/stacks/{stack_id}/stop?endpointId={endpoint_id}");
        self.request_status(Method::POST, &path, None, &[200, 204])
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_stack_list() {
        let body = br#"[{"Id":3,"Name":"web","Type":2,"EndpointId":1,"Status":1}]"#;
        let s = parse_stacks(body).unwrap();
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].name, "web");
        assert_eq!(s[0].stack_type, 2);
        assert_eq!(s[0].endpoint_id, 1);
    }

    /// `PortainerStacksTab.tsx` reads `s.type` / `s.endpointId`.
    #[test]
    fn serialises_to_the_wire_names_the_panel_reads() {
        let body = br#"[{"Id":3,"Name":"web","Type":2,"EndpointId":1,"Status":1}]"#;
        let v = serde_json::to_value(parse_stacks(body).unwrap()).unwrap();
        assert_eq!(v[0]["type"], 2, "stack type must serialise as `type`");
        assert!(v[0].get("stackType").is_none(), "must not leak `stackType`");
        assert_eq!(v[0]["endpointId"], 1);
        assert_eq!(v[0]["status"], 1);
    }
}
