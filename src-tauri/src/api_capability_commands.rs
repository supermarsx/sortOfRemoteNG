//! Tauri command surface for the REST API capability catalog.
//!
//! The catalog itself is declared statically in `api_capability.rs`.
//! Here we just serialize the `ALL_CAPABILITIES` slice and hand it to
//! the frontend on demand — the source of truth is Rust.
//!
//! `set_api_disabled_capabilities` reaches the running API server via
//! a [`DisabledCapsSetter`] function-trait-object the main app crate
//! registers in Tauri state at startup. This file is compiled as part
//! of `sorng-commands-core`, so the main app must register that exact
//! exported type in Tauri state. Tauri state is keyed by concrete type,
//! and registering a same-named type from another crate would not be
//! visible to this command.

use crate::api_capability::{CapabilityGroup, CapabilityMeta, ALL_CAPABILITIES};
use serde::Serialize;
use std::sync::Arc;

/// Bridge from the Tauri command layer to whatever owns the live
/// `disabled_capabilities` set inside the running API server. The main
/// app crate registers a concrete instance in
/// `state_registry::register_state` after constructing `ApiService`.
pub struct DisabledCapsSetter(pub Arc<dyn Fn(Vec<String>) + Send + Sync>);

/// Frontend-friendly capability descriptor.
///
/// Mirrors [`CapabilityMeta`] but converts the `&'static str` fields
/// into owned `String`s so it can cross the IPC boundary, and the
/// `group` discriminant into its kebab-case ID for direct use in
/// React/TypeScript.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiCapabilityDto {
    pub id: String,
    pub label: String,
    pub description: String,
    pub group: String,
    pub prefix: String,
    pub endpoints: Vec<String>,
    pub mandatory: bool,
}

fn group_id(group: CapabilityGroup) -> &'static str {
    match group {
        CapabilityGroup::CoreApi => "core-api",
        CapabilityGroup::Protocols => "protocols",
        CapabilityGroup::Cloud => "cloud",
        CapabilityGroup::Infrastructure => "infrastructure",
        CapabilityGroup::Network => "network",
    }
}

fn to_dto(meta: &CapabilityMeta) -> ApiCapabilityDto {
    ApiCapabilityDto {
        id: meta.id.to_string(),
        label: meta.label.to_string(),
        description: meta.description.to_string(),
        group: group_id(meta.group).to_string(),
        prefix: meta.prefix.to_string(),
        endpoints: meta.endpoints.iter().map(|s| s.to_string()).collect(),
        mandatory: meta.mandatory,
    }
}

/// Return the full REST API capability catalog. Always returns the
/// complete list — disabling a capability happens entirely via
/// `settings.restApi.disabledCapabilities`, not by removing entries
/// here.
#[tauri::command]
pub fn get_api_capabilities() -> Vec<ApiCapabilityDto> {
    ALL_CAPABILITIES.iter().map(to_dto).collect()
}

/// Push the user's current disabled-capability list into the running
/// API server. Called whenever the frontend toggles a capability so
/// the change takes effect without a server restart.
///
/// Mandatory capabilities passed in the list are silently filtered
/// out by the underlying `ApiService::set_disabled_capabilities`.
///
/// Returns an error if no `DisabledCapsSetter` has been registered so
/// the frontend cannot silently believe a live access-control update
/// succeeded when the running API gate was not actually changed.
#[tauri::command]
pub fn set_api_disabled_capabilities(
    app: tauri::AppHandle,
    disabled: Vec<String>,
) -> Result<(), String> {
    use tauri::Manager;
    let setter = app.try_state::<DisabledCapsSetter>().ok_or_else(|| {
        "REST API capability updater is unavailable; live capability changes were not applied"
            .to_string()
    })?;
    (setter.0)(disabled);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dto_has_one_entry_per_catalog_entry() {
        let dto = get_api_capabilities();
        assert_eq!(dto.len(), ALL_CAPABILITIES.len());
    }

    #[test]
    fn mandatory_entries_round_trip() {
        let dto = get_api_capabilities();
        let mandatory: Vec<_> = dto.iter().filter(|d| d.mandatory).collect();
        assert_eq!(mandatory.len(), 2);
        assert!(mandatory.iter().any(|d| d.id == "health"));
        assert!(mandatory.iter().any(|d| d.id == "auth"));
    }

    #[test]
    fn groups_are_kebab_case_strings() {
        let dto = get_api_capabilities();
        for d in &dto {
            assert!(
                matches!(
                    d.group.as_str(),
                    "core-api" | "protocols" | "cloud" | "infrastructure" | "network"
                ),
                "unknown group id {}",
                d.group
            );
        }
    }
}
