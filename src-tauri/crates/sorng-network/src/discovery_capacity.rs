//! Passive capacity snapshots and explicitly requested, bounded reverse DNS.
//!
//! Integration: `pub mod discovery_capacity;` and sysinfo 0.39.6 with only
//! `system` and `network` features. Tokio's existing `full` features suffice.
//! No sampler operation sends packets. Link speeds come from Windows IP Helper,
//! Linux sysfs, or macOS routing metadata; unsupported adapters report null.

use serde::Serialize;
use std::collections::HashMap;
use std::future::Future;
use std::net::IpAddr;
use std::process::Stdio;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
#[cfg(not(windows))]
use sysinfo::Networks;
#[path = "discovery_cpu.rs"]
mod cpu;
use cpu::{CpuSampler, CPU_INTERVAL};
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

const SAMPLE_INTERVAL: Duration = CPU_INTERVAL;
const SAMPLE_WAIT: Duration = Duration::from_millis(150);
const STALE_AFTER: Duration = Duration::from_secs(5);
const DNS_JOBS: usize = 4;
const DNS_OUTPUT_LIMIT: u64 = 4096;
const DNS_REAP_WAIT: Duration = Duration::from_millis(250);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryCapacity {
    pub logical_cpus: usize,
    pub system_logical_cpus: Option<usize>,
    pub physical_cores: Option<usize>,
    pub cpu_percent: Option<f64>,
    pub cpu_sample_interval_ms: Option<u64>,
    pub cpu_sample_age_ms: Option<u64>,
    pub interfaces: Vec<InterfaceCapacity>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InterfaceCapacity {
    pub name: String,
    pub link_speed_mbps: Option<f64>,
    pub receive_bytes_per_second: Option<f64>,
    pub transmit_bytes_per_second: Option<f64>,
}

fn byte_rate(current: u64, previous: Option<u64>, elapsed: Duration) -> Option<f64> {
    if elapsed.is_zero() {
        return None;
    }
    // A reset/wrap or newly attached interface needs a fresh baseline.
    let delta = current.checked_sub(previous?)?;
    let rate = delta as f64 / elapsed.as_secs_f64();
    rate.is_finite().then_some(rate)
}

#[cfg(any(target_os = "linux", test))]
fn parse_link_speed(value: &str) -> Option<f64> {
    let speed = value.trim().parse::<u64>().ok()?;
    // Linux SPEED_UNKNOWN can be exposed as -1 or an unsigned sentinel.
    (speed > 0 && speed < u32::MAX as u64).then_some(speed as f64)
}

#[cfg(not(windows))]
fn link_speed_mbps(name: &str, speeds: &HashMap<String, f64>) -> Option<f64> {
    #[cfg(target_os = "linux")]
    {
        let _ = speeds;
        // The name comes from the OS, but still require one path component.
        if name.is_empty() || name == "." || name == ".." || name.contains('/') {
            return None;
        }
        let path = std::path::Path::new("/sys/class/net")
            .join(name)
            .join("speed");
        parse_link_speed(&std::fs::read_to_string(path).ok()?)
    }
    #[cfg(not(target_os = "linux"))]
    {
        speeds.get(name).copied()
    }
}

#[cfg(any(windows, target_os = "macos", test))]
fn bits_per_second_to_mbps(speed: u64) -> Option<f64> {
    (speed != 0 && speed != u64::MAX && speed != u32::MAX as u64)
        .then_some(speed as f64 / 1_000_000.0)
}

#[cfg(any(windows, test))]
fn directional_link_speed(receive: u64, transmit: u64) -> Option<f64> {
    // The API has one capacity field. Use the slower measured direction when
    // both exist, so an asymmetric link is not advertised at its faster rate.
    match (
        bits_per_second_to_mbps(receive),
        bits_per_second_to_mbps(transmit),
    ) {
        (Some(rx), Some(tx)) => Some(rx.min(tx)),
        (rx, tx) => rx.or(tx),
    }
}

struct InterfaceObservation {
    name: String,
    received: u64,
    transmitted: u64,
    speed: Option<f64>,
}

#[cfg(windows)]
fn windows_interface_observation(
    row: &windows_sys::Win32::NetworkManagement::IpHelper::MIB_IF_ROW2,
) -> Option<InterfaceObservation> {
    use windows_sys::Win32::NetworkManagement::Ndis::{
        IfOperStatusUp, MediaConnectStateDisconnected,
    };
    // FilterInterface is bit 1 in the documented status bitfield. Filter-layer
    // rows repeat their parent adapter's capacity/counters; keep actual logical
    // adapters (including VPNs), but do not advertise those duplicates.
    if row.InterfaceAndOperStatusFlags._bitfield & 0b10 != 0 {
        return None;
    }
    let length = row
        .Alias
        .iter()
        .position(|c| *c == 0)
        .unwrap_or(row.Alias.len());
    let name = String::from_utf16(&row.Alias[..length]).ok()?;
    if name.is_empty() {
        return None;
    }
    Some(InterfaceObservation {
        // sysinfo also keys its Windows interfaces by MIB_IF_ROW2.Alias.
        name,
        received: row.InOctets,
        transmitted: row.OutOctets,
        speed: (row.OperStatus == IfOperStatusUp
            && row.MediaConnectState != MediaConnectStateDisconnected)
            .then(|| directional_link_speed(row.ReceiveLinkSpeed, row.TransmitLinkSpeed))
            .flatten(),
    })
}

#[cfg(windows)]
fn windows_interfaces() -> Vec<InterfaceObservation> {
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        FreeMibTable, GetIfTable2, MIB_IF_TABLE2,
    };
    struct Table(*mut MIB_IF_TABLE2);
    impl Drop for Table {
        fn drop(&mut self) {
            // SAFETY: this non-null allocation was returned by GetIfTable2.
            unsafe {
                FreeMibTable(self.0.cast());
            }
        }
    }
    let mut table = std::ptr::null_mut();
    // SAFETY: valid out-pointer; the OS initializes its allocation on success.
    if unsafe { GetIfTable2(&mut table) } != 0 || table.is_null() {
        return Vec::new();
    }
    let table = Table(table);
    // SAFETY: GetIfTable2 returns NumEntries contiguous rows, with the Table
    // field's compiler-provided alignment/padding. The guard owns the allocation
    // for the entire traversal; no pointers escape it.
    unsafe {
        let count = (*table.0).NumEntries as usize;
        let first = (*table.0).Table.as_ptr();
        (0..count)
            .filter_map(|i| windows_interface_observation(&*first.add(i)))
            .collect()
    }
}

#[cfg(target_os = "macos")]
fn native_link_speeds() -> HashMap<String, f64> {
    // NET_RT_IFLIST2 exposes 64-bit baud rates. getifaddrs' older if_data
    // saturates above 4 Gbit/s, so it cannot describe faster adapters accurately.
    let mut mib = [libc::CTL_NET, libc::PF_ROUTE, 0, 0, libc::NET_RT_IFLIST2, 0];
    let mut length = 0usize;
    // SAFETY: read-only sysctl, a valid size out-pointer, and no new value.
    if unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            mib.len() as _,
            std::ptr::null_mut(),
            &mut length,
            std::ptr::null_mut(),
            0,
        )
    } != 0
        || length == 0
        || length > 4 * 1024 * 1024
    {
        return HashMap::new();
    }
    let mut bytes = vec![0u8; length];
    // SAFETY: the writable allocation has exactly the advertised capacity.
    if unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            mib.len() as _,
            bytes.as_mut_ptr().cast(),
            &mut length,
            std::ptr::null_mut(),
            0,
        )
    } != 0
        || length > bytes.len()
    {
        return HashMap::new();
    }
    bytes.truncate(length);
    let mut speeds = HashMap::new();
    let mut offset = 0;
    while bytes.len() - offset >= 4 {
        let message_length = u16::from_ne_bytes([bytes[offset], bytes[offset + 1]]) as usize;
        if message_length < 4 || message_length > bytes.len() - offset {
            break;
        }
        if bytes[offset + 3] == libc::RTM_IFINFO2 as u8
            && message_length >= std::mem::size_of::<libc::if_msghdr2>()
        {
            // SAFETY: length checked above; copy unaligned to avoid assuming
            // Vec<u8> or routing message alignment. This ABI has no references.
            let row = unsafe {
                std::ptr::read_unaligned(bytes.as_ptr().add(offset).cast::<libc::if_msghdr2>())
            };
            if row.ifm_flags & libc::IFF_UP != 0 {
                if let Some(speed) = bits_per_second_to_mbps(row.ifm_data.ifi_baudrate) {
                    let mut name = [0 as libc::c_char; libc::IFNAMSIZ];
                    // SAFETY: buffer meets if_indextoname's IFNAMSIZ contract.
                    if !unsafe { libc::if_indextoname(row.ifm_index as _, name.as_mut_ptr()) }
                        .is_null()
                    {
                        // SAFETY: successful if_indextoname returns a NUL-terminated name.
                        if let Ok(name) =
                            unsafe { std::ffi::CStr::from_ptr(name.as_ptr()) }.to_str()
                        {
                            speeds.insert(name.to_owned(), speed);
                        }
                    }
                }
            }
        }
        offset += message_length;
    }
    speeds
}

#[cfg(not(any(windows, target_os = "macos")))]
fn native_link_speeds() -> HashMap<String, f64> {
    HashMap::new()
}

struct Sampler {
    cpu: CpuSampler,
    #[cfg(not(windows))]
    networks: Networks,
    sampled_at: Option<Instant>,
    counters: HashMap<String, (u64, u64)>,
}

impl Sampler {
    fn new() -> Self {
        Self {
            cpu: CpuSampler::new(),
            #[cfg(not(windows))]
            networks: Networks::new(),
            sampled_at: None,
            counters: HashMap::new(),
        }
    }

    fn sample(&mut self) -> DiscoveryCapacity {
        let cpu = self.cpu.sample();
        #[cfg(windows)]
        let observations = windows_interfaces();
        #[cfg(not(windows))]
        let observations: Vec<_> = {
            self.networks.refresh(true);
            let speeds = native_link_speeds();
            self.networks
                .iter()
                .map(|(name, data)| InterfaceObservation {
                    name: name.clone(),
                    received: data.total_received(),
                    transmitted: data.total_transmitted(),
                    speed: link_speed_mbps(name, &speeds),
                })
                .collect()
        };
        let now = Instant::now();
        let elapsed = self.sampled_at.map(|previous| now.duration_since(previous));
        let mut counters = HashMap::new();
        let mut interfaces: Vec<_> = observations
            .into_iter()
            .map(|data| {
                let rx = data.received;
                let tx = data.transmitted;
                let previous = self.counters.get(&data.name);
                counters.insert(data.name.clone(), (rx, tx));
                InterfaceCapacity {
                    name: data.name,
                    link_speed_mbps: data.speed,
                    receive_bytes_per_second: elapsed
                        .and_then(|dt| byte_rate(rx, previous.map(|v| v.0), dt)),
                    transmit_bytes_per_second: elapsed
                        .and_then(|dt| byte_rate(tx, previous.map(|v| v.1), dt)),
                }
            })
            .collect();
        interfaces.sort_unstable_by(|a, b| a.name.cmp(&b.name));
        self.counters = counters;
        self.sampled_at = Some(now);
        DiscoveryCapacity {
            logical_cpus: cpu.available,
            system_logical_cpus: cpu.total,
            physical_cores: cpu.physical,
            cpu_percent: cpu.percent.filter(|_| cpu.at.elapsed() <= STALE_AFTER),
            cpu_sample_interval_ms: cpu.interval_ms,
            cpu_sample_age_ms: Some(cpu.at.elapsed().as_millis().min(u64::MAX as u128) as u64),
            interfaces,
        }
    }
}

struct CapacityService {
    sampler: Mutex<Sampler>,
    cache: Mutex<Option<(Instant, DiscoveryCapacity)>>,
    sampling: Arc<Semaphore>,
}

impl CapacityService {
    fn cached(&self) -> Result<Option<(Instant, DiscoveryCapacity)>, String> {
        self.cache
            .lock()
            .map(|cache| cache.clone())
            .map_err(|_| "Capacity cache unavailable".to_string())
    }
}

fn usable_cache(cached: Option<(Instant, DiscoveryCapacity)>) -> Result<DiscoveryCapacity, String> {
    let (at, mut snapshot) =
        cached.ok_or_else(|| "Capacity sampler warming up; retry shortly".to_string())?;
    let age = at.elapsed();
    snapshot.cpu_sample_age_ms = snapshot
        .cpu_sample_age_ms
        .map(|ms| ms.saturating_add(age.as_millis().min(u64::MAX as u128) as u64));
    if snapshot
        .cpu_sample_age_ms
        .is_none_or(|ms| ms > STALE_AFTER.as_millis() as u64)
    {
        snapshot.cpu_percent = None;
    }
    if age > STALE_AFTER {
        snapshot.cpu_percent = None;
        for interface in &mut snapshot.interfaces {
            interface.link_speed_mbps = None;
            interface.receive_bytes_per_second = None;
            interface.transmit_bytes_per_second = None;
        }
    }
    Ok(snapshot)
}

/// Return a passive snapshot. First-sample CPU and byte rates are unknown.
/// Polls within one second share a cached result; no call sleeps to measure a rate.
/// Slow OS sampling continues in at most one blocking job, while callers return
/// within 150 ms with cached data (or a warming-up error before the first sample).
pub async fn get_discovery_capacity() -> Result<DiscoveryCapacity, String> {
    static SERVICE: OnceLock<Arc<CapacityService>> = OnceLock::new();
    let service = SERVICE.get_or_init(|| {
        Arc::new(CapacityService {
            sampler: Mutex::new(Sampler::new()),
            cache: Mutex::new(None),
            sampling: Arc::new(Semaphore::new(1)),
        })
    });
    let cached = service.cached()?;
    if cached.as_ref().is_some_and(|(at, _)| {
        at.elapsed() < SAMPLE_INTERVAL.max(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL)
    }) {
        return usable_cache(cached);
    }
    let Ok(permit) = service.sampling.clone().try_acquire_owned() else {
        return usable_cache(cached);
    };
    let service = Arc::clone(service);
    let sample = tokio::task::spawn_blocking(move || {
        // Keep the permit inside the job even if its caller times out or cancels.
        let _permit = permit;
        let snapshot = service
            .sampler
            .lock()
            .map_err(|_| "Capacity sampler unavailable".to_string())?
            .sample();
        *service
            .cache
            .lock()
            .map_err(|_| "Capacity cache unavailable".to_string())? =
            Some((Instant::now(), snapshot.clone()));
        Ok::<_, String>(snapshot)
    });
    match tokio::time::timeout(SAMPLE_WAIT, sample).await {
        Ok(result) => result.map_err(|error| format!("Capacity sampling failed: {error}"))?,
        Err(_) => usable_cache(cached),
    }
}

fn parse_ip(host: &str) -> Result<IpAddr, String> {
    host.parse()
        .map_err(|_| "Host must be an IPv4 or IPv6 literal".to_string())
}

fn dns_timeout(timeout_ms: u64) -> Duration {
    Duration::from_millis(timeout_ms.clamp(50, 5_000))
}

fn hostname(value: &str) -> Option<String> {
    let value = value.trim().strip_suffix('.').unwrap_or(value.trim());
    if value.is_empty() || value.len() > 253 || value.parse::<IpAddr>().is_ok() {
        return None;
    }
    if !value.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    }) {
        return None;
    }
    Some(value.to_owned())
}

#[derive(Clone, Copy)]
enum ResolverOutput {
    #[cfg(any(windows, test))]
    Hostname,
    #[cfg(any(target_os = "linux", test))]
    Hosts,
    #[cfg(any(target_os = "macos", test))]
    DirectoryService,
}

fn parse_resolver_output(bytes: &[u8], format: ResolverOutput) -> Option<String> {
    let output = std::str::from_utf8(bytes).ok()?;
    let candidate = match format {
        #[cfg(any(windows, test))]
        ResolverOutput::Hostname => output.trim(),
        #[cfg(any(target_os = "linux", test))]
        ResolverOutput::Hosts => output.lines().find_map(|line| {
            let mut fields = line.split_whitespace();
            fields.next()?.parse::<IpAddr>().ok()?;
            fields.next()
        })?,
        #[cfg(any(target_os = "macos", test))]
        ResolverOutput::DirectoryService => output
            .lines()
            .find_map(|line| line.trim().strip_prefix("name:"))?
            .trim(),
    };
    hostname(candidate)
}

fn resolver_command(ip: IpAddr) -> Result<(Command, ResolverOutput), String> {
    #[cfg(windows)]
    {
        // Canonical IP text cannot contain PowerShell syntax. No profile scripts
        // or interactive windows; Resolve-DnsName queries PTR only.
        let root = std::env::var_os("SystemRoot").ok_or("SystemRoot unavailable")?;
        let mut command = Command::new(
            std::path::PathBuf::from(root).join("System32/WindowsPowerShell/v1.0/powershell.exe"),
        );
        command.creation_flags(0x0800_0000).args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"])
            .arg(format!("$ErrorActionPreference='Stop'; try {{ Resolve-DnsName -Name '{ip}' -Type PTR -DnsOnly -QuickTimeout | Where-Object Type -eq PTR | Select-Object -First 1 -ExpandProperty NameHost }} catch {{ exit 1 }}"));
        Ok((command, ResolverOutput::Hostname))
    }
    #[cfg(target_os = "linux")]
    {
        // glibc getent uses gethostbyaddr for a numeric hosts key, honoring NSS.
        // Absence (e.g. a minimal musl installation) is reported without fallback.
        let mut command = Command::new("/usr/bin/getent");
        command.args(["hosts", &ip.to_string()]);
        Ok((command, ResolverOutput::Hosts))
    }
    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("/usr/bin/dscacheutil");
        let key = if ip.is_ipv6() {
            "ipv6_address"
        } else {
            "ip_address"
        };
        command.args(["-q", "host", "-a", key, &ip.to_string()]);
        Ok((command, ResolverOutput::DirectoryService))
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        let _ = ip;
        Err("Reverse DNS is unsupported on this platform".to_string())
    }
}

/// Retain the permit through cleanup even if the requesting future disappears.
/// No queue: overload is explicit and never creates additional OS jobs.
async fn bounded_dns_job<F, Fut>(
    gate: Arc<Semaphore>,
    budget: Duration,
    operation: F,
) -> Result<Option<String>, String>
where
    F: FnOnce(tokio::time::Instant, OwnedSemaphorePermit) -> Fut + Send + 'static,
    Fut: Future<Output = Result<Option<String>, String>> + Send + 'static,
{
    let permit = gate
        .try_acquire_owned()
        .map_err(|_| "Reverse DNS capacity exhausted".to_string())?;
    let deadline = tokio::time::Instant::now() + budget;
    let job = tokio::spawn(async move { operation(deadline, permit).await });
    match tokio::time::timeout_at(deadline, job).await {
        Ok(result) => result.map_err(|error| format!("Reverse DNS worker failed: {error}"))?,
        Err(_) => Ok(None),
    }
}

async fn resolve_process(
    ip: IpAddr,
    deadline: tokio::time::Instant,
    permit: OwnedSemaphorePermit,
) -> Result<Option<String>, String> {
    let (command, format) = resolver_command(ip)?;
    run_resolver_command(command, format, deadline, permit).await
}

async fn run_resolver_command(
    mut command: Command,
    format: ResolverOutput,
    deadline: tokio::time::Instant,
    permit: OwnedSemaphorePermit,
) -> Result<Option<String>, String> {
    // A busy executor must not launch a lookup whose deadline already passed.
    if tokio::time::Instant::now() >= deadline {
        return Ok(None);
    }
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("Could not start reverse DNS resolver: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Reverse DNS output unavailable")?;
    let mut output = Vec::new();
    let result = tokio::time::timeout_at(deadline, async {
        stdout
            .take(DNS_OUTPUT_LIMIT + 1)
            .read_to_end(&mut output)
            .await
            .map_err(|error| format!("Could not read reverse DNS output: {error}"))?;
        if output.len() as u64 > DNS_OUTPUT_LIMIT {
            return Err("Reverse DNS output exceeded limit".to_string());
        }
        let status = child
            .wait()
            .await
            .map_err(|error| format!("Could not wait for reverse DNS: {error}"))?;
        Ok(if status.success() {
            parse_resolver_output(&output, format)
        } else {
            None
        })
    })
    .await;
    // Also cover output overflow/read failures: terminate and reap before making
    // this slot reusable. If reaping cannot be confirmed, quarantine the slot.
    let _ = child.start_kill();
    if !matches!(
        tokio::time::timeout(DNS_REAP_WAIT, child.wait()).await,
        Ok(Ok(_))
    ) {
        permit.forget();
    }
    match result {
        Ok(result) => result,
        Err(_) => Ok(None),
    }
}

/// Resolve only a literal IP. Deadline is clamped to 50..=5000 ms; no record or
/// timeout returns null, while invalid input, unavailable helpers and saturation
/// return an error. At most four hidden OS resolver processes run concurrently.
/// Unlike `dns_lookup::lookup_addr`, these jobs can be terminated on timeout.
/// Windows returns DNS PTR records only (not hosts-file, mDNS or NetBIOS names);
/// Linux/macOS use their system lookup helpers. Missing names are normal.
pub async fn discovery_reverse_dns(
    host: String,
    timeout_ms: u64,
) -> Result<Option<String>, String> {
    let ip = parse_ip(&host)?;
    static DNS_GATE: OnceLock<Arc<Semaphore>> = OnceLock::new();
    let gate = DNS_GATE
        .get_or_init(|| Arc::new(Semaphore::new(DNS_JOBS)))
        .clone();
    bounded_dns_job(gate, dns_timeout(timeout_ms), move |deadline, permit| {
        resolve_process(ip, deadline, permit)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::oneshot;

    #[test]
    fn metric_clamps_and_baselines() {
        assert_eq!(
            byte_rate(200, Some(100), Duration::from_millis(500)),
            Some(200.0)
        );
        assert_eq!(byte_rate(100, Some(100), Duration::from_secs(1)), Some(0.0));
        assert_eq!(byte_rate(100, None, Duration::from_secs(1)), None);
        assert_eq!(byte_rate(10, Some(100), Duration::from_secs(1)), None);
        assert_eq!(byte_rate(100, Some(0), Duration::ZERO), None);
        assert!(byte_rate(u64::MAX, Some(0), Duration::from_nanos(1))
            .unwrap()
            .is_finite());
        assert_eq!(parse_link_speed("1000\n"), Some(1000.0));
        for value in [
            "0",
            "-1",
            "4294967295",
            "18446744073709551615",
            "NaN",
            "unknown",
        ] {
            assert_eq!(parse_link_speed(value), None);
        }
    }

    #[test]
    fn measured_link_capacity_handles_asymmetric_and_unknown_rates() {
        assert_eq!(
            directional_link_speed(1_000_000_000, 1_000_000_000),
            Some(1000.0)
        );
        assert_eq!(
            directional_link_speed(1_000_000_000, 100_000_000),
            Some(100.0)
        );
        assert_eq!(directional_link_speed(0, 2_500_000_000), Some(2500.0));
        assert_eq!(
            directional_link_speed(10_000_000_000, u64::MAX),
            Some(10000.0)
        );
        assert_eq!(directional_link_speed(0, u64::MAX), None);
        assert_eq!(bits_per_second_to_mbps(u32::MAX as u64), None);
    }

    #[cfg(windows)]
    #[test]
    fn windows_rows_preserve_alias_counters_and_operational_speed() {
        use windows_sys::Win32::NetworkManagement::{
            IpHelper::MIB_IF_ROW2,
            Ndis::{IfOperStatusUp, MediaConnectStateDisconnected},
        };
        let mut row = MIB_IF_ROW2::default();
        let name = "Ethernet á";
        for (slot, value) in row.Alias.iter_mut().zip(name.encode_utf16()) {
            *slot = value;
        }
        row.InOctets = 12345;
        row.OutOctets = 67890;
        row.ReceiveLinkSpeed = 10_000_000_000;
        row.TransmitLinkSpeed = 2_500_000_000;
        row.OperStatus = IfOperStatusUp;
        let observation = windows_interface_observation(&row).unwrap();
        assert_eq!(observation.name, name);
        assert_eq!(observation.received, 12345);
        assert_eq!(observation.transmitted, 67890);
        assert_eq!(observation.speed, Some(2500.0));
        row.InterfaceAndOperStatusFlags._bitfield = 0b10;
        assert!(windows_interface_observation(&row).is_none());
        row.InterfaceAndOperStatusFlags._bitfield = 0;
        row.MediaConnectState = MediaConnectStateDisconnected;
        assert_eq!(windows_interface_observation(&row).unwrap().speed, None);
        row.Alias[0] = 0xd800;
        assert!(windows_interface_observation(&row).is_none());
    }

    #[tokio::test]
    async fn input_validation_never_invokes_dns() {
        for host in [
            "",
            "localhost",
            "example.com",
            "-n",
            "127.0.0.1;exit",
            "127.0.0.1\n",
            "[::1]",
            "fe80::1%eth0",
        ] {
            assert!(discovery_reverse_dns(host.to_owned(), 100)
                .await
                .unwrap_err()
                .contains("literal"));
        }
        assert_eq!(parse_ip("2001:0db8::1").unwrap().to_string(), "2001:db8::1");
        assert!(parse_ip("127.0.0.1").is_ok());
        for (input, expected) in [
            (0, 50),
            (49, 50),
            (50, 50),
            (1000, 1000),
            (5001, 5000),
            (u64::MAX, 5000),
        ] {
            assert_eq!(dns_timeout(input), Duration::from_millis(expected));
        }
    }

    #[test]
    fn output_parsing_is_bounded_and_rejects_numeric_or_malformed_names() {
        assert_eq!(
            parse_resolver_output(b"printer.example.test.\r\n", ResolverOutput::Hostname)
                .as_deref(),
            Some("printer.example.test")
        );
        assert_eq!(
            parse_resolver_output(
                b"192.0.2.1 printer.example.test alias\n",
                ResolverOutput::Hosts
            )
            .as_deref(),
            Some("printer.example.test")
        );
        assert_eq!(
            parse_resolver_output(
                b"name: printer.example.test\nip_address: 192.0.2.1\n",
                ResolverOutput::DirectoryService
            )
            .as_deref(),
            Some("printer.example.test")
        );
        for value in [
            "",
            "192.0.2.1",
            "2001:db8::1",
            "bad name",
            "bad\nname",
            "bad..name",
            "-bad.test",
            "bad-.test",
            ".",
            "bad<script>",
        ] {
            assert_eq!(hostname(value), None);
        }
        assert_eq!(hostname(&"x".repeat(254)), None);
        assert_eq!(hostname(&format!("{}.test", "x".repeat(64))), None);
        assert_eq!(
            parse_resolver_output(&[0xff], ResolverOutput::Hostname),
            None
        );
    }

    #[test]
    fn snapshot_serializes_camel_case_and_expires_rates() {
        let snapshot = DiscoveryCapacity {
            logical_cpus: 8,
            system_logical_cpus: Some(80),
            physical_cores: Some(40),
            cpu_percent: Some(12.0),
            cpu_sample_interval_ms: Some(1000),
            cpu_sample_age_ms: Some(0),
            interfaces: vec![InterfaceCapacity {
                name: "test".into(),
                link_speed_mbps: Some(1000.0),
                receive_bytes_per_second: Some(50.0),
                transmit_bytes_per_second: Some(20.0),
            }],
        };
        let value = serde_json::to_value(&snapshot).unwrap();
        assert_eq!(value["logicalCpus"], 8);
        assert_eq!(value["systemLogicalCpus"], 80);
        assert_eq!(value["physicalCores"], 40);
        assert_eq!(value["cpuSampleIntervalMs"], 1000);
        assert_eq!(value["cpuPercent"], 12.0);
        assert_eq!(value["interfaces"][0]["receiveBytesPerSecond"], 50.0);
        assert_eq!(value["interfaces"][0]["transmitBytesPerSecond"], 20.0);
        assert_eq!(value["interfaces"][0]["linkSpeedMbps"], 1000.0);
        let stale = usable_cache(Some((
            Instant::now() - STALE_AFTER - Duration::from_secs(1),
            snapshot,
        )))
        .unwrap();
        assert_eq!(stale.cpu_percent, None);
        assert_eq!(stale.interfaces[0].receive_bytes_per_second, None);
        assert_eq!(stale.interfaces[0].transmit_bytes_per_second, None);
        assert!(usable_cache(None).is_err());
    }

    #[tokio::test]
    async fn passive_first_sample_has_no_invented_cpu_or_traffic_rates() {
        let snapshot = tokio::task::spawn_blocking(|| Sampler::new().sample())
            .await
            .unwrap();
        assert!(snapshot.logical_cpus > 0);
        assert_eq!(snapshot.cpu_percent, None);
        for interface in &snapshot.interfaces {
            assert_eq!(interface.receive_bytes_per_second, None);
            assert_eq!(interface.transmit_bytes_per_second, None);
        }
        assert!(snapshot
            .interfaces
            .windows(2)
            .all(|pair| pair[0].name < pair[1].name));
    }

    #[tokio::test]
    async fn timed_out_jobs_keep_slots_until_cleanup_finishes() {
        let gate = Arc::new(Semaphore::new(1));
        let (release, released) = oneshot::channel::<()>();
        let (done, finished) = oneshot::channel();
        let result = bounded_dns_job(gate.clone(), Duration::ZERO, move |_, permit| async move {
            let _ = released.await;
            drop(permit);
            let _ = done.send(());
            Ok(Some("local.test".into()))
        })
        .await
        .unwrap();
        assert_eq!(result, None);
        assert_eq!(gate.available_permits(), 0);
        let saturated = bounded_dns_job(gate.clone(), Duration::from_secs(1), |_, _| async {
            panic!("saturated gate must not start work");
        })
        .await
        .unwrap_err();
        assert!(saturated.contains("capacity exhausted"));
        release.send(()).unwrap();
        finished.await.unwrap();
        assert_eq!(gate.available_permits(), 1);
    }

    #[tokio::test]
    async fn cancellation_does_not_release_a_running_jobs_slot() {
        let gate = Arc::new(Semaphore::new(1));
        let (started, start) = oneshot::channel();
        let (release, released) = oneshot::channel();
        let (done, finished) = oneshot::channel();
        let task_gate = gate.clone();
        let caller = tokio::spawn(async move {
            bounded_dns_job(
                task_gate,
                Duration::from_secs(1),
                move |_, permit| async move {
                    let _ = started.send(());
                    let _ = released.await;
                    drop(permit);
                    let _ = done.send(());
                    Ok(None)
                },
            )
            .await
        });
        start.await.unwrap();
        caller.abort();
        let _ = caller.await;
        assert_eq!(gate.available_permits(), 0);
        release.send(()).unwrap();
        finished.await.unwrap();
        assert_eq!(gate.available_permits(), 1);
    }

    #[tokio::test]
    async fn completed_jobs_return_results_and_release_slots() {
        let gate = Arc::new(Semaphore::new(1));
        let result = bounded_dns_job(gate.clone(), Duration::from_secs(1), |_, _permit| async {
            Ok(Some("local.test".into()))
        })
        .await
        .unwrap();
        assert_eq!(result.as_deref(), Some("local.test"));
        assert_eq!(gate.available_permits(), 1);
        assert!(
            bounded_dns_job(gate.clone(), Duration::from_secs(1), |_, _permit| async {
                Err("injected failure".into())
            })
            .await
            .is_err()
        );
        assert_eq!(gate.available_permits(), 1);
    }

    #[test]
    fn resolver_arguments_only_use_canonical_ip() {
        for host in ["192.0.2.1", "2001:0db8::1"] {
            let ip = parse_ip(host).unwrap();
            let (command, _) = resolver_command(ip).unwrap();
            let args: Vec<_> = command
                .as_std()
                .get_args()
                .map(|arg| arg.to_string_lossy().into_owned())
                .collect();
            #[cfg(windows)]
            {
                assert!(args.contains(&"-NonInteractive".to_string()));
                assert!(args
                    .last()
                    .unwrap()
                    .contains(&format!("-Name '{ip}' -Type PTR -DnsOnly")));
            }
            #[cfg(not(windows))]
            assert_eq!(args.last().unwrap(), &ip.to_string());
            #[cfg(target_os = "macos")]
            assert_eq!(
                args[3],
                if ip.is_ipv6() {
                    "ipv6_address"
                } else {
                    "ip_address"
                }
            );
        }
    }

    // A child copy of this test executable exercises real pipes and process
    // cleanup, without depending on an installed DNS helper or sending packets.
    #[test]
    fn local_process_fixture() {
        match std::env::var("SORNG_DISCOVERY_CAPACITY_FIXTURE").as_deref() {
            Ok("hostname") => println!("\n192.0.2.1 local.test"),
            Ok("overflow") => println!("{}", "x".repeat(DNS_OUTPUT_LIMIT as usize + 1)),
            Ok("stall") => std::thread::sleep(Duration::from_secs(30)),
            _ => (),
        }
    }

    fn fixture_command(mode: &str) -> Command {
        let mut command = Command::new(std::env::current_exe().unwrap());
        // module_path! also includes the crate name, which libtest omits.
        let module = module_path!()
            .split_once("::")
            .map(|(_, path)| path)
            .unwrap_or("tests");
        command
            .args([
                "--exact",
                &format!("{module}::local_process_fixture"),
                "--nocapture",
            ])
            .env("SORNG_DISCOVERY_CAPACITY_FIXTURE", mode);
        #[cfg(windows)]
        command.creation_flags(0x0800_0000);
        command
    }

    #[tokio::test]
    async fn child_output_is_capped_and_timed_out_children_are_reaped() {
        let gate = Arc::new(Semaphore::new(1));
        for mode in ["hostname", "overflow", "stall"] {
            let permit = gate.clone().try_acquire_owned().unwrap();
            let budget = if mode == "stall" {
                Duration::from_millis(100)
            } else {
                Duration::from_secs(5)
            };
            let result = run_resolver_command(
                fixture_command(mode),
                ResolverOutput::Hosts,
                tokio::time::Instant::now() + budget,
                permit,
            )
            .await;
            match mode {
                "hostname" => assert_eq!(result.unwrap().as_deref(), Some("local.test")),
                "overflow" => assert!(result.unwrap_err().contains("exceeded limit")),
                "stall" => assert_eq!(result.unwrap(), None),
                _ => unreachable!(),
            }
            assert_eq!(
                gate.available_permits(),
                1,
                "child must be reaped before slot reuse"
            );
        }
    }
}
