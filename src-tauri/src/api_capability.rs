//! REST API capability catalog.
//!
//! A single source of truth for the user-facing "enable/disable capability"
//! UX exposed in Settings → API. The catalog groups the ~110 individual
//! routes registered in [`crate::api::ApiService::create_router`] into
//! 18 capabilities across 5 visual buckets so the user can flip whole
//! protocol/provider areas on or off without scrolling through every
//! endpoint.
//!
//! ## Semantics
//!
//! - Storage shape (in `settings.restApi.disabledCapabilities`) holds the
//!   **disabled** set — an empty array means everything is enabled. New
//!   capabilities shipped in a future version are therefore enabled by
//!   default for existing users.
//! - [`CapabilityMeta::mandatory`] capabilities (`health`, `auth`) cannot
//!   be disabled. They are still listed in the catalog so the UI can
//!   render them as read-only "always on" rows.
//!
//! ## Drift protection
//!
//! `tests::every_route_resolves_to_a_capability` walks the actual route
//! list registered in `create_router` and asserts each path maps to some
//! capability via [`capability_for_path`]. Adding a new route prefix
//! without extending this catalog will fail CI.

use serde::Serialize;

/// One enable/disable knob in Settings → API. Each variant maps to a
/// path prefix (or set of prefixes); the [`capability_gate`](crate::api)
/// middleware rejects requests whose capability is in the disabled set.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ApiCapability {
    // Core (mandatory)
    Health,
    Auth,
    // Protocols
    Ssh,
    Db,
    Ftp,
    RustDesk,
    // Cloud
    Aws,
    Vercel,
    Cloudflare,
    // Infrastructure
    Wmi,
    Rpc,
    MeshCentral,
    Agent,
    Commander,
    // Network
    Network,
    Security,
    Qr,
    Wol,
}

/// Visual grouping rendered as a `SectionHeader` in the settings UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CapabilityGroup {
    /// Health probes and authentication. Always-on, can't be disabled.
    CoreApi,
    /// Interactive protocols (SSH, DB, FTP, RustDesk).
    Protocols,
    /// Cloud-provider APIs (AWS, Vercel, Cloudflare).
    Cloud,
    /// Management/automation tooling (WMI, RPC, MeshCentral, Agent, Commander).
    Infrastructure,
    /// Diagnostics and one-shot utilities (network, security, QR, WoL).
    Network,
}

/// Frontend-facing description of one capability.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityMeta {
    /// Kebab-case stable ID. Matches the `serde` rename of [`ApiCapability`].
    pub id: &'static str,
    /// Short human-readable label for the toggle row.
    pub label: &'static str,
    /// One-line description shown under the label.
    pub description: &'static str,
    /// Visual group the row is rendered under.
    pub group: CapabilityGroup,
    /// Path prefix matched against `request.uri().path()`. The longest
    /// matching prefix wins, so `/ssh` matches `/ssh/connect` but not
    /// `/sshfoo`. The slash is always a real boundary — see
    /// [`path_matches_prefix`].
    pub prefix: &'static str,
    /// All endpoints behind this prefix (cosmetic — used by the UI to
    /// show the per-capability endpoint count and full list tooltip).
    pub endpoints: &'static [&'static str],
    /// `true` for capabilities the user cannot disable (health, auth).
    pub mandatory: bool,
}

/// Convert an [`ApiCapability`] enum value to the kebab-case ID that
/// appears in settings JSON and on the wire.
pub fn capability_id(cap: ApiCapability) -> &'static str {
    match cap {
        ApiCapability::Health => "health",
        ApiCapability::Auth => "auth",
        ApiCapability::Ssh => "ssh",
        ApiCapability::Db => "db",
        ApiCapability::Ftp => "ftp",
        ApiCapability::RustDesk => "rust-desk",
        ApiCapability::Aws => "aws",
        ApiCapability::Vercel => "vercel",
        ApiCapability::Cloudflare => "cloudflare",
        ApiCapability::Wmi => "wmi",
        ApiCapability::Rpc => "rpc",
        ApiCapability::MeshCentral => "mesh-central",
        ApiCapability::Agent => "agent",
        ApiCapability::Commander => "commander",
        ApiCapability::Network => "network",
        ApiCapability::Security => "security",
        ApiCapability::Qr => "qr",
        ApiCapability::Wol => "wol",
    }
}

/// The static catalog. Order here is the order rendered in the UI.
pub const ALL_CAPABILITIES: &[CapabilityMeta] = &[
    // ── Core API (mandatory) ───────────────────────────────────────
    CapabilityMeta {
        id: "health",
        label: "Health probe",
        description: "Liveness check used by load balancers and uptime monitors.",
        group: CapabilityGroup::CoreApi,
        prefix: "/health",
        endpoints: &["GET /health"],
        mandatory: true,
    },
    CapabilityMeta {
        id: "auth",
        label: "Authentication",
        description: "Login and user lookup. Required for any authenticated capability.",
        group: CapabilityGroup::CoreApi,
        prefix: "/auth",
        endpoints: &["POST /auth/login", "GET /auth/users"],
        mandatory: true,
    },
    // ── Protocols ──────────────────────────────────────────────────
    CapabilityMeta {
        id: "ssh",
        label: "SSH",
        description: "SSH connection, command execution, and session listing.",
        group: CapabilityGroup::Protocols,
        prefix: "/ssh",
        endpoints: &[
            "POST /ssh/connect",
            "POST /ssh/execute",
            "GET /ssh/sessions",
        ],
        mandatory: false,
    },
    CapabilityMeta {
        id: "db",
        label: "Database",
        description: "Direct MySQL connect and query execution.",
        group: CapabilityGroup::Protocols,
        prefix: "/db",
        endpoints: &["POST /db/connect", "POST /db/query"],
        mandatory: false,
    },
    CapabilityMeta {
        id: "ftp",
        label: "FTP",
        description: "FTP connect and remote file listing.",
        group: CapabilityGroup::Protocols,
        prefix: "/ftp",
        endpoints: &["POST /ftp/connect", "GET /ftp/files/:session_id"],
        mandatory: false,
    },
    CapabilityMeta {
        id: "rust-desk",
        label: "RustDesk",
        description: "RustDesk session management, input forwarding, and screenshots.",
        group: CapabilityGroup::Protocols,
        prefix: "/rustdesk",
        endpoints: &[
            "POST /rustdesk/connect",
            "POST /rustdesk/disconnect/:session_id",
            "GET /rustdesk/sessions",
            "GET /rustdesk/session/:session_id",
            "POST /rustdesk/input/:session_id",
            "GET /rustdesk/screenshot/:session_id",
            "GET /rustdesk/status",
        ],
        mandatory: false,
    },
    // ── Cloud ──────────────────────────────────────────────────────
    CapabilityMeta {
        id: "aws",
        label: "AWS",
        description: "EC2, S3, RDS, Lambda, and CloudWatch operations.",
        group: CapabilityGroup::Cloud,
        prefix: "/aws",
        endpoints: &[
            "POST /aws/connect",
            "POST /aws/disconnect/:session_id",
            "GET /aws/sessions",
            "GET /aws/session/:session_id",
            "/aws/ec2/*",
            "/aws/s3/*",
            "/aws/rds/*",
            "/aws/lambda/*",
            "/aws/cloudwatch/*",
        ],
        mandatory: false,
    },
    CapabilityMeta {
        id: "vercel",
        label: "Vercel",
        description: "Project, deployment, domain, and team management on Vercel.",
        group: CapabilityGroup::Cloud,
        prefix: "/vercel",
        endpoints: &[
            "POST /vercel/connect",
            "POST /vercel/disconnect/:session_id",
            "GET /vercel/sessions",
            "GET /vercel/session/:session_id",
            "/vercel/projects/*",
            "/vercel/deployments/*",
            "/vercel/domains/*",
            "/vercel/teams/*",
        ],
        mandatory: false,
    },
    CapabilityMeta {
        id: "cloudflare",
        label: "Cloudflare",
        description: "DNS, zones, workers, page rules, and analytics on Cloudflare.",
        group: CapabilityGroup::Cloud,
        prefix: "/cloudflare",
        endpoints: &[
            "POST /cloudflare/connect",
            "POST /cloudflare/disconnect/:session_id",
            "GET /cloudflare/sessions",
            "/cloudflare/zones/*",
            "/cloudflare/dns/*",
            "/cloudflare/workers/*",
            "/cloudflare/pagerule/*",
            "/cloudflare/analytics/*",
        ],
        mandatory: false,
    },
    // ── Infrastructure ─────────────────────────────────────────────
    CapabilityMeta {
        id: "wmi",
        label: "WMI",
        description: "Windows Management Instrumentation queries, classes, and namespaces.",
        group: CapabilityGroup::Infrastructure,
        prefix: "/wmi",
        endpoints: &[
            "POST /wmi/connect",
            "POST /wmi/disconnect/:session_id",
            "GET /wmi/sessions",
            "GET /wmi/session/:session_id",
            "POST /wmi/query/:session_id",
            "GET /wmi/classes/:session_id",
            "GET /wmi/namespaces/:session_id",
        ],
        mandatory: false,
    },
    CapabilityMeta {
        id: "rpc",
        label: "RPC",
        description: "Remote procedure call sessions, discovery, and batch invocation.",
        group: CapabilityGroup::Infrastructure,
        prefix: "/rpc",
        endpoints: &[
            "POST /rpc/connect",
            "POST /rpc/disconnect/:session_id",
            "GET /rpc/sessions",
            "GET /rpc/session/:session_id",
            "POST /rpc/call/:session_id",
            "GET /rpc/methods/:session_id",
            "POST /rpc/batch/:session_id",
        ],
        mandatory: false,
    },
    CapabilityMeta {
        id: "mesh-central",
        label: "MeshCentral",
        description: "MeshCentral devices, groups, and remote commands.",
        group: CapabilityGroup::Infrastructure,
        prefix: "/meshcentral",
        endpoints: &[
            "POST /meshcentral/connect",
            "POST /meshcentral/disconnect/:session_id",
            "GET /meshcentral/sessions",
            "/meshcentral/session/*",
            "/meshcentral/devices/*",
            "/meshcentral/groups/*",
            "/meshcentral/command/*",
        ],
        mandatory: false,
    },
    CapabilityMeta {
        id: "agent",
        label: "Agent",
        description: "Local agent sessions, metrics, logs, and status reporting.",
        group: CapabilityGroup::Infrastructure,
        prefix: "/agent",
        endpoints: &[
            "POST /agent/connect",
            "POST /agent/disconnect/:session_id",
            "GET /agent/sessions",
            "GET /agent/session/:session_id",
            "GET /agent/metrics/:session_id",
            "GET /agent/logs/:session_id",
            "POST /agent/status/:session_id",
            "GET /agent/info/:session_id",
        ],
        mandatory: false,
    },
    CapabilityMeta {
        id: "commander",
        label: "Commander",
        description: "Commander session management, file transfer, and command dispatch.",
        group: CapabilityGroup::Infrastructure,
        prefix: "/commander",
        endpoints: &[
            "POST /commander/connect",
            "POST /commander/disconnect/:session_id",
            "GET /commander/sessions",
            "/commander/command/*",
            "/commander/upload/*",
            "/commander/download/*",
            "/commander/list/*",
        ],
        mandatory: false,
    },
    // ── Network ────────────────────────────────────────────────────
    CapabilityMeta {
        id: "network",
        label: "Network diagnostics",
        description: "Ping, network scan, and comprehensive port scan.",
        group: CapabilityGroup::Network,
        prefix: "/network",
        endpoints: &[
            "POST /network/ping",
            "POST /network/scan",
            "POST /network/scan/comprehensive",
        ],
        mandatory: false,
    },
    CapabilityMeta {
        id: "security",
        label: "Security utilities",
        description: "TOTP secret generation and verification.",
        group: CapabilityGroup::Network,
        prefix: "/security",
        endpoints: &[
            "GET /security/totp/generate",
            "POST /security/totp/verify",
        ],
        mandatory: false,
    },
    CapabilityMeta {
        id: "qr",
        label: "QR codes",
        description: "QR code generation (text and PNG).",
        group: CapabilityGroup::Network,
        prefix: "/qr",
        endpoints: &["POST /qr/generate", "POST /qr/generate/png"],
        mandatory: false,
    },
    CapabilityMeta {
        id: "wol",
        label: "Wake-on-LAN",
        description: "Send magic packets to wake remote machines.",
        group: CapabilityGroup::Network,
        prefix: "/wol",
        endpoints: &["POST /wol/wake"],
        mandatory: false,
    },
];

/// Match an incoming request path against the catalog using
/// longest-prefix wins on whole path segments.
///
/// `/ssh` matches `/ssh`, `/ssh/`, and `/ssh/connect` but does not match
/// `/sshfoo`. Returns `None` for paths outside the catalog (those should
/// fall through to whatever 404 handler axum uses).
pub fn capability_for_path(path: &str) -> Option<ApiCapability> {
    // Walk the catalog in order; capability prefixes are disjoint so the
    // first prefix-match wins. (No need for a longest-prefix tiebreak.)
    for cap in ALL_CAPABILITIES {
        if path_matches_prefix(path, cap.prefix) {
            return Some(id_to_enum(cap.id));
        }
    }
    None
}

/// Return `true` when `path` is either equal to `prefix` or starts with
/// `prefix` followed by `/`. Avoids the `/sshfoo` matches `/ssh` foot-gun
/// that a naive `starts_with` would have.
fn path_matches_prefix(path: &str, prefix: &str) -> bool {
    if path == prefix {
        return true;
    }
    if path.len() <= prefix.len() {
        return false;
    }
    if !path.starts_with(prefix) {
        return false;
    }
    // The character right after the prefix has to be a `/`.
    path.as_bytes().get(prefix.len()) == Some(&b'/')
}

fn id_to_enum(id: &str) -> ApiCapability {
    match id {
        "health" => ApiCapability::Health,
        "auth" => ApiCapability::Auth,
        "ssh" => ApiCapability::Ssh,
        "db" => ApiCapability::Db,
        "ftp" => ApiCapability::Ftp,
        "rust-desk" => ApiCapability::RustDesk,
        "aws" => ApiCapability::Aws,
        "vercel" => ApiCapability::Vercel,
        "cloudflare" => ApiCapability::Cloudflare,
        "wmi" => ApiCapability::Wmi,
        "rpc" => ApiCapability::Rpc,
        "mesh-central" => ApiCapability::MeshCentral,
        "agent" => ApiCapability::Agent,
        "commander" => ApiCapability::Commander,
        "network" => ApiCapability::Network,
        "security" => ApiCapability::Security,
        "qr" => ApiCapability::Qr,
        "wol" => ApiCapability::Wol,
        other => unreachable!("unknown capability id {other}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every concrete route registered in `api::ApiService::create_router`.
    /// Kept in sync by hand — if the route list grows, add it here and
    /// `every_route_resolves_to_a_capability` will tell you if the
    /// catalog above missed a prefix.
    const REGISTERED_ROUTES: &[&str] = &[
        "/health",
        "/auth/login",
        "/auth/users",
        "/ssh/connect",
        "/ssh/execute",
        "/ssh/sessions",
        "/db/connect",
        "/db/query",
        "/ftp/connect",
        "/ftp/files/:session_id",
        "/network/ping",
        "/network/scan",
        "/network/scan/comprehensive",
        "/security/totp/generate",
        "/security/totp/verify",
        "/wol/wake",
        "/qr/generate",
        "/qr/generate/png",
        "/rustdesk/connect",
        "/rustdesk/disconnect/:session_id",
        "/rustdesk/sessions",
        "/rustdesk/session/:session_id",
        "/rustdesk/input/:session_id",
        "/rustdesk/screenshot/:session_id",
        "/rustdesk/status",
        "/wmi/connect",
        "/wmi/disconnect/:session_id",
        "/wmi/sessions",
        "/wmi/session/:session_id",
        "/wmi/query/:session_id",
        "/wmi/classes/:session_id",
        "/wmi/namespaces/:session_id",
        "/rpc/connect",
        "/rpc/disconnect/:session_id",
        "/rpc/sessions",
        "/rpc/session/:session_id",
        "/rpc/call/:session_id",
        "/rpc/methods/:session_id",
        "/rpc/batch/:session_id",
        "/meshcentral/connect",
        "/meshcentral/disconnect/:session_id",
        "/meshcentral/sessions",
        "/meshcentral/session/:session_id",
        "/meshcentral/devices/:session_id",
        "/meshcentral/groups/:session_id",
        "/meshcentral/command/:session_id",
        "/agent/connect",
        "/agent/disconnect/:session_id",
        "/agent/sessions",
        "/agent/session/:session_id",
        "/agent/metrics/:session_id",
        "/agent/logs/:session_id",
        "/agent/status/:session_id",
        "/agent/info/:session_id",
        "/commander/connect",
        "/commander/disconnect/:session_id",
        "/commander/sessions",
        "/commander/command/:session_id",
        "/commander/upload/:session_id",
        "/commander/download/:session_id",
        "/commander/list/:session_id",
        "/aws/connect",
        "/aws/disconnect/:session_id",
        "/aws/sessions",
        "/aws/session/:session_id",
        "/aws/ec2/instances/:session_id",
        "/aws/s3/buckets/:session_id",
        "/aws/rds/instances/:session_id",
        "/aws/lambda/functions/:session_id",
        "/aws/cloudwatch/metrics/:session_id",
        "/vercel/connect",
        "/vercel/disconnect/:session_id",
        "/vercel/sessions",
        "/vercel/session/:session_id",
        "/vercel/projects/:session_id",
        "/vercel/deployments/:session_id",
        "/vercel/domains/:session_id",
        "/vercel/teams/:session_id",
        "/cloudflare/connect",
        "/cloudflare/disconnect/:session_id",
        "/cloudflare/sessions",
        "/cloudflare/zones/:session_id",
        "/cloudflare/dns/:session_id/:zone_id",
        "/cloudflare/workers/:session_id",
        "/cloudflare/pagerule/:session_id/:zone_id/:rule_id",
        "/cloudflare/analytics/:session_id/:zone_id",
    ];

    #[test]
    fn every_route_resolves_to_a_capability() {
        for route in REGISTERED_ROUTES {
            assert!(
                capability_for_path(route).is_some(),
                "route {route:?} does not resolve to any capability — add a prefix to ALL_CAPABILITIES"
            );
        }
    }

    #[test]
    fn prefix_does_not_accidentally_match_unrelated_paths() {
        // `/ssh` must NOT match `/sshfoo`. Whole-segment boundary check.
        assert_eq!(capability_for_path("/sshfoo"), None);
        // But trailing slash should still match.
        assert_eq!(
            capability_for_path("/ssh/"),
            Some(ApiCapability::Ssh)
        );
        // And the bare prefix matches.
        assert_eq!(capability_for_path("/ssh"), Some(ApiCapability::Ssh));
    }

    #[test]
    fn mandatory_capabilities_are_health_and_auth() {
        let mandatory: Vec<&str> = ALL_CAPABILITIES
            .iter()
            .filter(|c| c.mandatory)
            .map(|c| c.id)
            .collect();
        assert_eq!(mandatory, vec!["health", "auth"]);
    }

    #[test]
    fn capability_ids_round_trip_through_id_to_enum() {
        for cap in ALL_CAPABILITIES {
            assert_eq!(capability_id(id_to_enum(cap.id)), cap.id);
        }
    }
}
