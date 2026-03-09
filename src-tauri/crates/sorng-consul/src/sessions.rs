// ── sorng-consul – Session operations ────────────────────────────────────────
//! Consul session API: create, destroy, list, renew sessions for distributed locking.

use crate::client::ConsulClient;
use crate::error::{ConsulError, ConsulResult};
use crate::types::*;
use log::debug;

/// Manager for Consul session operations.
pub struct SessionManager;

impl SessionManager {
    // ── Create ──────────────────────────────────────────────────────

    /// PUT /v1/session/create — create a new session. Returns the session ID.
    pub async fn create_session(
        client: &ConsulClient,
        req: &SessionCreateRequest,
    ) -> ConsulResult<String> {
        debug!("CONSUL create session");
        let body = build_session_create_body(req);
        let resp: serde_json::Value = client.put_body("/v1/session/create", &body).await?;
        resp.get("ID")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| ConsulError::parse("Missing 'ID' in session create response"))
    }

    // ── Read ────────────────────────────────────────────────────────

    /// GET /v1/session/info/:id — returns information about a specific session.
    pub async fn get_session(
        client: &ConsulClient,
        session_id: &str,
    ) -> ConsulResult<ConsulSession> {
        let path = format!("/v1/session/info/{}", session_id);
        debug!("CONSUL get session: {session_id}");
        let raw: Vec<RawSession> = client.get(&path).await?;
        let entry = raw
            .into_iter()
            .next()
            .ok_or_else(|| ConsulError::not_found(format!("Session not found: {session_id}")))?;
        Ok(convert_raw_session(entry))
    }

    /// GET /v1/session/list — returns all active sessions.
    pub async fn list_sessions(client: &ConsulClient) -> ConsulResult<Vec<ConsulSession>> {
        debug!("CONSUL list sessions");
        let raw: Vec<RawSession> = client.get("/v1/session/list").await?;
        Ok(raw.into_iter().map(convert_raw_session).collect())
    }

    /// GET /v1/session/node/:node — returns sessions belonging to a node.
    pub async fn list_node_sessions(
        client: &ConsulClient,
        node: &str,
    ) -> ConsulResult<Vec<ConsulSession>> {
        let path = format!("/v1/session/node/{}", node);
        debug!("CONSUL list sessions for node: {node}");
        let raw: Vec<RawSession> = client.get(&path).await?;
        Ok(raw.into_iter().map(convert_raw_session).collect())
    }

    // ── Lifecycle ───────────────────────────────────────────────────

    /// PUT /v1/session/destroy/:id — invalidates a session.
    pub async fn delete_session(client: &ConsulClient, session_id: &str) -> ConsulResult<()> {
        let path = format!("/v1/session/destroy/{}", session_id);
        debug!("CONSUL delete session: {session_id}");
        client.put_no_body(&path).await
    }

    /// PUT /v1/session/renew/:id — renews a session's TTL.
    pub async fn renew_session(
        client: &ConsulClient,
        session_id: &str,
    ) -> ConsulResult<ConsulSession> {
        let path = format!("/v1/session/renew/{}", session_id);
        debug!("CONSUL renew session: {session_id}");
        let raw: Vec<RawSession> = client
            .put_body(&path, &serde_json::json!({}))
            .await
            .map_err(|e| {
                if matches!(e.kind, crate::error::ConsulErrorKind::NotFound) {
                    ConsulError::session_expired(format!(
                        "Session expired or not found: {session_id}"
                    ))
                } else {
                    e
                }
            })?;
        let entry = raw.into_iter().next().ok_or_else(|| {
            ConsulError::session_expired(format!("Session not found after renew: {session_id}"))
        })?;
        Ok(convert_raw_session(entry))
    }
}

// ── helpers ──────────────────────────────────────────────────────────────────

fn convert_raw_session(raw: RawSession) -> ConsulSession {
    let lock_delay_str = raw.lock_delay.map(|ns| {
        // Consul returns lock delay in nanoseconds; convert to human-readable
        let secs = ns / 1_000_000_000;
        format!("{secs}s")
    });
    ConsulSession {
        id: raw.id,
        name: raw.name,
        node: raw.node,
        lock_delay: lock_delay_str,
        behavior: raw.behavior,
        ttl: raw.ttl,
        checks: raw.checks,
        node_checks: raw.node_checks,
        service_checks: raw.service_checks,
        create_index: raw.create_index,
        modify_index: raw.modify_index,
    }
}

fn build_session_create_body(req: &SessionCreateRequest) -> serde_json::Value {
    let mut body = serde_json::json!({});
    let obj = body.as_object_mut().unwrap();
    if let Some(ref name) = req.name {
        obj.insert("Name".into(), serde_json::json!(name));
    }
    if let Some(ref node) = req.node {
        obj.insert("Node".into(), serde_json::json!(node));
    }
    if let Some(ref ld) = req.lock_delay {
        obj.insert("LockDelay".into(), serde_json::json!(ld));
    }
    if let Some(ref b) = req.behavior {
        obj.insert("Behavior".into(), serde_json::json!(b));
    }
    if let Some(ref ttl) = req.ttl {
        obj.insert("TTL".into(), serde_json::json!(ttl));
    }
    if let Some(ref checks) = req.checks {
        obj.insert("Checks".into(), serde_json::json!(checks));
    }
    if let Some(ref nc) = req.node_checks {
        obj.insert("NodeChecks".into(), serde_json::json!(nc));
    }
    if let Some(ref sc) = req.service_checks {
        let arr: Vec<serde_json::Value> = sc
            .iter()
            .map(|s| {
                let mut m = serde_json::Map::new();
                m.insert("ID".into(), serde_json::json!(s.id));
                if let Some(ref ns) = s.namespace {
                    m.insert("Namespace".into(), serde_json::json!(ns));
                }
                serde_json::Value::Object(m)
            })
            .collect();
        obj.insert("ServiceChecks".into(), serde_json::json!(arr));
    }
    body
}
