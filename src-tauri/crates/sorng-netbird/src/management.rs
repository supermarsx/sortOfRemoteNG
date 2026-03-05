//! # NetBird Management API Client
//!
//! REST client for the NetBird Management API. Provides typed methods for
//! all major endpoints: peers, groups, routes, policies, DNS nameservers,
//! setup keys, posture checks, users, accounts, and events.

use serde::{Deserialize, Serialize};

/// Configuration for the Management API client.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagementApiConfig {
    /// Base URL, e.g. `https://api.netbird.io`.
    pub base_url: String,
    /// Personal access token (PAT) or service-user token.
    pub token: String,
    /// Request timeout in seconds.
    pub timeout_secs: u32,
}

impl Default for ManagementApiConfig {
    fn default() -> Self {
        Self {
            base_url: "https://api.netbird.io".to_string(),
            token: String::new(),
            timeout_secs: 30,
        }
    }
}

/// Describes an API endpoint.
#[derive(Debug, Clone)]
pub struct ApiEndpoint {
    pub method: HttpMethod,
    pub path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HttpMethod {
    Get,
    Post,
    Put,
    Patch,
    Delete,
}

// ── Endpoint builders ───────────────────────────────────────────

/// List all peers.
pub fn peers_list() -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Get, path: "/api/peers".to_string() }
}

/// Get a single peer.
pub fn peer_get(peer_id: &str) -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Get, path: format!("/api/peers/{}", peer_id) }
}

/// Update a peer.
pub fn peer_update(peer_id: &str) -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Put, path: format!("/api/peers/{}", peer_id) }
}

/// Delete a peer.
pub fn peer_delete(peer_id: &str) -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Delete, path: format!("/api/peers/{}", peer_id) }
}

/// List accessible peers for a given peer.
pub fn peer_accessible(peer_id: &str) -> ApiEndpoint {
    ApiEndpoint {
        method: HttpMethod::Get,
        path: format!("/api/peers/{}/accessible-peers", peer_id),
    }
}

/// List all groups.
pub fn groups_list() -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Get, path: "/api/groups".to_string() }
}

/// Create a group.
pub fn group_create() -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Post, path: "/api/groups".to_string() }
}

/// Get a group.
pub fn group_get(group_id: &str) -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Get, path: format!("/api/groups/{}", group_id) }
}

/// Update a group.
pub fn group_update(group_id: &str) -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Put, path: format!("/api/groups/{}", group_id) }
}

/// Delete a group.
pub fn group_delete(group_id: &str) -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Delete, path: format!("/api/groups/{}", group_id) }
}

/// List all routes.
pub fn routes_list() -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Get, path: "/api/routes".to_string() }
}

/// Create a route.
pub fn route_create() -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Post, path: "/api/routes".to_string() }
}

/// Get a route.
pub fn route_get(route_id: &str) -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Get, path: format!("/api/routes/{}", route_id) }
}

/// Update a route.
pub fn route_update(route_id: &str) -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Put, path: format!("/api/routes/{}", route_id) }
}

/// Delete a route.
pub fn route_delete(route_id: &str) -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Delete, path: format!("/api/routes/{}", route_id) }
}

/// List all policies.
pub fn policies_list() -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Get, path: "/api/policies".to_string() }
}

/// Create a policy.
pub fn policy_create() -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Post, path: "/api/policies".to_string() }
}

/// Get a policy.
pub fn policy_get(policy_id: &str) -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Get, path: format!("/api/policies/{}", policy_id) }
}

/// Update a policy.
pub fn policy_update(policy_id: &str) -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Put, path: format!("/api/policies/{}", policy_id) }
}

/// Delete a policy.
pub fn policy_delete(policy_id: &str) -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Delete, path: format!("/api/policies/{}", policy_id) }
}

/// List DNS nameserver groups.
pub fn dns_nameservers_list() -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Get, path: "/api/dns/nameservers".to_string() }
}

/// Create a DNS nameserver group.
pub fn dns_nameserver_create() -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Post, path: "/api/dns/nameservers".to_string() }
}

/// Get a DNS nameserver group.
pub fn dns_nameserver_get(ns_id: &str) -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Get, path: format!("/api/dns/nameservers/{}", ns_id) }
}

/// Update a DNS nameserver group.
pub fn dns_nameserver_update(ns_id: &str) -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Put, path: format!("/api/dns/nameservers/{}", ns_id) }
}

/// Delete a DNS nameserver group.
pub fn dns_nameserver_delete(ns_id: &str) -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Delete, path: format!("/api/dns/nameservers/{}", ns_id) }
}

/// List setup keys.
pub fn setup_keys_list() -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Get, path: "/api/setup-keys".to_string() }
}

/// Create a setup key.
pub fn setup_key_create() -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Post, path: "/api/setup-keys".to_string() }
}

/// Get a setup key.
pub fn setup_key_get(key_id: &str) -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Get, path: format!("/api/setup-keys/{}", key_id) }
}

/// Update a setup key.
pub fn setup_key_update(key_id: &str) -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Put, path: format!("/api/setup-keys/{}", key_id) }
}

/// List posture checks.
pub fn posture_checks_list() -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Get, path: "/api/posture-checks".to_string() }
}

/// Create a posture check.
pub fn posture_check_create() -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Post, path: "/api/posture-checks".to_string() }
}

/// Get a posture check.
pub fn posture_check_get(check_id: &str) -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Get, path: format!("/api/posture-checks/{}", check_id) }
}

/// Update a posture check.
pub fn posture_check_update(check_id: &str) -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Put, path: format!("/api/posture-checks/{}", check_id) }
}

/// Delete a posture check.
pub fn posture_check_delete(check_id: &str) -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Delete, path: format!("/api/posture-checks/{}", check_id) }
}

/// List users.
pub fn users_list() -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Get, path: "/api/users".to_string() }
}

/// Create a service user.
pub fn user_create() -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Post, path: "/api/users".to_string() }
}

/// Update a user.
pub fn user_update(user_id: &str) -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Put, path: format!("/api/users/{}", user_id) }
}

/// Delete a user.
pub fn user_delete(user_id: &str) -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Delete, path: format!("/api/users/{}", user_id) }
}

/// List account events.
pub fn events_list() -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Get, path: "/api/events".to_string() }
}

/// Get account info.
pub fn account_get() -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Get, path: "/api/accounts".to_string() }
}

/// Update account settings.
pub fn account_update(account_id: &str) -> ApiEndpoint {
    ApiEndpoint { method: HttpMethod::Put, path: format!("/api/accounts/{}", account_id) }
}

// ── Request / Response types for the API ────────────────────────

/// Request to create or update a group via the API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupRequest {
    pub name: String,
    pub peers: Vec<String>,
}

/// Request to create a route via the API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteRequest {
    pub description: String,
    pub network_id: String,
    pub network: String,
    pub enabled: bool,
    pub peer: Option<String>,
    pub peer_groups: Option<Vec<String>>,
    pub metric: u32,
    pub masquerade: bool,
    pub groups: Vec<String>,
    pub keep_route: bool,
}

/// Request to create a setup key via the API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetupKeyRequest {
    pub name: String,
    #[serde(rename = "type")]
    pub key_type: String,
    pub expires_in: u64,
    pub auto_groups: Vec<String>,
    pub usage_limit: u32,
    pub ephemeral: bool,
}

/// Request to create a policy via the API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyRequest {
    pub name: String,
    pub description: String,
    pub enabled: bool,
    pub rules: Vec<PolicyRuleRequest>,
    pub source_posture_checks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyRuleRequest {
    pub name: String,
    pub description: String,
    pub enabled: bool,
    pub action: String,
    pub bidirectional: bool,
    pub protocol: String,
    pub ports: Vec<String>,
    pub sources: Vec<String>,
    pub destinations: Vec<String>,
}

/// Build an authorization header value.
pub fn auth_header(token: &str) -> String {
    format!("Token {}", token)
}

/// Build a full URL from the config and an endpoint.
pub fn build_url(config: &ManagementApiConfig, endpoint: &ApiEndpoint) -> String {
    format!("{}{}", config.base_url.trim_end_matches('/'), endpoint.path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_endpoint_paths() {
        assert_eq!(peers_list().path, "/api/peers");
        assert_eq!(peer_get("abc").path, "/api/peers/abc");
        assert_eq!(groups_list().path, "/api/groups");
        assert_eq!(routes_list().path, "/api/routes");
        assert_eq!(policies_list().path, "/api/policies");
        assert_eq!(setup_keys_list().path, "/api/setup-keys");
        assert_eq!(posture_checks_list().path, "/api/posture-checks");
        assert_eq!(users_list().path, "/api/users");
        assert_eq!(events_list().path, "/api/events");
    }

    #[test]
    fn test_build_url() {
        let config = ManagementApiConfig {
            base_url: "https://api.netbird.io".into(),
            token: "tok".into(),
            timeout_secs: 30,
        };
        assert_eq!(build_url(&config, &peers_list()), "https://api.netbird.io/api/peers");
    }

    #[test]
    fn test_auth_header() {
        assert_eq!(auth_header("my-token"), "Token my-token");
    }
}
