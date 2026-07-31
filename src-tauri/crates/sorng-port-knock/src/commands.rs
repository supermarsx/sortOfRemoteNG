use std::sync::{Arc, Mutex};
use tauri::command;

use super::service::PortKnockService;
use super::types::*;

type State<'a> = tauri::State<'a, Arc<Mutex<PortKnockService>>>;

const MAX_SCANNER_TIMEOUT_MS: u64 = 30_000;
const MAX_NMAP_PORTS: usize = 4_096;
const MAX_RTT_SAMPLES: u32 = 100;

fn validate_probe_request(host: &str, port: u16, timeout_ms: u64) -> Result<(), String> {
    super::client::validate_host(host).map_err(|error| error.to_string())?;
    super::client::validate_port(port).map_err(|error| error.to_string())?;
    if !(1..=MAX_SCANNER_TIMEOUT_MS).contains(&timeout_ms) {
        return Err(format!(
            "Timeout must be between 1 and {MAX_SCANNER_TIMEOUT_MS} ms"
        ));
    }
    Ok(())
}

fn validate_nmap_request(host: &str, ports: &[u16]) -> Result<(), String> {
    super::client::validate_host(host).map_err(|error| error.to_string())?;
    if ports.is_empty() || ports.len() > MAX_NMAP_PORTS {
        return Err(format!(
            "Nmap command requires 1 to {MAX_NMAP_PORTS} non-zero ports"
        ));
    }
    for &port in ports {
        super::client::validate_port(port).map_err(|_| {
            format!("Nmap command requires 1 to {MAX_NMAP_PORTS} non-zero ports")
        })?;
    }
    Ok(())
}

fn validate_rtt_request(host: &str, count: u32) -> Result<(), String> {
    super::client::validate_host(host).map_err(|error| error.to_string())?;
    if !(1..=MAX_RTT_SAMPLES).contains(&count) {
        return Err(format!(
            "RTT sample count must be between 1 and {MAX_RTT_SAMPLES}"
        ));
    }
    Ok(())
}

// ─── Host Management (5) ───────────────────────────────────────────

#[command]
#[allow(clippy::too_many_arguments)]
pub async fn port_knock_add_host(
    state: State<'_>,
    name: String,
    hostname: String,
    port: u16,
    description: String,
    ssh_user: Option<String>,
    ssh_port: Option<u16>,
    tags: Vec<String>,
) -> Result<KnockHost, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.add_host(name, hostname, port, description, ssh_user, ssh_port, tags)
        .map_err(|e| e.to_string())
}

#[command]
pub async fn port_knock_remove_host(state: State<'_>, id: String) -> Result<(), String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.remove_host(&id).map_err(|e| e.to_string())
}

#[command]
#[allow(clippy::too_many_arguments)]
pub async fn port_knock_update_host(
    state: State<'_>,
    id: String,
    name: Option<String>,
    hostname: Option<String>,
    port: Option<u16>,
    description: Option<String>,
    ssh_user: Option<Option<String>>,
    ssh_port: Option<Option<u16>>,
    tags: Option<Vec<String>>,
) -> Result<KnockHost, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.update_host(
        &id,
        name,
        hostname,
        port,
        description,
        ssh_user,
        ssh_port,
        tags,
    )
    .map_err(|e| e.to_string())
}

#[command]
pub async fn port_knock_get_host(state: State<'_>, id: String) -> Result<KnockHost, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    svc.get_host(&id).cloned().map_err(|e| e.to_string())
}

#[command]
pub async fn port_knock_list_hosts(state: State<'_>) -> Result<Vec<KnockHost>, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.list_hosts().to_vec())
}

// ─── Sequence Management (8) ───────────────────────────────────────

#[command]
pub async fn port_knock_add_sequence(
    state: State<'_>,
    sequence: KnockSequence,
) -> Result<KnockSequence, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.add_sequence(sequence).map_err(|e| e.to_string())
}

#[command]
pub async fn port_knock_remove_sequence(state: State<'_>, id: String) -> Result<(), String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.remove_sequence(&id).map_err(|e| e.to_string())
}

#[command]
pub async fn port_knock_get_sequence(
    state: State<'_>,
    id: String,
) -> Result<Option<KnockSequence>, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.get_sequence(&id).cloned())
}

#[command]
pub async fn port_knock_list_sequences(state: State<'_>) -> Result<Vec<KnockSequence>, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.list_sequences().to_vec())
}

#[command]
pub async fn port_knock_generate_sequence(
    state: State<'_>,
    params: SequenceGenParams,
) -> Result<KnockSequence, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.generate_sequence(params))
}

#[command]
pub async fn port_knock_encode_sequence_base64(
    state: State<'_>,
    sequence: KnockSequence,
) -> Result<String, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    svc.encode_sequence_base64(&sequence)
        .map_err(|e| e.to_string())
}

#[command]
pub async fn port_knock_decode_sequence_base64(
    state: State<'_>,
    encoded: String,
) -> Result<KnockSequence, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    svc.decode_sequence_base64(&encoded)
        .map_err(|e| e.to_string())
}

#[command]
pub async fn port_knock_calculate_complexity(
    state: State<'_>,
    sequence: KnockSequence,
) -> Result<f64, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.calculate_complexity_score(&sequence))
}

// ─── Knock Execution (3) ──────────────────────────────────────────

#[command]
pub async fn port_knock_execute(
    state: State<'_>,
    host_id: String,
    sequence_id: String,
    options: KnockOptions,
) -> Result<KnockResult, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.execute_knock(&host_id, &sequence_id, options)
        .map_err(|e| e.to_string())
}

#[command]
#[allow(clippy::too_many_arguments)]
pub async fn port_knock_send_spa(
    state: State<'_>,
    host_id: String,
    username: String,
    access_request: String,
    message_type: SpaMessageType,
    key_base64: String,
    options: SpaOptions,
) -> Result<SpaResult, String> {
    let key = super::base64_util::decode(&key_base64)
        .map_err(|e| format!("Invalid base64 key: {}", e))?;
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.send_spa(
        &host_id,
        &username,
        &access_request,
        message_type,
        &key,
        options,
    )
    .map_err(|e| e.to_string())
}

#[command]
pub async fn port_knock_sequence_to_knockd(
    state: State<'_>,
    sequence: KnockSequence,
) -> Result<String, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.sequence_to_knockd_format(&sequence))
}

// ─── Crypto (3) ────────────────────────────────────────────────────

#[command]
pub async fn port_knock_encrypt_payload(
    state: State<'_>,
    data_base64: String,
    key_base64: String,
    algorithm: KnockEncryption,
) -> Result<EncryptedKnockPayload, String> {
    let data = super::base64_util::decode(&data_base64)
        .map_err(|e| format!("Invalid base64 data: {}", e))?;
    let key = super::base64_util::decode(&key_base64)
        .map_err(|e| format!("Invalid base64 key: {}", e))?;
    let svc = state.lock().map_err(|e| e.to_string())?;
    svc.encrypt_payload(&data, &key, algorithm)
        .map_err(|e| e.to_string())
}

#[command]
pub async fn port_knock_decrypt_payload(
    state: State<'_>,
    payload: EncryptedKnockPayload,
    key_base64: String,
) -> Result<String, String> {
    let key = super::base64_util::decode(&key_base64)
        .map_err(|e| format!("Invalid base64 key: {}", e))?;
    let svc = state.lock().map_err(|e| e.to_string())?;
    let plaintext = svc
        .decrypt_payload(&payload, &key)
        .map_err(|e| e.to_string())?;
    Ok(super::base64_util::encode(&plaintext))
}

#[command]
pub async fn port_knock_generate_key(state: State<'_>, length: usize) -> Result<String, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    let key = svc.generate_key(length);
    Ok(super::base64_util::encode(&key))
}

// ─── Firewall (5) ──────────────────────────────────────────────────

#[command]
pub async fn port_knock_detect_firewall(state: State<'_>) -> Result<String, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.detect_firewall_command())
}

#[command]
pub async fn port_knock_firewall_accept_rule(
    state: State<'_>,
    backend: FirewallBackend,
    source_ip: String,
    port: u16,
    protocol: KnockProtocol,
    options: FirewallRuleOptions,
) -> Result<String, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.generate_firewall_accept_rule(backend, &source_ip, port, protocol, &options))
}

#[command]
#[allow(clippy::too_many_arguments)]
pub async fn port_knock_firewall_timed_rule(
    state: State<'_>,
    backend: FirewallBackend,
    source_ip: String,
    port: u16,
    protocol: KnockProtocol,
    expire_seconds: u64,
    options: FirewallRuleOptions,
) -> Result<String, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.generate_firewall_timed_rule(
        backend,
        &source_ip,
        port,
        protocol,
        expire_seconds,
        &options,
    ))
}

#[command]
pub async fn port_knock_firewall_remove_rule(
    state: State<'_>,
    backend: FirewallBackend,
    source_ip: String,
    port: u16,
    protocol: KnockProtocol,
    options: FirewallRuleOptions,
) -> Result<String, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.generate_firewall_remove_rule(backend, &source_ip, port, protocol, &options))
}

#[command]
pub async fn port_knock_firewall_backup_command(
    state: State<'_>,
    backend: FirewallBackend,
) -> Result<String, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.firewall_backup_command(backend))
}

// ─── knockd (5) ────────────────────────────────────────────────────

#[command]
pub async fn port_knock_parse_knockd_config(
    state: State<'_>,
    content: String,
) -> Result<KnockdConfig, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    svc.parse_knockd_config(&content).map_err(|e| e.to_string())
}

#[command]
pub async fn port_knock_generate_knockd_config(
    state: State<'_>,
    config: KnockdConfig,
) -> Result<String, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.generate_knockd_config(&config))
}

#[command]
pub async fn port_knock_knockd_status_command(state: State<'_>) -> Result<String, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.knockd_status_command())
}

#[command]
pub async fn port_knock_knockd_install_command(
    state: State<'_>,
    distro: String,
) -> Result<String, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.knockd_install_command(&distro))
}

#[command]
pub async fn port_knock_knockd_log_command(state: State<'_>, lines: u32) -> Result<String, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.knockd_log_command(lines))
}

// ─── fwknop (6) ────────────────────────────────────────────────────

#[command]
pub async fn port_knock_parse_fwknop_access(
    state: State<'_>,
    content: String,
) -> Result<Vec<FwknopAccessStanza>, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    svc.parse_fwknop_access_conf(&content)
        .map_err(|e| e.to_string())
}

#[command]
pub async fn port_knock_generate_fwknop_access(
    state: State<'_>,
    stanzas: Vec<FwknopAccessStanza>,
) -> Result<String, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.generate_fwknop_access_conf(&stanzas))
}

#[command]
pub async fn port_knock_build_fwknop_command(
    state: State<'_>,
    config: FwknopClientConfig,
) -> Result<String, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.build_fwknop_client_command(&config))
}

#[command]
pub async fn port_knock_fwknop_install_command(
    state: State<'_>,
    distro: String,
) -> Result<String, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.fwknop_install_command(&distro))
}

#[command]
pub async fn port_knock_generate_fwknop_keys(state: State<'_>) -> Result<(String, String), String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.generate_fwknop_keys())
}

#[command]
pub async fn port_knock_generate_fwknop_client_rc(
    state: State<'_>,
    config: FwknopClientConfig,
    stanza_name: String,
) -> Result<String, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.generate_fwknop_client_rc(&config, &stanza_name))
}

// ─── Profile Management (8) ───────────────────────────────────────

#[command]
#[allow(clippy::too_many_arguments)]
pub async fn port_knock_create_profile(
    state: State<'_>,
    name: String,
    description: String,
    method: KnockMethod,
    sequence: Option<KnockSequence>,
    spa_options: Option<SpaOptions>,
    fwknop_config: Option<FwknopClientConfig>,
    firewall_options: Option<FirewallRuleOptions>,
    knock_options: KnockOptions,
    tags: Vec<String>,
) -> Result<KnockProfile, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.create_profile(
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
    .map_err(|e| e.to_string())
}

#[command]
pub async fn port_knock_update_profile(
    state: State<'_>,
    id: String,
    profile: KnockProfile,
) -> Result<KnockProfile, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.update_profile(&id, profile).map_err(|e| e.to_string())
}

#[command]
pub async fn port_knock_delete_profile(state: State<'_>, id: String) -> Result<(), String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.delete_profile(&id).map_err(|e| e.to_string())
}

#[command]
pub async fn port_knock_get_profile(state: State<'_>, id: String) -> Result<KnockProfile, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    svc.get_profile(&id).cloned().map_err(|e| e.to_string())
}

#[command]
pub async fn port_knock_list_profiles(state: State<'_>) -> Result<Vec<KnockProfile>, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.list_profiles().to_vec())
}

#[command]
pub async fn port_knock_export_profiles(
    state: State<'_>,
    profile_ids: Vec<String>,
    format: ProfileFormat,
) -> Result<String, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    svc.export_profiles(&profile_ids, format)
        .map_err(|e| e.to_string())
}

#[command]
pub async fn port_knock_import_profiles(
    state: State<'_>,
    data: String,
    format: ProfileFormat,
) -> Result<Vec<KnockProfile>, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    svc.import_profiles(&data, format)
        .map_err(|e| e.to_string())
}

#[command]
pub async fn port_knock_search_profiles(
    state: State<'_>,
    query: String,
) -> Result<Vec<KnockProfile>, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.search_profiles(&query).into_iter().cloned().collect())
}

// ─── Scanner (4) ───────────────────────────────────────────────────

#[command]
pub async fn port_knock_check_port_command(
    state: State<'_>,
    host: String,
    port: u16,
    protocol: KnockProtocol,
    timeout_ms: u64,
) -> Result<String, String> {
    validate_probe_request(&host, port, timeout_ms)?;
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.check_port_command(&host, port, protocol, timeout_ms))
}

#[command]
pub async fn port_knock_banner_grab_command(
    state: State<'_>,
    host: String,
    port: u16,
    timeout_ms: u64,
) -> Result<String, String> {
    validate_probe_request(&host, port, timeout_ms)?;
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.banner_grab_command(&host, port, timeout_ms))
}

#[command]
pub async fn port_knock_nmap_command(
    state: State<'_>,
    host: String,
    ports: Vec<u16>,
    fast: bool,
) -> Result<String, String> {
    validate_nmap_request(&host, &ports)?;
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.nmap_scan_command(&host, &ports, fast))
}

#[command]
pub async fn port_knock_rtt_command(
    state: State<'_>,
    host: String,
    count: u32,
) -> Result<String, String> {
    validate_rtt_request(&host, count)?;
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.measure_rtt_command(&host, count))
}

// ─── History (7) ───────────────────────────────────────────────────

#[command]
pub async fn port_knock_get_history(state: State<'_>) -> Result<Vec<KnockHistoryEntry>, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.get_history().to_vec())
}

#[command]
pub async fn port_knock_filter_history(
    state: State<'_>,
    filter: HistoryFilter,
) -> Result<Vec<KnockHistoryEntry>, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.filter_history(&filter).into_iter().cloned().collect())
}

#[command]
pub async fn port_knock_get_statistics(state: State<'_>) -> Result<KnockStatistics, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.get_statistics())
}

#[command]
pub async fn port_knock_clear_history(state: State<'_>) -> Result<usize, String> {
    let mut svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.clear_history())
}

#[command]
pub async fn port_knock_export_history_json(state: State<'_>) -> Result<String, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    svc.export_history_json().map_err(|e| e.to_string())
}

#[command]
pub async fn port_knock_export_history_csv(state: State<'_>) -> Result<String, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    svc.export_history_csv().map_err(|e| e.to_string())
}

#[command]
pub async fn port_knock_get_recent_history(
    state: State<'_>,
    count: usize,
) -> Result<Vec<KnockHistoryEntry>, String> {
    let svc = state.lock().map_err(|e| e.to_string())?;
    Ok(svc.get_recent_history(count).into_iter().cloned().collect())
}

#[cfg(test)]
mod tests {
    use super::{
        validate_nmap_request, validate_probe_request, validate_rtt_request, MAX_NMAP_PORTS,
        MAX_RTT_SAMPLES, MAX_SCANNER_TIMEOUT_MS,
    };

    #[test]
    fn probe_validation_accepts_safe_targets_and_bounds() {
        assert!(validate_probe_request("host.example", 1, 1).is_ok());
        assert!(
            validate_probe_request("[2001:db8::1]", u16::MAX, MAX_SCANNER_TIMEOUT_MS).is_ok()
        );
    }

    #[test]
    fn probe_validation_rejects_host_port_and_timeout_abuse() {
        assert!(validate_probe_request("host; shutdown", 22, 1_000).is_err());
        assert!(validate_probe_request("host.example", 0, 1_000).is_err());
        assert!(validate_probe_request("host.example", 22, 0).is_err());
        assert!(
            validate_probe_request("host.example", 22, MAX_SCANNER_TIMEOUT_MS + 1).is_err()
        );
    }

    #[test]
    fn nmap_validation_enforces_host_and_port_set_bounds() {
        assert!(validate_nmap_request("host.example", &[22, 443]).is_ok());
        assert!(validate_nmap_request("host && whoami", &[22]).is_err());
        assert!(validate_nmap_request("host.example", &[]).is_err());
        assert!(validate_nmap_request("host.example", &[0]).is_err());
        assert!(
            validate_nmap_request("host.example", &vec![22; MAX_NMAP_PORTS + 1]).is_err()
        );
    }

    #[test]
    fn rtt_validation_enforces_host_and_sample_bounds() {
        assert!(validate_rtt_request("127.0.0.1", 1).is_ok());
        assert!(validate_rtt_request("host$(whoami)", 1).is_err());
        assert!(validate_rtt_request("host.example", 0).is_err());
        assert!(validate_rtt_request("host.example", MAX_RTT_SAMPLES + 1).is_err());
    }
}
