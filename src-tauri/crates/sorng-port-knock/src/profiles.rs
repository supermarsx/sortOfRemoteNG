use chrono::Utc;
use uuid::Uuid;

use crate::error::PortKnockError;
use crate::types::{
    FwknopClientConfig, FirewallRuleOptions, KnockMethod, KnockOptions, KnockProfile,
    KnockSequence, ProfileFormat, SpaOptions,
};

/// Manages saved knock profiles.
pub struct ProfileManager {
    profiles: Vec<KnockProfile>,
}

impl ProfileManager {
    pub fn new() -> Self {
        Self {
            profiles: Vec::new(),
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_profile(
        &mut self,
        name: String,
        description: String,
        method: KnockMethod,
        sequence: Option<KnockSequence>,
        spa_options: Option<SpaOptions>,
        fwknop_config: Option<FwknopClientConfig>,
        firewall_options: Option<FirewallRuleOptions>,
        knock_options: KnockOptions,
        tags: Vec<String>,
    ) -> Result<KnockProfile, PortKnockError> {
        if self.profiles.iter().any(|p| p.name == name) {
            return Err(PortKnockError::ProfileAlreadyExists(name));
        }

        let now = Utc::now();
        let profile = KnockProfile {
            id: Uuid::new_v4().to_string(),
            name,
            description,
            method,
            sequence,
            spa_options,
            fwknop_config,
            firewall_options,
            knock_options,
            tags,
            is_default: false,
            created_at: now,
            updated_at: now,
        };

        Self::validate_profile(&profile)?;
        self.profiles.push(profile.clone());
        Ok(profile)
    }

    pub fn update_profile(
        &mut self,
        id: &str,
        updates: KnockProfile,
    ) -> Result<KnockProfile, PortKnockError> {
        let idx = self
            .profiles
            .iter()
            .position(|p| p.id == id)
            .ok_or_else(|| PortKnockError::ProfileNotFound(id.to_string()))?;

        Self::validate_profile(&updates)?;

        let profile = &mut self.profiles[idx];
        profile.name = updates.name;
        profile.description = updates.description;
        profile.method = updates.method;
        profile.sequence = updates.sequence;
        profile.spa_options = updates.spa_options;
        profile.fwknop_config = updates.fwknop_config;
        profile.firewall_options = updates.firewall_options;
        profile.knock_options = updates.knock_options;
        profile.tags = updates.tags;
        profile.updated_at = Utc::now();

        Ok(self.profiles[idx].clone())
    }

    pub fn delete_profile(&mut self, id: &str) -> Result<(), PortKnockError> {
        let idx = self
            .profiles
            .iter()
            .position(|p| p.id == id)
            .ok_or_else(|| PortKnockError::ProfileNotFound(id.to_string()))?;
        self.profiles.remove(idx);
        Ok(())
    }

    pub fn get_profile(&self, id: &str) -> Result<&KnockProfile, PortKnockError> {
        self.profiles
            .iter()
            .find(|p| p.id == id)
            .ok_or_else(|| PortKnockError::ProfileNotFound(id.to_string()))
    }

    pub fn get_profile_by_name(&self, name: &str) -> Option<&KnockProfile> {
        self.profiles.iter().find(|p| p.name == name)
    }

    pub fn list_profiles(&self) -> &[KnockProfile] {
        &self.profiles
    }

    pub fn list_profiles_by_method(&self, method: KnockMethod) -> Vec<&KnockProfile> {
        self.profiles
            .iter()
            .filter(|p| std::mem::discriminant(&p.method) == std::mem::discriminant(&method))
            .collect()
    }

    pub fn list_profiles_by_tag(&self, tag: &str) -> Vec<&KnockProfile> {
        self.profiles
            .iter()
            .filter(|p| p.tags.iter().any(|t| t == tag))
            .collect()
    }

    pub fn set_default_profile(&mut self, id: &str) -> Result<(), PortKnockError> {
        if !self.profiles.iter().any(|p| p.id == id) {
            return Err(PortKnockError::ProfileNotFound(id.to_string()));
        }
        for p in &mut self.profiles {
            p.is_default = p.id == id;
        }
        Ok(())
    }

    pub fn get_default_profile(&self) -> Option<&KnockProfile> {
        self.profiles.iter().find(|p| p.is_default)
    }

    pub fn clone_profile(
        &mut self,
        id: &str,
        new_name: &str,
    ) -> Result<KnockProfile, PortKnockError> {
        let source = self
            .profiles
            .iter()
            .find(|p| p.id == id)
            .ok_or_else(|| PortKnockError::ProfileNotFound(id.to_string()))?
            .clone();

        let now = Utc::now();
        let cloned = KnockProfile {
            id: Uuid::new_v4().to_string(),
            name: new_name.to_string(),
            is_default: false,
            created_at: now,
            updated_at: now,
            ..source
        };

        self.profiles.push(cloned.clone());
        Ok(cloned)
    }

    pub fn validate_profile(profile: &KnockProfile) -> Result<(), PortKnockError> {
        if profile.name.is_empty() {
            return Err(PortKnockError::ProfileValidationError(
                "Profile name cannot be empty".to_string(),
            ));
        }

        match &profile.method {
            KnockMethod::SimpleSequence | KnockMethod::EncryptedSequence | KnockMethod::KnockdCompat => {
                if profile.sequence.is_none() {
                    return Err(PortKnockError::ProfileValidationError(format!(
                        "Sequence is required for {:?} method",
                        profile.method
                    )));
                }
            }
            KnockMethod::Spa => {
                if profile.spa_options.is_none() {
                    return Err(PortKnockError::ProfileValidationError(
                        "SPA options are required for SPA method".to_string(),
                    ));
                }
            }
            KnockMethod::Fwknop => {
                if profile.fwknop_config.is_none() {
                    return Err(PortKnockError::ProfileValidationError(
                        "fwknop config is required for Fwknop method".to_string(),
                    ));
                }
            }
        }

        Ok(())
    }

    pub fn export_profiles(
        &self,
        profile_ids: &[String],
        format: ProfileFormat,
    ) -> Result<String, PortKnockError> {
        let selected: Vec<&KnockProfile> = profile_ids
            .iter()
            .map(|id| {
                self.profiles
                    .iter()
                    .find(|p| p.id == *id)
                    .ok_or_else(|| PortKnockError::ProfileNotFound(id.clone()))
            })
            .collect::<Result<Vec<_>, _>>()?;

        match format {
            ProfileFormat::Json => serde_json::to_string_pretty(&selected)
                .map_err(|e| PortKnockError::ExportError(e.to_string())),
            ProfileFormat::Toml => {
                let wrapper = serde_json::to_value(&selected)
                    .map_err(|e| PortKnockError::ExportError(e.to_string()))?;
                // Produce a minimal TOML-like representation via JSON round-trip
                Ok(format!("# Exported profiles (TOML)\n{}", wrapper))
            }
            ProfileFormat::KnockdConf | ProfileFormat::FwknopRc => {
                Err(PortKnockError::ExportError(format!(
                    "{:?} export not yet implemented",
                    format
                )))
            }
        }
    }

    pub fn import_profiles(
        &mut self,
        data: &str,
        format: ProfileFormat,
    ) -> Result<Vec<KnockProfile>, PortKnockError> {
        let imported: Vec<KnockProfile> = match format {
            ProfileFormat::Json => serde_json::from_str(data)
                .map_err(|e| PortKnockError::ImportError(e.to_string()))?,
            ProfileFormat::Toml | ProfileFormat::KnockdConf | ProfileFormat::FwknopRc => {
                return Err(PortKnockError::ImportError(format!(
                    "{:?} import not yet implemented",
                    format
                )));
            }
        };

        let now = Utc::now();
        let mut added = Vec::new();
        for mut profile in imported {
            profile.id = Uuid::new_v4().to_string();
            profile.created_at = now;
            profile.updated_at = now;
            self.profiles.push(profile.clone());
            added.push(profile);
        }

        Ok(added)
    }

    pub fn search_profiles(&self, query: &str) -> Vec<&KnockProfile> {
        let q = query.to_lowercase();
        self.profiles
            .iter()
            .filter(|p| {
                p.name.to_lowercase().contains(&q)
                    || p.description.to_lowercase().contains(&q)
                    || p.tags.iter().any(|t| t.to_lowercase().contains(&q))
            })
            .collect()
    }
}
