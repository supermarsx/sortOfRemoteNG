use crate::types::*;

/// Return the full list of built-in filter presets (17 presets).
pub fn get_built_in_presets() -> Vec<FilterPreset> {
    vec![
        // ── Recently Used ───────────────────────────────────────
        preset(
            "recently-used",
            "Recently Used",
            PresetCategory::RecentlyUsed,
            "Connections used in the last 7 days",
            vec![FilterCondition {
                field: FilterField::LastConnected,
                operator: FilterOperator::NewerThan,
                value: FilterValue::Duration(DurationValue {
                    amount: 7,
                    unit: DurationUnit::Days,
                }),
                negate: false,
            }],
            Some(SortField::LastConnected),
            SortOrder::Descending,
        ),
        // ── Recently Added ──────────────────────────────────────
        preset(
            "recently-added",
            "Recently Added",
            PresetCategory::ByAge,
            "Connections created in the last 14 days",
            vec![FilterCondition {
                field: FilterField::CreatedAt,
                operator: FilterOperator::NewerThan,
                value: FilterValue::Duration(DurationValue {
                    amount: 14,
                    unit: DurationUnit::Days,
                }),
                negate: false,
            }],
            Some(SortField::CreatedAt),
            SortOrder::Descending,
        ),
        // ── Favorites ───────────────────────────────────────────
        preset(
            "favorites",
            "Favorites",
            PresetCategory::Favorites,
            "Connections marked as favorite",
            vec![FilterCondition {
                field: FilterField::Favorite,
                operator: FilterOperator::Equals,
                value: FilterValue::Boolean(true),
                negate: false,
            }],
            Some(SortField::Name),
            SortOrder::Ascending,
        ),
        // ── Never Connected ─────────────────────────────────────
        preset(
            "never-connected",
            "Never Connected",
            PresetCategory::ByStatus,
            "Connections that have never been used",
            vec![FilterCondition {
                field: FilterField::ConnectionCount,
                operator: FilterOperator::Equals,
                value: FilterValue::Number(0.0),
                negate: false,
            }],
            Some(SortField::CreatedAt),
            SortOrder::Descending,
        ),
        // ── Stale Connections ───────────────────────────────────
        preset(
            "stale-connections",
            "Stale Connections",
            PresetCategory::ByAge,
            "Connections not used in the last 90 days",
            vec![FilterCondition {
                field: FilterField::LastConnected,
                operator: FilterOperator::OlderThan,
                value: FilterValue::Duration(DurationValue {
                    amount: 90,
                    unit: DurationUnit::Days,
                }),
                negate: false,
            }],
            Some(SortField::LastConnected),
            SortOrder::Ascending,
        ),
        // ── SSH Connections ─────────────────────────────────────
        preset(
            "ssh-connections",
            "SSH Connections",
            PresetCategory::ByProtocol,
            "All SSH connections",
            vec![FilterCondition {
                field: FilterField::Protocol,
                operator: FilterOperator::Equals,
                value: FilterValue::String("ssh".into()),
                negate: false,
            }],
            Some(SortField::Name),
            SortOrder::Ascending,
        ),
        // ── RDP Connections ─────────────────────────────────────
        preset(
            "rdp-connections",
            "RDP Connections",
            PresetCategory::ByProtocol,
            "All RDP connections",
            vec![FilterCondition {
                field: FilterField::Protocol,
                operator: FilterOperator::Equals,
                value: FilterValue::String("rdp".into()),
                negate: false,
            }],
            Some(SortField::Name),
            SortOrder::Ascending,
        ),
        // ── VNC Connections ─────────────────────────────────────
        preset(
            "vnc-connections",
            "VNC Connections",
            PresetCategory::ByProtocol,
            "All VNC connections",
            vec![FilterCondition {
                field: FilterField::Protocol,
                operator: FilterOperator::Equals,
                value: FilterValue::String("vnc".into()),
                negate: false,
            }],
            Some(SortField::Name),
            SortOrder::Ascending,
        ),
        // ── Database Connections ────────────────────────────────
        preset(
            "database-connections",
            "Database Connections",
            PresetCategory::ByProtocol,
            "MySQL, PostgreSQL, MSSQL, MongoDB, Redis, SQLite",
            vec![FilterCondition {
                field: FilterField::Protocol,
                operator: FilterOperator::In,
                value: FilterValue::StringList(vec![
                    "mysql".into(),
                    "postgres".into(),
                    "mssql".into(),
                    "mongodb".into(),
                    "redis".into(),
                    "sqlite".into(),
                ]),
                negate: false,
            }],
            Some(SortField::Protocol),
            SortOrder::Ascending,
        ),
        // ── Web Connections ─────────────────────────────────────
        preset(
            "web-connections",
            "Web Connections",
            PresetCategory::ByProtocol,
            "HTTP and HTTPS connections",
            vec![FilterCondition {
                field: FilterField::Protocol,
                operator: FilterOperator::In,
                value: FilterValue::StringList(vec![
                    "http".into(),
                    "https".into(),
                ]),
                negate: false,
            }],
            Some(SortField::Name),
            SortOrder::Ascending,
        ),
        // ── File Transfer ───────────────────────────────────────
        preset(
            "file-transfer",
            "File Transfer",
            PresetCategory::ByProtocol,
            "FTP, SFTP, and SCP connections",
            vec![FilterCondition {
                field: FilterField::Protocol,
                operator: FilterOperator::In,
                value: FilterValue::StringList(vec![
                    "ftp".into(),
                    "sftp".into(),
                    "scp".into(),
                ]),
                negate: false,
            }],
            Some(SortField::Name),
            SortOrder::Ascending,
        ),
        // ── Online Now ──────────────────────────────────────────
        preset(
            "online-now",
            "Online Now",
            PresetCategory::ByStatus,
            "Connections currently online",
            vec![FilterCondition {
                field: FilterField::Status,
                operator: FilterOperator::Equals,
                value: FilterValue::String("online".into()),
                negate: false,
            }],
            Some(SortField::Name),
            SortOrder::Ascending,
        ),
        // ── Offline ─────────────────────────────────────────────
        preset(
            "offline",
            "Offline",
            PresetCategory::ByStatus,
            "Connections currently offline",
            vec![FilterCondition {
                field: FilterField::Status,
                operator: FilterOperator::Equals,
                value: FilterValue::String("offline".into()),
                negate: false,
            }],
            Some(SortField::Name),
            SortOrder::Ascending,
        ),
        // ── Has Proxy / Tunnel ──────────────────────────────────
        preset(
            "has-proxy-tunnel",
            "Has Proxy/Tunnel",
            PresetCategory::Security,
            "Connections with a proxy or tunnel configured",
            vec![
                FilterCondition {
                    field: FilterField::HasProxy,
                    operator: FilterOperator::Equals,
                    value: FilterValue::Boolean(true),
                    negate: false,
                },
                FilterCondition {
                    field: FilterField::HasTunnel,
                    operator: FilterOperator::Equals,
                    value: FilterValue::Boolean(true),
                    negate: false,
                },
            ],
            Some(SortField::Name),
            SortOrder::Ascending,
        ),
        // ── No Authentication ───────────────────────────────────
        preset(
            "no-auth",
            "No Authentication",
            PresetCategory::Security,
            "Connections with no authentication configured",
            vec![FilterCondition {
                field: FilterField::AuthType,
                operator: FilterOperator::In,
                value: FilterValue::StringList(vec![
                    "none".into(),
                    "".into(),
                ]),
                negate: false,
            }],
            Some(SortField::Name),
            SortOrder::Ascending,
        ),
        // ── Cloud Connections ───────────────────────────────────
        preset(
            "cloud-connections",
            "Cloud Connections",
            PresetCategory::ByProtocol,
            "AWS, Azure, GCP tagged connections",
            vec![FilterCondition {
                field: FilterField::Tags,
                operator: FilterOperator::Matches,
                value: FilterValue::String(r"(?i)\b(aws|azure|gcp|cloud)\b".into()),
                negate: false,
            }],
            Some(SortField::Name),
            SortOrder::Ascending,
        ),
        // ── Local Network ───────────────────────────────────────
        preset(
            "local-network",
            "Local Network",
            PresetCategory::ByStatus,
            "Hosts on 192.168.x.x or 10.x.x.x",
            vec![FilterCondition {
                field: FilterField::Hostname,
                operator: FilterOperator::Matches,
                value: FilterValue::String(r"^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)".into()),
                negate: false,
            }],
            Some(SortField::Hostname),
            SortOrder::Ascending,
        ),
    ]
}

// ── Helper ──────────────────────────────────────────────────────

fn preset(
    id: &str,
    name: &str,
    category: PresetCategory,
    description: &str,
    conditions: Vec<FilterCondition>,
    sort_by: Option<SortField>,
    sort_order: SortOrder,
) -> FilterPreset {
    let now = chrono::Utc::now().to_rfc3339();
    // Has Proxy/Tunnel uses OR logic (either proxy or tunnel)
    let logic = if id == "has-proxy-tunnel" {
        FilterLogic::Or
    } else {
        FilterLogic::And
    };
    FilterPreset {
        id: format!("preset-{id}"),
        name: name.to_string(),
        category,
        filter: SmartFilter {
            id: format!("preset-{id}"),
            name: name.to_string(),
            description: description.to_string(),
            icon: None,
            color: None,
            conditions,
            logic,
            sort_by,
            sort_order,
            limit: None,
            pinned: false,
            built_in: true,
            created_at: now.clone(),
            updated_at: now,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_built_in_presets_count() {
        let presets = get_built_in_presets();
        assert!(presets.len() >= 15, "Expected at least 15 presets, got {}", presets.len());
    }

    #[test]
    fn test_all_presets_are_built_in() {
        for p in get_built_in_presets() {
            assert!(p.filter.built_in, "Preset '{}' should be built_in", p.name);
        }
    }

    #[test]
    fn test_preset_ids_are_unique() {
        let presets = get_built_in_presets();
        let mut ids: Vec<&str> = presets.iter().map(|p| p.id.as_str()).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), presets.len(), "Duplicate preset IDs detected");
    }
}
