//! Component health / status rollup helpers.

use crate::types::ComponentHealth;

/// Aggregate multiple component health statuses into a single rollup.
pub fn rollup_health(statuses: &[&ComponentHealth]) -> String {
    let mut has_critical = false;
    let mut has_warning = false;

    for s in statuses {
        match s.health.as_deref() {
            Some("Critical") => has_critical = true,
            Some("Warning") => has_warning = true,
            _ => {}
        }
    }

    if has_critical {
        "Critical".to_string()
    } else if has_warning {
        "Warning".to_string()
    } else {
        "OK".to_string()
    }
}

/// Check whether a component is enabled and healthy.
pub fn is_healthy(health: &ComponentHealth) -> bool {
    matches!(health.health.as_deref(), Some("OK") | None)
        && matches!(
            health.state.as_deref(),
            Some("Enabled") | Some("StandbyOffline") | None
        )
}
