// ── sorng-docker-compose/src/profiles.rs ───────────────────────────────────────
//! Profile analysis and management for compose files.

use std::collections::{HashMap, HashSet};

use crate::types::*;

/// Analyses and manages compose profiles.
pub struct ProfileManager;

impl ProfileManager {
    /// Extract all profiles defined across all services.
    pub fn list_profiles(compose: &ComposeFile) -> Vec<ComposeProfile> {
        let mut profile_map: HashMap<String, Vec<String>> = HashMap::new();

        for (name, svc) in &compose.services {
            for p in &svc.profiles {
                profile_map
                    .entry(p.clone())
                    .or_default()
                    .push(name.clone());
            }
        }

        let mut profiles: Vec<ComposeProfile> = profile_map
            .into_iter()
            .map(|(name, services)| ComposeProfile { name, services })
            .collect();
        profiles.sort_by(|a, b| a.name.cmp(&b.name));
        profiles
    }

    /// Get all profile names.
    pub fn profile_names(compose: &ComposeFile) -> Vec<String> {
        let mut names: HashSet<String> = HashSet::new();
        for svc in compose.services.values() {
            for p in &svc.profiles {
                names.insert(p.clone());
            }
        }
        let mut result: Vec<String> = names.into_iter().collect();
        result.sort();
        result
    }

    /// Filter services to those active for the given set of profiles.
    /// Services with no profiles are always active.
    /// Services with profiles are active only if at least one of their profiles
    /// is in the active set.
    pub fn active_services(
        compose: &ComposeFile,
        active_profiles: &[String],
    ) -> Vec<String> {
        let active_set: HashSet<&str> = active_profiles.iter().map(|s| s.as_str()).collect();
        let mut result = Vec::new();

        for (name, svc) in &compose.services {
            if svc.profiles.is_empty() {
                // No profiles = always active
                result.push(name.clone());
            } else if svc.profiles.iter().any(|p| active_set.contains(p.as_str())) {
                result.push(name.clone());
            }
        }

        result
    }

    /// Get services that would NOT be started without explicitly activating
    /// their profiles.
    pub fn profile_only_services(compose: &ComposeFile) -> Vec<String> {
        compose
            .services
            .iter()
            .filter(|(_, svc)| !svc.profiles.is_empty())
            .map(|(name, _)| name.clone())
            .collect()
    }

    /// Validate that service dependencies respect profile boundaries —
    /// a service without profiles should not depend on a profile-only service
    /// that isn't in the active profile set.
    pub fn validate_profile_deps(
        compose: &ComposeFile,
        active_profiles: &[String],
    ) -> Vec<String> {
        let active = Self::active_services(compose, active_profiles);
        let active_set: HashSet<&str> = active.iter().map(|s| s.as_str()).collect();
        let mut warnings = Vec::new();

        for (name, svc) in &compose.services {
            if !active_set.contains(name.as_str()) {
                continue;
            }
            let deps = match &svc.depends_on {
                Some(DependsOn::List(list)) => list.clone(),
                Some(DependsOn::Map(map)) => map.keys().cloned().collect(),
                None => vec![],
            };
            for dep in &deps {
                if !active_set.contains(dep.as_str()) {
                    warnings.push(format!(
                        "Service '{}' depends on '{}' which is inactive (requires profile activation)",
                        name, dep
                    ));
                }
            }
        }

        warnings
    }
}
