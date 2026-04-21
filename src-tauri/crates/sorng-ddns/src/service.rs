//! # DDNS Service
//!
//! Top-level orchestrator combining IP detection, providers, scheduler,
//! and audit into a single service.

use crate::audit::DdnsAuditLogger;
use crate::scheduler::DdnsScheduler;
use crate::types::*;
use chrono::Utc;
use log::{info, warn};
use uuid::Uuid;

/// The main DDNS service — orchestrates all modules.
pub struct DdnsService {
    /// DDNS profiles.
    pub profiles: Vec<DdnsProfile>,
    /// Application-level configuration.
    pub config: DdnsConfig,
    /// Audit logger.
    pub audit: DdnsAuditLogger,
    /// Scheduler for automatic updates.
    pub scheduler: DdnsScheduler,
    /// Last detected IPv4 address.
    pub last_ipv4: Option<String>,
    /// Last detected IPv6 address.
    pub last_ipv6: Option<String>,
    /// Last IP check timestamp.
    pub last_ip_check: Option<String>,
    /// Per-profile health tracking.
    pub profile_health: std::collections::HashMap<String, DdnsProfileHealth>,
    /// Service start timestamp.
    pub started_at: String,
}

impl Default for DdnsService {
    fn default() -> Self {
        Self::new()
    }
}

impl DdnsService {
    /// Create a new DDNS service.
    pub fn new() -> Self {
        Self {
            profiles: Vec::new(),
            config: DdnsConfig::default(),
            audit: DdnsAuditLogger::default_logger(),
            scheduler: DdnsScheduler::new(),
            last_ipv4: None,
            last_ipv6: None,
            last_ip_check: None,
            profile_health: std::collections::HashMap::new(),
            started_at: Utc::now().to_rfc3339(),
        }
    }

    // ── Profile Management ──────────────────────────────────────────

    /// List all profiles.
    pub fn list_profiles(&self) -> Vec<DdnsProfile> {
        self.profiles.clone()
    }

    /// Get a profile by ID.
    pub fn get_profile(&self, id: &str) -> Result<DdnsProfile, String> {
        self.profiles
            .iter()
            .find(|p| p.id == id)
            .cloned()
            .ok_or_else(|| format!("Profile not found: {}", id))
    }

    /// Create a new profile.
    #[allow(clippy::too_many_arguments)]
    pub fn create_profile(
        &mut self,
        name: String,
        provider: DdnsProvider,
        auth: DdnsAuthMethod,
        domain: String,
        hostname: String,
        ip_version: IpVersion,
        update_interval_secs: u64,
        provider_settings: ProviderSettings,
        tags: Vec<String>,
        notes: Option<String>,
    ) -> DdnsProfile {
        let now = Utc::now().to_rfc3339();
        let profile = DdnsProfile {
            id: Uuid::new_v4().to_string(),
            name: name.clone(),
            enabled: true,
            provider: provider.clone(),
            auth,
            domain: domain.clone(),
            hostname: hostname.clone(),
            ip_version,
            update_interval_secs,
            provider_settings,
            tags,
            notes,
            created_at: now.clone(),
            updated_at: now,
        };

        let fqdn = if hostname.is_empty() || hostname == "@" {
            domain.clone()
        } else {
            format!("{}.{}", hostname, domain)
        };

        // Initialize health tracking
        self.profile_health.insert(
            profile.id.clone(),
            DdnsProfileHealth {
                profile_id: profile.id.clone(),
                profile_name: name.clone(),
                enabled: true,
                provider: provider.clone(),
                fqdn,
                current_ipv4: None,
                current_ipv6: None,
                last_success: None,
                last_failure: None,
                last_error: None,
                success_count: 0,
                failure_count: 0,
                consecutive_failures: 0,
                next_update: None,
                is_healthy: true,
            },
        );

        // Register with scheduler if interval > 0
        if update_interval_secs > 0 {
            self.scheduler
                .upsert_entry(&profile.id, update_interval_secs);
        }

        self.audit.log_event(
            DdnsAuditAction::ProfileCreated,
            Some(&profile.id),
            Some(&name),
            Some(&provider),
            &format!("Created DDNS profile for {}", domain),
            true,
            None,
        );

        self.profiles.push(profile.clone());
        info!("Created DDNS profile: {} ({})", name, provider);
        profile
    }

    /// Update an existing profile.
    #[allow(clippy::too_many_arguments)]
    pub fn update_profile(
        &mut self,
        id: &str,
        name: Option<String>,
        enabled: Option<bool>,
        auth: Option<DdnsAuthMethod>,
        domain: Option<String>,
        hostname: Option<String>,
        ip_version: Option<IpVersion>,
        update_interval_secs: Option<u64>,
        provider_settings: Option<ProviderSettings>,
        tags: Option<Vec<String>>,
        notes: Option<Option<String>>,
    ) -> Result<DdnsProfile, String> {
        let profile = self
            .profiles
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or_else(|| format!("Profile not found: {}", id))?;

        if let Some(n) = name {
            profile.name = n;
        }
        if let Some(e) = enabled {
            profile.enabled = e;
        }
        if let Some(a) = auth {
            profile.auth = a;
        }
        if let Some(d) = domain {
            profile.domain = d;
        }
        if let Some(h) = hostname {
            profile.hostname = h;
        }
        if let Some(iv) = ip_version {
            profile.ip_version = iv;
        }
        if let Some(interval) = update_interval_secs {
            profile.update_interval_secs = interval;
            if interval > 0 {
                self.scheduler.upsert_entry(id, interval);
            } else {
                self.scheduler.remove_entry(id);
            }
        }
        if let Some(ps) = provider_settings {
            profile.provider_settings = ps;
        }
        if let Some(t) = tags {
            profile.tags = t;
        }
        if let Some(n) = notes {
            profile.notes = n;
        }
        profile.updated_at = Utc::now().to_rfc3339();

        // Update health tracking name
        if let Some(health) = self.profile_health.get_mut(id) {
            health.profile_name = profile.name.clone();
            health.enabled = profile.enabled;
        }

        self.audit.log_event(
            DdnsAuditAction::ProfileUpdated,
            Some(id),
            Some(&profile.name),
            Some(&profile.provider),
            "Profile settings updated",
            true,
            None,
        );

        Ok(profile.clone())
    }

    /// Delete a profile.
    pub fn delete_profile(&mut self, id: &str) -> Result<(), String> {
        let idx = self
            .profiles
            .iter()
            .position(|p| p.id == id)
            .ok_or_else(|| format!("Profile not found: {}", id))?;

        let profile = self.profiles.remove(idx);
        self.scheduler.remove_entry(id);
        self.profile_health.remove(id);

        self.audit.log_event(
            DdnsAuditAction::ProfileDeleted,
            Some(id),
            Some(&profile.name),
            Some(&profile.provider),
            &format!("Deleted profile: {}", profile.name),
            true,
            None,
        );

        Ok(())
    }

    /// Enable a profile.
    pub fn enable_profile(&mut self, id: &str) -> Result<(), String> {
        let profile = self
            .profiles
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or_else(|| format!("Profile not found: {}", id))?;

        profile.enabled = true;
        profile.updated_at = Utc::now().to_rfc3339();

        if profile.update_interval_secs > 0 {
            self.scheduler
                .upsert_entry(id, profile.update_interval_secs);
        }

        if let Some(health) = self.profile_health.get_mut(id) {
            health.enabled = true;
        }

        self.audit.log_event(
            DdnsAuditAction::ProfileEnabled,
            Some(id),
            Some(&profile.name),
            Some(&profile.provider),
            "Profile enabled",
            true,
            None,
        );

        Ok(())
    }

    /// Disable a profile.
    pub fn disable_profile(&mut self, id: &str) -> Result<(), String> {
        let profile = self
            .profiles
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or_else(|| format!("Profile not found: {}", id))?;

        profile.enabled = false;
        profile.updated_at = Utc::now().to_rfc3339();

        self.scheduler.pause_entry(id);

        if let Some(health) = self.profile_health.get_mut(id) {
            health.enabled = false;
        }

        self.audit.log_event(
            DdnsAuditAction::ProfileDisabled,
            Some(id),
            Some(&profile.name),
            Some(&profile.provider),
            "Profile disabled",
            true,
            None,
        );

        Ok(())
    }

    // ── IP Detection ────────────────────────────────────────────────

    /// Detect the current public IP address.
    pub async fn detect_ip(&mut self) -> Result<IpDetectResult, String> {
        let services = self.config.ip_detect_services.clone();
        let timeout = self.config.http_timeout_secs;

        let result = crate::ip_detect::detect_public_ip(&services, false, timeout).await?;

        let old_ip = self.last_ipv4.clone();
        if let Some(ref ip) = result.ipv4 {
            self.last_ipv4 = Some(ip.clone());
        }
        self.last_ip_check = Some(Utc::now().to_rfc3339());

        // Log IP change
        if old_ip.is_some() && old_ip != self.last_ipv4 {
            self.audit.log_event(
                DdnsAuditAction::IpChanged,
                None,
                None,
                None,
                &format!(
                    "IPv4 changed: {} → {}",
                    old_ip.as_deref().unwrap_or("unknown"),
                    self.last_ipv4.as_deref().unwrap_or("unknown")
                ),
                true,
                None,
            );
        }

        Ok(result)
    }

    /// Detect IPv6 address.
    pub async fn detect_ipv6(&mut self) -> Result<IpDetectResult, String> {
        let services = self.config.ip_detect_services.clone();
        let timeout = self.config.http_timeout_secs;

        let result = crate::ip_detect::detect_public_ip(&services, true, timeout).await?;

        if let Some(ref ip) = result.ipv6 {
            self.last_ipv6 = Some(ip.clone());
        }

        Ok(result)
    }

    /// Get the last known IP addresses.
    pub fn get_current_ips(&self) -> (Option<String>, Option<String>) {
        (self.last_ipv4.clone(), self.last_ipv6.clone())
    }

    // ── Updates ─────────────────────────────────────────────────────

    /// Update a single profile now.
    pub async fn update_profile_now(
        &mut self,
        profile_id: &str,
    ) -> Result<DdnsUpdateResult, String> {
        let profile = self.get_profile(profile_id)?;

        if !profile.enabled {
            return Ok(DdnsUpdateResult {
                profile_id: profile.id.clone(),
                profile_name: profile.name.clone(),
                provider: profile.provider.clone(),
                status: UpdateStatus::Disabled,
                ip_sent: None,
                ip_previous: None,
                hostname: profile.hostname.clone(),
                fqdn: format!("{}.{}", profile.hostname, profile.domain),
                provider_response: None,
                error: Some("Profile is disabled".to_string()),
                timestamp: Utc::now().to_rfc3339(),
                latency_ms: 0,
            });
        }

        // Detect IP if not cached
        let ip = match &self.last_ipv4 {
            Some(ip) => ip.clone(),
            None => {
                let result = self.detect_ip().await?;
                result
                    .ipv4
                    .ok_or_else(|| "Failed to detect IPv4 address".to_string())?
            }
        };

        let ipv6 = match &profile.ip_version {
            IpVersion::V6Only | IpVersion::DualStack | IpVersion::Auto => self.last_ipv6.clone(),
            _ => None,
        };

        let result = crate::providers::dispatch_update(&profile, &ip, ipv6.as_deref()).await?;

        // Update health tracking
        self.record_update_result(&result);

        // Update scheduler
        let success =
            result.status == UpdateStatus::Success || result.status == UpdateStatus::NoChange;
        self.scheduler
            .mark_completed(profile_id, success, &self.config);

        // Audit
        let audit_action = match result.status {
            UpdateStatus::Success => DdnsAuditAction::UpdateSuccess,
            UpdateStatus::NoChange => DdnsAuditAction::UpdateNoChange,
            UpdateStatus::AuthError => DdnsAuditAction::UpdateAuthError,
            UpdateStatus::RateLimited => DdnsAuditAction::UpdateRateLimited,
            _ => DdnsAuditAction::UpdateFailed,
        };

        self.audit.log_event(
            audit_action,
            Some(profile_id),
            Some(&profile.name),
            Some(&profile.provider),
            &format!("Update {}: IP={}", result.status_label(), ip),
            success,
            result.error.as_deref(),
        );

        Ok(result)
    }

    /// Update all enabled profiles.
    pub async fn update_all(&mut self) -> Vec<DdnsUpdateResult> {
        let ids: Vec<String> = self
            .profiles
            .iter()
            .filter(|p| p.enabled)
            .map(|p| p.id.clone())
            .collect();

        let mut results = Vec::new();
        for id in ids {
            match self.update_profile_now(&id).await {
                Ok(result) => results.push(result),
                Err(e) => {
                    warn!("Failed to update profile {}: {}", id, e);
                }
            }
        }

        results
    }

    /// Process due profiles from the scheduler.
    pub async fn process_scheduled(&mut self) -> Vec<DdnsUpdateResult> {
        let due = self.scheduler.get_due_profiles();
        let mut results = Vec::new();

        for id in due {
            match self.update_profile_now(&id).await {
                Ok(result) => results.push(result),
                Err(e) => {
                    warn!("Scheduled update failed for {}: {}", id, e);
                }
            }
        }

        results
    }

    /// Record an update result in health tracking.
    fn record_update_result(&mut self, result: &DdnsUpdateResult) {
        let health = self
            .profile_health
            .entry(result.profile_id.clone())
            .or_insert_with(|| DdnsProfileHealth {
                profile_id: result.profile_id.clone(),
                profile_name: result.profile_name.clone(),
                enabled: true,
                provider: result.provider.clone(),
                fqdn: result.fqdn.clone(),
                current_ipv4: None,
                current_ipv6: None,
                last_success: None,
                last_failure: None,
                last_error: None,
                success_count: 0,
                failure_count: 0,
                consecutive_failures: 0,
                next_update: None,
                is_healthy: true,
            });

        let now = Utc::now().to_rfc3339();
        let ok = result.status == UpdateStatus::Success || result.status == UpdateStatus::NoChange;

        if ok {
            health.last_success = Some(now);
            health.success_count += 1;
            health.consecutive_failures = 0;
            health.is_healthy = true;
            health.last_error = None;
            if let Some(ref ip) = result.ip_sent {
                if ip.contains(':') {
                    health.current_ipv6 = Some(ip.clone());
                } else {
                    health.current_ipv4 = Some(ip.clone());
                }
            }
        } else {
            health.last_failure = Some(now);
            health.failure_count += 1;
            health.consecutive_failures += 1;
            health.last_error = result.error.clone();
            if health.consecutive_failures >= 3 {
                health.is_healthy = false;
            }
        }
    }

    // ── Health & Status ─────────────────────────────────────────────

    /// Get health status for all profiles.
    pub fn get_all_health(&self) -> Vec<DdnsProfileHealth> {
        self.profile_health.values().cloned().collect()
    }

    /// Get health for a specific profile.
    pub fn get_profile_health(&self, profile_id: &str) -> Result<DdnsProfileHealth, String> {
        self.profile_health
            .get(profile_id)
            .cloned()
            .ok_or_else(|| format!("No health data for profile: {}", profile_id))
    }

    /// Get overall system status.
    pub fn get_system_status(&self) -> DdnsSystemStatus {
        let healthy = self
            .profile_health
            .values()
            .filter(|h| h.is_healthy)
            .count();
        let errored = self
            .profile_health
            .values()
            .filter(|h| !h.is_healthy)
            .count();
        let enabled = self.profiles.iter().filter(|p| p.enabled).count();

        let uptime = chrono::DateTime::parse_from_rfc3339(&self.started_at)
            .map(|start| (Utc::now() - start.with_timezone(&Utc)).num_seconds() as u64)
            .unwrap_or(0);

        DdnsSystemStatus {
            total_profiles: self.profiles.len(),
            enabled_profiles: enabled,
            healthy_profiles: healthy,
            error_profiles: errored,
            current_ipv4: self.last_ipv4.clone(),
            current_ipv6: self.last_ipv6.clone(),
            scheduler_running: self.scheduler.running,
            last_ip_check: self.last_ip_check.clone(),
            uptime_secs: uptime,
        }
    }

    // ── Scheduler ───────────────────────────────────────────────────

    /// Start the scheduler.
    pub fn start_scheduler(&mut self) {
        // Register all enabled profiles with intervals > 0
        for profile in &self.profiles {
            if profile.enabled && profile.update_interval_secs > 0 {
                self.scheduler
                    .upsert_entry(&profile.id, profile.update_interval_secs);
            }
        }
        self.scheduler.start();

        self.audit.log_event(
            DdnsAuditAction::SchedulerStarted,
            None,
            None,
            None,
            "DDNS scheduler started",
            true,
            None,
        );
    }

    /// Stop the scheduler.
    pub fn stop_scheduler(&mut self) {
        self.scheduler.stop();

        self.audit.log_event(
            DdnsAuditAction::SchedulerStopped,
            None,
            None,
            None,
            "DDNS scheduler stopped",
            true,
            None,
        );
    }

    /// Get scheduler status.
    pub fn get_scheduler_status(&self) -> SchedulerStatus {
        self.scheduler.get_status()
    }

    // ── Configuration ───────────────────────────────────────────────

    /// Get the current configuration.
    pub fn get_config(&self) -> DdnsConfig {
        self.config.clone()
    }

    /// Update the configuration.
    pub fn update_config(&mut self, config: DdnsConfig) {
        self.audit.set_max_entries(config.max_audit_entries);
        self.config = config;

        self.audit.log_event(
            DdnsAuditAction::ConfigUpdated,
            None,
            None,
            None,
            "DDNS configuration updated",
            true,
            None,
        );
    }

    // ── Provider Info ───────────────────────────────────────────────

    /// Get capabilities for all providers.
    pub fn get_all_provider_capabilities(&self) -> Vec<ProviderCapabilities> {
        crate::providers::get_all_capabilities()
    }

    /// Get capabilities for a specific provider.
    pub fn get_provider_capabilities(&self, provider: &DdnsProvider) -> ProviderCapabilities {
        crate::providers::get_capabilities(provider)
    }

    // ── Cloudflare-specific ─────────────────────────────────────────

    /// List Cloudflare zones (requires a Cloudflare profile).
    pub async fn cf_list_zones(&self, profile_id: &str) -> Result<Vec<CloudflareZone>, String> {
        let profile = self.get_profile(profile_id)?;
        if profile.provider != DdnsProvider::Cloudflare {
            return Err("Profile is not a Cloudflare profile".to_string());
        }
        crate::providers::cloudflare::list_zones(&profile.auth).await
    }

    /// List Cloudflare DNS records for a zone.
    pub async fn cf_list_records(
        &self,
        profile_id: &str,
        zone_id: &str,
        record_type: Option<String>,
        name: Option<String>,
    ) -> Result<Vec<CloudflareDnsRecord>, String> {
        let profile = self.get_profile(profile_id)?;
        if profile.provider != DdnsProvider::Cloudflare {
            return Err("Profile is not a Cloudflare profile".to_string());
        }
        crate::providers::cloudflare::list_records(
            &profile.auth,
            zone_id,
            record_type.as_deref(),
            name.as_deref(),
        )
        .await
    }

    /// Create a Cloudflare DNS record.
    #[allow(clippy::too_many_arguments)]
    pub async fn cf_create_record(
        &mut self,
        profile_id: &str,
        zone_id: &str,
        record_type: &str,
        name: &str,
        content: &str,
        ttl: u32,
        proxied: bool,
        comment: Option<String>,
    ) -> Result<CloudflareDnsRecord, String> {
        let profile = self.get_profile(profile_id)?;
        if profile.provider != DdnsProvider::Cloudflare {
            return Err("Profile is not a Cloudflare profile".to_string());
        }

        let result = crate::providers::cloudflare::create_record(
            &profile.auth,
            zone_id,
            record_type,
            name,
            content,
            ttl,
            proxied,
            comment.as_deref(),
        )
        .await?;

        self.audit.log_event(
            DdnsAuditAction::RecordCreated,
            Some(profile_id),
            Some(&profile.name),
            Some(&DdnsProvider::Cloudflare),
            &format!("Created {} record: {} → {}", record_type, name, content),
            true,
            None,
        );

        Ok(result)
    }

    /// Delete a Cloudflare DNS record.
    pub async fn cf_delete_record(
        &mut self,
        profile_id: &str,
        zone_id: &str,
        record_id: &str,
    ) -> Result<(), String> {
        let profile = self.get_profile(profile_id)?;
        if profile.provider != DdnsProvider::Cloudflare {
            return Err("Profile is not a Cloudflare profile".to_string());
        }

        crate::providers::cloudflare::delete_record(&profile.auth, zone_id, record_id).await?;

        self.audit.log_event(
            DdnsAuditAction::RecordDeleted,
            Some(profile_id),
            Some(&profile.name),
            Some(&DdnsProvider::Cloudflare),
            &format!("Deleted record: {}", record_id),
            true,
            None,
        );

        Ok(())
    }

    // ── Import / Export ─────────────────────────────────────────────

    /// Export all profiles and config.
    pub fn export_data(&mut self) -> DdnsExportData {
        self.audit.log_event(
            DdnsAuditAction::BulkExport,
            None,
            None,
            None,
            &format!("Exported {} profiles", self.profiles.len()),
            true,
            None,
        );

        DdnsExportData {
            version: 1,
            exported_at: Utc::now().to_rfc3339(),
            profiles: self.profiles.clone(),
            config: self.config.clone(),
        }
    }

    /// Import profiles from export data.
    pub fn import_data(&mut self, data: DdnsExportData) -> DdnsImportResult {
        let mut imported = 0;
        let mut skipped = 0;
        let mut errors = Vec::new();

        for profile in data.profiles {
            if self.profiles.iter().any(|p| p.id == profile.id) {
                skipped += 1;
                errors.push(format!("Duplicate ID: {}", profile.id));
                continue;
            }

            // Initialize health for imported profile
            let fqdn = if profile.hostname.is_empty() || profile.hostname == "@" {
                profile.domain.clone()
            } else {
                format!("{}.{}", profile.hostname, profile.domain)
            };

            self.profile_health.insert(
                profile.id.clone(),
                DdnsProfileHealth {
                    profile_id: profile.id.clone(),
                    profile_name: profile.name.clone(),
                    enabled: profile.enabled,
                    provider: profile.provider.clone(),
                    fqdn,
                    current_ipv4: None,
                    current_ipv6: None,
                    last_success: None,
                    last_failure: None,
                    last_error: None,
                    success_count: 0,
                    failure_count: 0,
                    consecutive_failures: 0,
                    next_update: None,
                    is_healthy: true,
                },
            );

            if profile.enabled && profile.update_interval_secs > 0 {
                self.scheduler
                    .upsert_entry(&profile.id, profile.update_interval_secs);
            }

            self.profiles.push(profile);
            imported += 1;
        }

        self.audit.log_event(
            DdnsAuditAction::BulkImport,
            None,
            None,
            None,
            &format!("Imported {}, skipped {}", imported, skipped),
            true,
            None,
        );

        DdnsImportResult {
            imported_count: imported,
            skipped_count: skipped,
            errors,
        }
    }

    // ── Audit ───────────────────────────────────────────────────────

    /// Get all audit entries.
    pub fn get_audit_log(&self) -> Vec<DdnsAuditEntry> {
        self.audit.get_entries()
    }

    /// Get audit entries for a profile.
    pub fn get_audit_for_profile(&self, profile_id: &str) -> Vec<DdnsAuditEntry> {
        self.audit.get_entries_for_profile(profile_id)
    }

    /// Export audit log as JSON.
    pub fn export_audit(&self) -> Result<String, String> {
        self.audit.export_json()
    }

    /// Clear audit log.
    pub fn clear_audit(&mut self) {
        self.audit.clear();
    }
}

// Helper for DdnsUpdateResult
impl DdnsUpdateResult {
    /// Human-readable status label.
    pub fn status_label(&self) -> &str {
        match self.status {
            UpdateStatus::Success => "Success",
            UpdateStatus::NoChange => "No Change",
            UpdateStatus::Failed => "Failed",
            UpdateStatus::UnexpectedResponse => "Unexpected Response",
            UpdateStatus::NetworkError => "Network Error",
            UpdateStatus::AuthError => "Auth Error",
            UpdateStatus::RateLimited => "Rate Limited",
            UpdateStatus::Disabled => "Disabled",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_service_new() {
        let svc = DdnsService::new();
        assert!(svc.profiles.is_empty());
        assert!(svc.last_ipv4.is_none());
        assert!(!svc.scheduler.running);
    }

    #[test]
    fn test_create_and_list_profiles() {
        let mut svc = DdnsService::new();
        let profile = svc.create_profile(
            "Test CF".to_string(),
            DdnsProvider::Cloudflare,
            DdnsAuthMethod::ApiToken {
                token: "xxx".to_string(),
            },
            "example.com".to_string(),
            "home".to_string(),
            IpVersion::V4Only,
            300,
            ProviderSettings::None,
            vec![],
            None,
        );

        assert_eq!(svc.list_profiles().len(), 1);
        assert_eq!(profile.name, "Test CF");
        assert!(profile.enabled);
    }

    #[test]
    fn test_update_and_delete_profile() {
        let mut svc = DdnsService::new();
        let profile = svc.create_profile(
            "Test".to_string(),
            DdnsProvider::DuckDns,
            DdnsAuthMethod::ApiToken {
                token: "tok".to_string(),
            },
            "myhost".to_string(),
            "".to_string(),
            IpVersion::Auto,
            600,
            ProviderSettings::None,
            vec![],
            None,
        );

        svc.update_profile(
            &profile.id,
            Some("Updated".to_string()),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();

        assert_eq!(svc.get_profile(&profile.id).unwrap().name, "Updated");

        svc.delete_profile(&profile.id).unwrap();
        assert!(svc.profiles.is_empty());
    }

    #[test]
    fn test_enable_disable() {
        let mut svc = DdnsService::new();
        let p = svc.create_profile(
            "T".to_string(),
            DdnsProvider::NoIp,
            DdnsAuthMethod::Basic {
                username: "u".to_string(),
                password: "p".to_string(),
            },
            "example.com".to_string(),
            "home".to_string(),
            IpVersion::V4Only,
            300,
            ProviderSettings::None,
            vec![],
            None,
        );

        svc.disable_profile(&p.id).unwrap();
        assert!(!svc.get_profile(&p.id).unwrap().enabled);

        svc.enable_profile(&p.id).unwrap();
        assert!(svc.get_profile(&p.id).unwrap().enabled);
    }

    #[test]
    fn test_system_status() {
        let mut svc = DdnsService::new();
        svc.create_profile(
            "A".to_string(),
            DdnsProvider::Cloudflare,
            DdnsAuthMethod::ApiToken {
                token: "t".to_string(),
            },
            "a.com".to_string(),
            "@".to_string(),
            IpVersion::Auto,
            300,
            ProviderSettings::None,
            vec![],
            None,
        );

        let status = svc.get_system_status();
        assert_eq!(status.total_profiles, 1);
        assert_eq!(status.enabled_profiles, 1);
        assert_eq!(status.healthy_profiles, 1);
    }

    #[test]
    fn test_export_import() {
        let mut svc = DdnsService::new();
        svc.create_profile(
            "Export Test".to_string(),
            DdnsProvider::DuckDns,
            DdnsAuthMethod::ApiToken {
                token: "t".to_string(),
            },
            "myhost".to_string(),
            "".to_string(),
            IpVersion::Auto,
            600,
            ProviderSettings::None,
            vec!["tag1".to_string()],
            Some("notes".to_string()),
        );

        let export = svc.export_data();
        assert_eq!(export.profiles.len(), 1);

        let mut svc2 = DdnsService::new();
        let import_result = svc2.import_data(export);
        assert_eq!(import_result.imported_count, 1);
        assert_eq!(import_result.skipped_count, 0);
        assert_eq!(svc2.profiles.len(), 1);
    }

    #[test]
    fn test_provider_capabilities() {
        let svc = DdnsService::new();
        let caps = svc.get_all_provider_capabilities();
        assert!(caps.len() >= 16);

        let cf = svc.get_provider_capabilities(&DdnsProvider::Cloudflare);
        assert!(cf.supports_ipv4);
        assert!(cf.supports_ipv6);
        assert!(cf.supports_proxy);
    }

    #[test]
    fn test_config_update() {
        let mut svc = DdnsService::new();
        let mut config = svc.get_config();
        config.ip_check_interval_secs = 600;
        config.max_retries = 5;
        svc.update_config(config.clone());
        assert_eq!(svc.get_config().ip_check_interval_secs, 600);
        assert_eq!(svc.get_config().max_retries, 5);
    }

    #[test]
    fn test_audit_operations() {
        let mut svc = DdnsService::new();
        svc.create_profile(
            "Audit Test".to_string(),
            DdnsProvider::NoIp,
            DdnsAuthMethod::Basic {
                username: "u".to_string(),
                password: "p".to_string(),
            },
            "test.com".to_string(),
            "www".to_string(),
            IpVersion::V4Only,
            300,
            ProviderSettings::None,
            vec![],
            None,
        );

        let log = svc.get_audit_log();
        assert!(!log.is_empty());

        let json = svc.export_audit().unwrap();
        assert!(json.contains("ProfileCreated"));

        svc.clear_audit();
        assert!(svc.get_audit_log().is_empty());
    }
}
