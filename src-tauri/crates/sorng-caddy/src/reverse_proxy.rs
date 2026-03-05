// ── caddy reverse proxy convenience ──────────────────────────────────────────

use crate::client::CaddyClient;
use crate::error::CaddyResult;
use crate::types::*;

pub struct ReverseProxyManager;

impl ReverseProxyManager {
    /// Create a reverse proxy route in the given server.
    pub async fn create(client: &CaddyClient, server: &str, req: &CreateReverseProxyRequest) -> CaddyResult<()> {
        let matchers = if req.hosts.is_empty() {
            None
        } else {
            Some(vec![CaddyMatcher { host: Some(req.hosts.clone()), ..Default::default() }])
        };

        let upstreams: Vec<CaddyUpstream> = req.upstreams.iter().map(|u| CaddyUpstream {
            dial: u.clone(),
            max_requests: None,
        }).collect();

        let handler = CaddyHandler {
            handler: "reverse_proxy".to_string(),
            upstreams: Some(upstreams),
            ..Default::default()
        };

        let route = CaddyRoute {
            id: None,
            group: None,
            matchers,
            handle: Some(vec![handler]),
            terminal: Some(true),
        };

        let _: serde_json::Value = client.post(
            &format!("/config/apps/http/servers/{}/routes", server),
            &route,
        ).await?;
        Ok(())
    }

    /// Get upstream health via /reverse_proxy/upstreams
    pub async fn get_upstreams(client: &CaddyClient) -> CaddyResult<Vec<serde_json::Value>> {
        client.get_upstreams().await
    }

    /// Create a file server route.
    pub async fn create_file_server(client: &CaddyClient, server: &str, req: &CreateFileServerRequest) -> CaddyResult<()> {
        let matchers = if req.hosts.is_empty() {
            None
        } else {
            Some(vec![CaddyMatcher { host: Some(req.hosts.clone()), ..Default::default() }])
        };

        let handler = CaddyHandler {
            handler: "file_server".to_string(),
            root: Some(req.root.clone()),
            browse: if req.browse.unwrap_or(false) { Some(serde_json::json!({})) } else { None },
            index_names: req.index_names.clone(),
            ..Default::default()
        };

        let route = CaddyRoute {
            id: None,
            group: None,
            matchers,
            handle: Some(vec![handler]),
            terminal: Some(true),
        };

        let _: serde_json::Value = client.post(
            &format!("/config/apps/http/servers/{}/routes", server),
            &route,
        ).await?;
        Ok(())
    }

    /// Create a redirect route.
    pub async fn create_redirect(client: &CaddyClient, server: &str, req: &CreateRedirectRequest) -> CaddyResult<()> {
        let matchers = if req.hosts.is_empty() {
            None
        } else {
            Some(vec![CaddyMatcher { host: Some(req.hosts.clone()), ..Default::default() }])
        };

        let status = if req.permanent.unwrap_or(false) { "301" } else { "302" };
        let handler = CaddyHandler {
            handler: "static_response".to_string(),
            status_code: Some(status.to_string()),
            headers: Some(serde_json::json!({ "Location": [&req.target] })),
            ..Default::default()
        };

        let route = CaddyRoute {
            id: None,
            group: None,
            matchers,
            handle: Some(vec![handler]),
            terminal: Some(true),
        };

        let _: serde_json::Value = client.post(
            &format!("/config/apps/http/servers/{}/routes", server),
            &route,
        ).await?;
        Ok(())
    }
}

impl Default for CaddyMatcher {
    fn default() -> Self {
        Self {
            host: None, path: None, path_regexp: None, method: None,
            header: None, header_regexp: None, protocol: None, query: None,
            remote_ip: None, not: None, expression: None,
        }
    }
}

impl Default for CaddyHandler {
    fn default() -> Self {
        Self {
            handler: String::new(), upstreams: None, load_balancing: None,
            health_checks: None, headers: None, transport: None, rewrite: None,
            buffer_requests: None, buffer_responses: None, max_buffer_size: None,
            root: None, hide: None, index_names: None, browse: None,
            precompressed: None, canonical_uris: None, pass_thru: None,
            status_code: None, body: None, close: None, routes: None,
            encodings: None, prefer: None, minimum_length: None,
            providers: None, uri: None, strip_path_prefix: None,
            strip_path_suffix: None, uri_substring: None, redirect_status: None,
        }
    }
}
