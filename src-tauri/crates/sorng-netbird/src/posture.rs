//! # NetBird Posture Checks
//!
//! Helpers for posture check management — building check definitions,
//! evaluating constraints, and summarizing posture compliance.

use crate::types::*;
use serde::{Deserialize, Serialize};

/// Validate that a posture check definition is well-formed.
pub fn validate_posture_check(check: &PostureCheck) -> Vec<String> {
    let mut issues = Vec::new();
    if check.name.is_empty() {
        issues.push("Posture check name cannot be empty".to_string());
    }
    let d = &check.checks;
    let has_any = d.nb_version_check.is_some()
        || d.os_version_check.is_some()
        || d.geo_location_check.is_some()
        || d.peer_network_range_check.is_some()
        || d.process_check.is_some();
    if !has_any {
        issues.push("Posture check must define at least one check type".to_string());
    }
    if let Some(ref geo) = d.geo_location_check {
        if geo.locations.is_empty() {
            issues.push("Geo-location check must specify at least one location".to_string());
        }
        for loc in &geo.locations {
            if loc.country_code.len() != 2 {
                issues.push(format!(
                    "Country code '{}' is not a valid ISO 3166-1 alpha-2 code",
                    loc.country_code
                ));
            }
        }
    }
    if let Some(ref net) = d.peer_network_range_check {
        if net.ranges.is_empty() {
            issues.push("Peer network range check must specify at least one CIDR range".to_string());
        }
    }
    if let Some(ref proc) = d.process_check {
        if proc.processes.is_empty() {
            issues.push("Process check must specify at least one process".to_string());
        }
        for p in &proc.processes {
            if p.linux_path.is_none() && p.mac_path.is_none() && p.windows_path.is_none() {
                issues.push("Process check entry must have at least one platform path".to_string());
            }
        }
    }
    issues
}

/// Build a simple NetBird-version posture check.
pub fn nb_version_check(name: &str, min_version: &str) -> PostureCheck {
    PostureCheck {
        id: String::new(),
        name: name.to_string(),
        description: format!("Require NetBird >= {}", min_version),
        checks: PostureCheckDetail {
            nb_version_check: Some(NbVersionCheck {
                min_version: min_version.to_string(),
            }),
            os_version_check: None,
            geo_location_check: None,
            peer_network_range_check: None,
            process_check: None,
        },
    }
}

/// Build a geo-location posture check.
pub fn geo_location_check(
    name: &str,
    action: GeoAction,
    locations: Vec<(&str, Option<&str>)>,
) -> PostureCheck {
    PostureCheck {
        id: String::new(),
        name: name.to_string(),
        description: format!("{:?} connections from specified locations", action),
        checks: PostureCheckDetail {
            nb_version_check: None,
            os_version_check: None,
            geo_location_check: Some(GeoLocationCheck {
                action,
                locations: locations
                    .into_iter()
                    .map(|(cc, city)| GeoLocation {
                        country_code: cc.to_string(),
                        city_name: city.map(|c| c.to_string()),
                    })
                    .collect(),
            }),
            peer_network_range_check: None,
            process_check: None,
        },
    }
}

/// Summary of posture check usage.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostureSummary {
    pub total: u32,
    pub with_version_check: u32,
    pub with_os_check: u32,
    pub with_geo_check: u32,
    pub with_network_check: u32,
    pub with_process_check: u32,
}

pub fn summarize_posture_checks(checks: &[&PostureCheck]) -> PostureSummary {
    PostureSummary {
        total: checks.len() as u32,
        with_version_check: checks.iter().filter(|c| c.checks.nb_version_check.is_some()).count() as u32,
        with_os_check: checks.iter().filter(|c| c.checks.os_version_check.is_some()).count() as u32,
        with_geo_check: checks.iter().filter(|c| c.checks.geo_location_check.is_some()).count() as u32,
        with_network_check: checks
            .iter()
            .filter(|c| c.checks.peer_network_range_check.is_some())
            .count() as u32,
        with_process_check: checks.iter().filter(|c| c.checks.process_check.is_some()).count() as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_posture_check_ok() {
        let check = nb_version_check("min-ver", "0.28.0");
        assert!(validate_posture_check(&check).is_empty());
    }

    #[test]
    fn test_validate_posture_check_empty() {
        let check = PostureCheck {
            id: "".into(),
            name: "".into(),
            description: "".into(),
            checks: PostureCheckDetail {
                nb_version_check: None,
                os_version_check: None,
                geo_location_check: None,
                peer_network_range_check: None,
                process_check: None,
            },
        };
        let issues = validate_posture_check(&check);
        assert!(issues.len() >= 2); // empty name + no checks
    }

    #[test]
    fn test_geo_location_check_builder() {
        let check = geo_location_check("geo", GeoAction::Allow, vec![("US", Some("New York")), ("DE", None)]);
        let geo = check.checks.geo_location_check.unwrap();
        assert_eq!(geo.locations.len(), 2);
        assert_eq!(geo.action, GeoAction::Allow);
    }
}
