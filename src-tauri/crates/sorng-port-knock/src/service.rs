use std::sync::{Arc, Mutex};

use crate::client::KnockClient;
use crate::crypto::KnockCrypto;
use crate::error::PortKnockError;
use crate::firewall::FirewallManager;
use crate::fwknop::FwknopManager;
use crate::knockd::KnockdManager;
use crate::profiles::ProfileManager;
use crate::scanner::KnockScanner;
use crate::spa::SpaClient;
use crate::history::KnockHistory;
use crate::sequence;
use crate::types::*;

pub type PortKnockServiceState = Arc<Mutex<PortKnockService>>;

pub struct PortKnockService {
    hosts: Vec<KnockHost>,
    sequences: Vec<KnockSequence>,
    client: KnockClient,
    crypto: KnockCrypto,
    spa_client: SpaClient,
    firewall: FirewallManager,
    knockd: KnockdManager,
    fwknop: FwknopManager,
    profiles: ProfileManager,
    scanner: KnockScanner,
    history: KnockHistory,
    keys: Vec<KnockKey>,
}

impl PortKnockService {
    pub fn new() -> PortKnockServiceState {
        Arc::new(Mutex::new(Self {
            hosts: Vec::new(),
            sequences: Vec::new(),
            client: KnockClient::new(),
            crypto: KnockCrypto::new(),
            spa_client: SpaClient::new(),
            firewall: FirewallManager::new(),
            knockd: KnockdManager::new(),
            fwknop: FwknopManager::new(),
            profiles: ProfileManager::new(),
            scanner: KnockScanner::new(),
            history: KnockHistory::new(10000),
            keys: Vec::new(),
        }))
    }

    // ─── Host Management ───────────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    pub fn add_host(
        &mut self,
        name: String,
        hostname: String,
        port: u16,
        description: String,
        ssh_user: Option<String>,
        ssh_port: Option<u16>,
        tags: Vec<String>,
    ) -> Result<KnockHost, PortKnockError> {
        if self.hosts.iter().any(|h| h.hostname == hostname) {
            return Err(PortKnockError::HostAlreadyExists(hostname));
        }
        let host = KnockHost {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            hostname,
            port,
            description,
            default_profile_id: None,
            ssh_user,
            ssh_port,
            tags,
            last_knock_at: None,
            last_knock_status: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        };
        self.hosts.push(host.clone());
        Ok(host)
    }

    pub fn remove_host(&mut self, id: &str) -> Result<(), PortKnockError> {
        let idx = self
            .hosts
            .iter()
            .position(|h| h.id == id)
            .ok_or_else(|| PortKnockError::HostNotFound(id.to_string()))?;
        self.hosts.remove(idx);
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_host(
        &mut self,
        id: &str,
        name: Option<String>,
        hostname: Option<String>,
        port: Option<u16>,
        description: Option<String>,
        ssh_user: Option<Option<String>>,
        ssh_port: Option<Option<u16>>,
        tags: Option<Vec<String>>,
    ) -> Result<KnockHost, PortKnockError> {
        let host = self
            .hosts
            .iter_mut()
            .find(|h| h.id == id)
            .ok_or_else(|| PortKnockError::HostNotFound(id.to_string()))?;
        if let Some(n) = name {
            host.name = n;
        }
        if let Some(h) = hostname {
            host.hostname = h;
        }
        if let Some(p) = port {
            host.port = p;
        }
        if let Some(d) = description {
            host.description = d;
        }
        if let Some(u) = ssh_user {
            host.ssh_user = u;
        }
        if let Some(p) = ssh_port {
            host.ssh_port = p;
        }
        if let Some(t) = tags {
            host.tags = t;
        }
        host.updated_at = chrono::Utc::now();
        Ok(host.clone())
    }

    pub fn get_host(&self, id: &str) -> Result<&KnockHost, PortKnockError> {
        self.hosts
            .iter()
            .find(|h| h.id == id)
            .ok_or_else(|| PortKnockError::HostNotFound(id.to_string()))
    }

    pub fn list_hosts(&self) -> &[KnockHost] {
        &self.hosts
    }

    // ─── Sequence Management ───────────────────────────────────────

    pub fn add_sequence(
        &mut self,
        seq: KnockSequence,
    ) -> Result<KnockSequence, PortKnockError> {
        sequence::validate_sequence(&seq)?;
        self.sequences.push(seq.clone());
        Ok(seq)
    }

    pub fn remove_sequence(&mut self, id: &str) -> Result<(), PortKnockError> {
        let idx = self
            .sequences
            .iter()
            .position(|s| s.id == id)
            .ok_or_else(|| {
                PortKnockError::InvalidSequence(format!("Sequence not found: {}", id))
            })?;
        self.sequences.remove(idx);
        Ok(())
    }

    pub fn get_sequence(&self, id: &str) -> Option<&KnockSequence> {
        self.sequences.iter().find(|s| s.id == id)
    }

    pub fn list_sequences(&self) -> &[KnockSequence] {
        &self.sequences
    }

    pub fn generate_sequence(&self, params: SequenceGenParams) -> KnockSequence {
        sequence::generate_sequence(&params)
    }

    // ─── Knock Execution (delegates to client) ─────────────────────

    pub fn execute_knock(
        &mut self,
        host_id: &str,
        sequence_id: &str,
        options: KnockOptions,
    ) -> Result<KnockResult, PortKnockError> {
        let host = self
            .hosts
            .iter()
            .find(|h| h.id == host_id)
            .ok_or_else(|| PortKnockError::HostNotFound(host_id.to_string()))?
            .clone();
        let seq = self
            .sequences
            .iter()
            .find(|s| s.id == sequence_id)
            .ok_or_else(|| {
                PortKnockError::InvalidSequence(format!(
                    "Sequence not found: {}",
                    sequence_id
                ))
            })?
            .clone();

        let result = self.client.execute_knock(&host.hostname, &seq, &options)?;

        // Update host last knock
        if let Some(h) = self.hosts.iter_mut().find(|h| h.id == host_id) {
            h.last_knock_at = Some(chrono::Utc::now());
            h.last_knock_status = Some(result.status);
        }

        // Record history
        self.history.record(
            host.hostname.clone(),
            Some(String::new()),
            None,
            KnockMethod::SimpleSequence,
            result.status,
            seq.target_port,
            result.target_port_opened,
            result.total_elapsed_ms,
            result.step_results.len() as u32,
            seq.steps.len() as u32,
            result.error.clone(),
        );

        Ok(result)
    }

    // ─── SPA Operations ────────────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    pub fn send_spa(
        &mut self,
        host_id: &str,
        username: &str,
        access_request: &str,
        message_type: SpaMessageType,
        key: &[u8],
        options: SpaOptions,
    ) -> Result<SpaResult, PortKnockError> {
        let host = self
            .hosts
            .iter()
            .find(|h| h.id == host_id)
            .ok_or_else(|| PortKnockError::HostNotFound(host_id.to_string()))?
            .clone();

        let packet =
            SpaClient::construct_spa_packet(username, access_request, message_type, &options)?;
        let result = SpaClient::send_spa(&host.hostname, &packet, key, &options);

        if let Some(h) = self.hosts.iter_mut().find(|h| h.id == host_id) {
            h.last_knock_at = Some(chrono::Utc::now());
        }

        self.history.record(
            host.hostname.clone(),
            None,
            None,
            KnockMethod::Spa,
            if result.success {
                KnockStatus::Success
            } else {
                KnockStatus::Failed
            },
            options.destination_port,
            result.port_opened.unwrap_or(false),
            result.elapsed_ms,
            1,
            1,
            result.error.clone(),
        );

        Ok(result)
    }

    // ─── Crypto Operations ─────────────────────────────────────────

    pub fn encrypt_payload(
        &self,
        data: &[u8],
        key: &[u8],
        algorithm: KnockEncryption,
    ) -> Result<EncryptedKnockPayload, PortKnockError> {
        KnockCrypto::encrypt_payload(data, key, algorithm)
    }

    pub fn decrypt_payload(
        &self,
        payload: &EncryptedKnockPayload,
        key: &[u8],
    ) -> Result<Vec<u8>, PortKnockError> {
        KnockCrypto::decrypt_payload(payload, key)
    }

    pub fn generate_key(&self, length: usize) -> Vec<u8> {
        KnockCrypto::generate_key(length)
    }

    // ─── Firewall Operations ───────────────────────────────────────

    pub fn detect_firewall_command(&self) -> String {
        FirewallManager::detect_backend()
    }

    pub fn generate_firewall_accept_rule(
        &self,
        backend: FirewallBackend,
        source_ip: &str,
        port: u16,
        protocol: KnockProtocol,
        options: &FirewallRuleOptions,
    ) -> String {
        FirewallManager::generate_accept_rule(backend, source_ip, port, protocol, options)
    }

    pub fn generate_firewall_timed_rule(
        &self,
        backend: FirewallBackend,
        source_ip: &str,
        port: u16,
        protocol: KnockProtocol,
        expire_seconds: u64,
        options: &FirewallRuleOptions,
    ) -> String {
        FirewallManager::generate_timed_rule(
            backend,
            source_ip,
            port,
            protocol,
            expire_seconds,
            options,
        )
    }

    pub fn generate_firewall_remove_rule(
        &self,
        backend: FirewallBackend,
        source_ip: &str,
        port: u16,
        protocol: KnockProtocol,
        options: &FirewallRuleOptions,
    ) -> String {
        FirewallManager::generate_remove_rule(backend, source_ip, port, protocol, options)
    }

    pub fn firewall_backup_command(&self, backend: FirewallBackend) -> String {
        FirewallManager::generate_backup_command(backend)
    }

    // ─── knockd Operations ─────────────────────────────────────────

    pub fn parse_knockd_config(
        &self,
        content: &str,
    ) -> Result<KnockdConfig, PortKnockError> {
        KnockdManager::parse_config(content)
    }

    pub fn generate_knockd_config(&self, config: &KnockdConfig) -> String {
        KnockdManager::generate_config(config)
    }

    pub fn knockd_status_command(&self) -> String {
        KnockdManager::get_status_command()
    }

    pub fn knockd_install_command(&self, distro: &str) -> String {
        KnockdManager::install_command(distro)
    }

    pub fn knockd_log_command(&self, lines: u32) -> String {
        KnockdManager::get_log_command(lines)
    }

    // ─── fwknop Operations ─────────────────────────────────────────

    pub fn parse_fwknop_access_conf(
        &self,
        content: &str,
    ) -> Result<Vec<FwknopAccessStanza>, PortKnockError> {
        FwknopManager::parse_access_conf(content)
    }

    pub fn generate_fwknop_access_conf(
        &self,
        stanzas: &[FwknopAccessStanza],
    ) -> String {
        FwknopManager::generate_access_conf(stanzas)
    }

    pub fn build_fwknop_client_command(&self, config: &FwknopClientConfig) -> String {
        FwknopManager::build_client_command(config)
    }

    pub fn fwknop_install_command(&self, distro: &str) -> String {
        FwknopManager::install_command(distro)
    }

    pub fn generate_fwknop_keys(&self) -> (String, String) {
        FwknopManager::generate_keys()
    }

    pub fn generate_fwknop_client_rc(
        &self,
        config: &FwknopClientConfig,
        stanza_name: &str,
    ) -> String {
        FwknopManager::generate_client_rc(config, stanza_name)
    }

    // ─── Profile Operations (delegates to ProfileManager) ──────────

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
        self.profiles.create_profile(
            name,
            description,
            method,
            sequence,
            spa_options,
            fwknop_config,
            firewall_options,
            knock_options,
            tags,
        )
    }

    pub fn update_profile(
        &mut self,
        id: &str,
        updates: KnockProfile,
    ) -> Result<KnockProfile, PortKnockError> {
        self.profiles.update_profile(id, updates)
    }

    pub fn delete_profile(&mut self, id: &str) -> Result<(), PortKnockError> {
        self.profiles.delete_profile(id)
    }

    pub fn get_profile(&self, id: &str) -> Result<&KnockProfile, PortKnockError> {
        self.profiles.get_profile(id)
    }

    pub fn list_profiles(&self) -> &[KnockProfile] {
        self.profiles.list_profiles()
    }

    pub fn export_profiles(
        &self,
        profile_ids: &[String],
        format: ProfileFormat,
    ) -> Result<String, PortKnockError> {
        self.profiles.export_profiles(profile_ids, format)
    }

    pub fn import_profiles(
        &mut self,
        data: &str,
        format: ProfileFormat,
    ) -> Result<Vec<KnockProfile>, PortKnockError> {
        self.profiles.import_profiles(data, format)
    }

    pub fn search_profiles(&self, query: &str) -> Vec<&KnockProfile> {
        self.profiles.search_profiles(query)
    }

    // ─── Scanner Operations ────────────────────────────────────────

    pub fn check_port_command(
        &self,
        host: &str,
        port: u16,
        protocol: KnockProtocol,
        timeout_ms: u64,
    ) -> String {
        KnockScanner::check_port_command(host, port, protocol, timeout_ms)
    }

    pub fn banner_grab_command(&self, host: &str, port: u16, timeout_ms: u64) -> String {
        KnockScanner::banner_grab_command(host, port, timeout_ms)
    }

    pub fn nmap_scan_command(&self, host: &str, ports: &[u16], fast: bool) -> String {
        KnockScanner::nmap_scan_command(host, ports, fast)
    }

    pub fn measure_rtt_command(&self, host: &str, count: u32) -> String {
        KnockScanner::measure_rtt_command(host, count)
    }

    // ─── History Operations ────────────────────────────────────────

    pub fn get_history(&self) -> &[KnockHistoryEntry] {
        self.history.list_entries()
    }

    pub fn filter_history(&self, filter: &HistoryFilter) -> Vec<&KnockHistoryEntry> {
        self.history.filter_entries(filter)
    }

    pub fn get_statistics(&self) -> KnockStatistics {
        self.history.get_statistics()
    }

    pub fn clear_history(&mut self) -> usize {
        self.history.clear_history()
    }

    pub fn export_history_json(&self) -> Result<String, PortKnockError> {
        self.history.export_json()
    }

    pub fn export_history_csv(&self) -> Result<String, PortKnockError> {
        self.history.export_csv()
    }

    pub fn get_recent_history(&self, count: usize) -> Vec<&KnockHistoryEntry> {
        self.history.get_recent_entries(count)
    }

    // ─── Sequence helpers ──────────────────────────────────────────

    pub fn encode_sequence_base64(
        &self,
        seq: &KnockSequence,
    ) -> Result<String, PortKnockError> {
        sequence::encode_sequence_base64(seq)
    }

    pub fn decode_sequence_base64(
        &self,
        encoded: &str,
    ) -> Result<KnockSequence, PortKnockError> {
        sequence::decode_sequence_base64(encoded)
    }

    pub fn sequence_to_knockd_format(&self, seq: &KnockSequence) -> String {
        sequence::sequence_to_knockd_format(seq)
    }

    pub fn calculate_complexity_score(&self, seq: &KnockSequence) -> f64 {
        sequence::calculate_complexity_score(seq)
    }
}
