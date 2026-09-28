//! Platform details. No shell, route inference, DNS lookup or passive-cache scan.
use super::{DiscoveryProbeCapabilities, DiscoveryProbeCapability, Outcome, SINGLES};
use getifaddrs::{Interface, InterfaceFlags};
use std::net::{IpAddr, Ipv4Addr};
use std::path::{Path, PathBuf};
use std::process::{ExitStatus, Stdio};
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::Semaphore;
use tokio::time::{timeout_at, Instant};

const NATIVE_LIMIT: usize = 32;
static NATIVE_PERMITS: OnceLock<Arc<Semaphore>> = OnceLock::new();

/// Secondary protection for explicit Rust-future cancellation. The normal path
/// ALWAYS drains on timeout so even a frontend cap of one is preserved.
/// A dropped JoinHandle does not stop a running blocking function. Keep its
/// permit IN the closure, and abort queued (not yet running) work on drop.
struct AbortQueued<T>(tokio::task::JoinHandle<T>);
impl<T> Drop for AbortQueued<T> {
    fn drop(&mut self) {
        self.0.abort();
    }
}

async fn blocking<T: Send + 'static>(
    deadline: Instant,
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    let permits = NATIVE_PERMITS
        .get_or_init(|| Arc::new(Semaphore::new(NATIVE_LIMIT)))
        .clone();
    blocking_with_permits(permits, deadline, work).await
}

async fn blocking_with_permits<T: Send + 'static>(
    permits: Arc<Semaphore>,
    deadline: Instant,
    work: impl FnOnce() -> T + Send + 'static,
) -> Result<T, String> {
    let permit = timeout_at(deadline, permits.acquire_owned())
        .await
        .map_err(|_| "Native probe capacity deadline expired; no probe sent".to_string())?
        .map_err(|_| "Native probe capacity is closed; no probe sent".to_string())?;
    let mut task = AbortQueued(tokio::task::spawn_blocking(move || {
        let _permit = permit;
        if Instant::now() >= deadline {
            return Err("Native probe deadline expired before dispatch; no probe sent".to_string());
        }
        Ok(work())
    }));
    match timeout_at(deadline, &mut task.0).await {
        Ok(result) if Instant::now() <= deadline => result.map_err(|e| format!("Native probe worker failed: {e}"))?,
        Ok(_) => Err("Native probe timed out; OS call drained before returning (may exceed the requested budget)".into()),
        Err(_) => {
            // Do NOT return until the actual OS operation has finished. In
            // particular SendARP has no timeout/cancel parameter. Even a late
            // success remains a timeout result; the budget was exceeded.
            let _ = (&mut task.0).await;
            Err("Native probe timed out; OS call drained before returning (may exceed the requested budget)".into())
        }
    }
}

#[cfg(windows)]
fn native_error(error: String) -> Outcome {
    if error.starts_with("Native probe timed out") {
        Outcome::unresponsive(error)
    } else {
        Outcome::unavailable(error)
    }
}

fn executable(name: &str) -> Option<PathBuf> {
    let mut directories: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| {
            std::env::split_paths(&p)
                .filter(|p| p.is_absolute())
                .collect()
        })
        .unwrap_or_default();
    #[cfg(unix)]
    directories.extend(
        [
            "/usr/sbin",
            "/sbin",
            "/usr/bin",
            "/bin",
            "/opt/homebrew/bin",
            "/usr/local/bin",
        ]
        .map(PathBuf::from),
    );
    #[cfg(windows)]
    if let Some(root) = std::env::var_os("SystemRoot") {
        directories.insert(0, PathBuf::from(root).join("System32"));
    }
    directories.into_iter().find_map(|dir| {
        let path = dir.join(if cfg!(windows) {
            format!("{name}.exe")
        } else {
            name.to_string()
        });
        let metadata = std::fs::metadata(&path).ok()?;
        if !metadata.is_file() {
            return None;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o111 == 0 {
                return None;
            }
        }
        Some(path)
    })
}

fn ping_program(ip: IpAddr) -> &'static str {
    if ip.is_ipv6()
        && cfg!(any(
            target_os = "macos",
            target_os = "freebsd",
            target_os = "openbsd",
            target_os = "netbsd"
        ))
    {
        "ping6"
    } else {
        "ping"
    }
}

fn command(program: &Path) -> Command {
    let mut command = Command::new(program);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    command.env("LC_ALL", "C");
    #[cfg(windows)]
    command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    command
}

fn ping_command(program: &Path, ip: IpAddr, budget: Duration) -> Command {
    let mut cmd = command(program);
    #[cfg(windows)]
    {
        cmd.args(["-n", "1", "-w", &budget.as_millis().max(1).to_string()]);
        cmd.arg(if ip.is_ipv4() { "-4" } else { "-6" });
    }
    #[cfg(not(windows))]
    {
        let _ = budget;
        cmd.args(["-n", "-c", "1"]);
        if ip.is_ipv6() && ping_program(ip) == "ping" {
            cmd.arg("-6");
        }
    }
    cmd.arg(ip.to_string());
    cmd
}

struct Output {
    status: ExitStatus,
    stdout: String,
    stderr: String,
}

// Output is bounded too. Dropping this future drops the child with kill_on_drop.
async fn output(mut command: Command) -> Result<Output, String> {
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not start probe command: {e}"))?;
    let stdout = child.stdout.take().ok_or("Probe stdout was not piped")?;
    let stderr = child.stderr.take().ok_or("Probe stderr was not piped")?;
    let mut out = Vec::new();
    let mut err = Vec::new();
    let mut stdout = stdout.take(16 * 1024);
    let mut stderr = stderr.take(16 * 1024);
    let (status, out_result, err_result) = tokio::join!(
        child.wait(),
        stdout.read_to_end(&mut out),
        stderr.read_to_end(&mut err)
    );
    out_result.map_err(|e| format!("Could not read probe output: {e}"))?;
    err_result.map_err(|e| format!("Could not read probe diagnostics: {e}"))?;
    Ok(Output {
        status: status.map_err(|e| format!("Could not wait for probe: {e}"))?,
        stdout: String::from_utf8_lossy(&out).into_owned(),
        stderr: String::from_utf8_lossy(&err).into_owned(),
    })
}

fn command_failure(output: &Output) -> Outcome {
    let diagnostics = format!("{} {}", output.stderr.trim(), output.stdout.trim());
    let lower = diagnostics.to_lowercase();
    if !output.stderr.trim().is_empty()
        || [
            "permission",
            "not permitted",
            "access denied",
            "must be root",
            "cap_net_raw",
            "operation not supported",
            "invalid option",
            "unknown option",
            "general failure",
        ]
        .iter()
        .any(|reason| lower.contains(reason))
    {
        Outcome::unavailable(format!(
            "Probe command unavailable ({}): {}",
            output.status,
            diagnostics.trim()
        ))
    } else {
        Outcome::unresponsive(format!(
            "No reply ({}): {}",
            output.status,
            diagnostics.trim()
        ))
    }
}

pub(super) async fn system_ping(ip: IpAddr, budget: Duration) -> Outcome {
    let Some(program) = executable(ping_program(ip)) else {
        return Outcome::unavailable(format!("{} is not installed", ping_program(ip)));
    };
    match output(ping_command(&program, ip, budget)).await {
        Ok(result) if result.status.success() => {
            // Windows ping can return zero for ICMP error replies, in either
            // family. Require positive target echo evidence, not packet counts.
            #[cfg(windows)]
            {
                windows_echo_outcome(&result.stdout, ip)
            }
            #[cfg(not(windows))]
            {
                Outcome::responsive()
            }
        }
        Ok(result) => command_failure(&result),
        Err(error) => Outcome::unavailable(error),
    }
}

#[cfg(any(windows, test))]
fn windows_echo_outcome(output: &str, ip: IpAddr) -> Outcome {
    if windows_echo_evidence(output, ip) {
        Outcome::responsive()
    } else if ["unreachable", "timed out", "ttl expired"]
        .iter()
        .any(|message| output.to_ascii_lowercase().contains(message))
    {
        Outcome::unresponsive("System ping returned an error reply or timeout")
    } else {
        Outcome::unavailable("System ping output contains no verifiable target echo; unsupported localized output cannot establish host status")
    }
}

#[cfg(any(windows, test))]
fn windows_echo_evidence(output: &str, ip: IpAddr) -> bool {
    output.lines().any(|line| {
        let from_target = line.split_whitespace().any(|token| {
            // Strip exactly the response separator, preserving IPv6's colons.
            let address = token.strip_suffix(':').unwrap_or(token);
            address.parse::<IpAddr>().ok() == Some(ip)
        });
        let lower = line.to_ascii_lowercase();
        from_target
            && if ip.is_ipv4() {
                lower.contains("ttl=")
            } else {
                // The RTT value/unit/separator is independent of the localized
                // label: time=2ms, tempo<1ms, temps=1,5ms, etc.
                lower.split_whitespace().any(|token| {
                    token
                        .rsplit_once(['=', '<'])
                        .map(|(_, value)| value)
                        .and_then(|v| v.strip_suffix("ms"))
                        .is_some_and(|v| {
                            v.chars().any(|c| c.is_ascii_digit())
                                && v.chars()
                                    .all(|c| c.is_ascii_digit() || c == '.' || c == ',')
                                && v.chars().filter(|c| *c == '.' || *c == ',').count() <= 1
                        })
                })
            }
    })
}

#[derive(Debug, Clone)]
struct DirectLink {
    name: String,
    source: Ipv4Addr,
    prefix: u32,
}

fn direct_link(interface: Interface, target: Ipv4Addr) -> Option<DirectLink> {
    let flags = interface.flags;
    if !flags.contains(InterfaceFlags::UP | InterfaceFlags::BROADCAST)
        || flags.intersects(InterfaceFlags::LOOPBACK | InterfaceFlags::POINTTOPOINT)
    {
        return None;
    }
    #[cfg(windows)]
    if !flags.contains(InterfaceFlags::RUNNING) {
        return None;
    }
    let (IpAddr::V4(source), IpAddr::V4(mask)) =
        (interface.address.ip_addr()?, interface.address.netmask()?)
    else {
        return None;
    };
    if target.is_loopback()
        || target.is_multicast()
        || target.octets()[0] == 0
        || target.octets()[0] >= 240
        || source.is_unspecified()
        || source.is_loopback()
    {
        return None;
    }
    let mask = u32::from(mask);
    let prefix = mask.leading_ones();
    if prefix == 0 || prefix == 32 || mask.count_ones() != prefix {
        return None;
    }
    let network = u32::from(source) & mask;
    let destination = u32::from(target);
    if destination & mask != network {
        return None;
    }
    // /31 is a valid two-host link; /0 and /32 cannot establish ARP suitability.
    if prefix < 31 && (destination == network || destination == network | !mask) {
        return None;
    }
    Some(DirectLink {
        name: interface.name,
        source,
        prefix,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ArpingDialect {
    Iputils,
    Habets,
}

fn arping_dialect(help: &str) -> Option<ArpingDialect> {
    if help.contains("Thomas Habets") || help.contains("ThomasHabets/arping") {
        Some(ArpingDialect::Habets)
    } else if help.contains("iputils")
        || (help.contains("-I <") && help.contains("-s <") && help.contains("interface"))
        || (help.contains("-I <device>") && help.contains("-s <source>"))
    {
        Some(ArpingDialect::Iputils)
    } else {
        None
    }
}

#[derive(Debug)]
pub(super) struct ArpContext {
    link: DirectLink,
    #[cfg(not(windows))]
    program: PathBuf,
    #[cfg(not(windows))]
    dialect: ArpingDialect,
}

type ArpingInstallation = Result<(PathBuf, ArpingDialect), String>;
static ARPING_CACHE: OnceLock<tokio::sync::Mutex<Option<(Instant, ArpingInstallation)>>> =
    OnceLock::new();

async fn arping_installation(deadline: Instant) -> ArpingInstallation {
    // Serialize cache misses so a sweep never starts thousands of help commands.
    // Cache only the executable/dialect, never mutable local-interface state.
    let cache = ARPING_CACHE.get_or_init(|| tokio::sync::Mutex::new(None));
    let mut cache = timeout_at(deadline, cache.lock())
        .await
        .map_err(|_| "arping capability cache deadline expired".to_string())?;
    if let Some((checked, result)) = &*cache {
        let ttl = if result.is_ok() {
            Duration::from_secs(30)
        } else {
            Duration::from_secs(2)
        };
        if checked.elapsed() < ttl {
            return result.clone();
        }
    }
    let result = detect_arping_installation(deadline).await;
    *cache = Some((Instant::now(), result.clone()));
    result
}

async fn detect_arping_installation(deadline: Instant) -> ArpingInstallation {
    let path = executable("arping").ok_or("arping is not installed")?;
    let mut cmd = command(&path);
    cmd.arg("-h"); // Both supported dialects exit without sending any packet.
    let result = timeout_at(deadline, output(cmd))
        .await
        .map_err(|_| "arping dialect check timed out".to_string())??;
    let help = format!("{}\n{}", result.stdout, result.stderr);
    let dialect = arping_dialect(&help)
        .ok_or("Installed arping dialect is unsupported; expected iputils or Thomas Habets")?;
    if cfg!(target_os = "macos") && dialect != ArpingDialect::Habets {
        return Err("macOS ARP requires Thomas Habets arping".into());
    }
    Ok((path, dialect))
}

pub(super) async fn prepare_arp(ip: IpAddr, deadline: Instant) -> Result<ArpContext, String> {
    let IpAddr::V4(target) = ip else {
        return Err("ARP requires IPv4".into());
    };
    let link = blocking(deadline, move || {
        let interfaces = getifaddrs::getifaddrs()
            .map_err(|e| format!("Cannot enumerate direct-link interfaces: {e}"))?;
        let mut links: Vec<_> = interfaces
            .filter_map(|interface| direct_link(interface, target))
            .collect();
        links.sort_by(|a, b| {
            b.prefix
                .cmp(&a.prefix)
                .then_with(|| a.name.cmp(&b.name))
                .then_with(|| a.source.cmp(&b.source))
        });
        links.into_iter().next().ok_or_else(|| {
            "ARP requires a directly attached IPv4 broadcast interface; no gateway probing"
                .to_string()
        })
    })
    .await??;
    #[cfg(windows)]
    {
        Ok(ArpContext { link })
    }
    #[cfg(not(windows))]
    {
        let (program, dialect) = arping_installation(deadline).await?;
        Ok(ArpContext {
            link,
            program,
            dialect,
        })
    }
}

#[cfg(any(not(windows), test))]
fn arping_command(
    program: &Path,
    dialect: ArpingDialect,
    link: &DirectLink,
    target: Ipv4Addr,
) -> Command {
    let mut cmd = command(program);
    cmd.args(["-c", "1"]);
    match dialect {
        ArpingDialect::Iputils => {
            cmd.args(["-I", &link.name, "-s", &link.source.to_string()]);
        }
        ArpingDialect::Habets => {
            cmd.args(["-i", &link.name, "-S", &link.source.to_string()]);
        }
    }
    cmd.arg(target.to_string());
    cmd
}

#[cfg(any(not(windows), test))]
fn reply_mac(output: &str) -> Option<String> {
    output
        .split(|c: char| !c.is_ascii_hexdigit() && c != ':')
        .find_map(|token| {
            let parts: Vec<_> = token.split(':').collect();
            if parts.len() != 6 || parts.iter().any(|part| part.len() != 2) {
                return None;
            }
            let bytes: Option<Vec<_>> = parts
                .iter()
                .map(|part| u8::from_str_radix(part, 16).ok())
                .collect();
            let bytes = bytes?;
            if bytes.iter().all(|byte| *byte == 0) || bytes[0] & 1 != 0 {
                return None;
            }
            Some(token.to_ascii_lowercase())
        })
}

pub(super) async fn arp(ip: IpAddr, context: &ArpContext, budget: Duration) -> Outcome {
    let IpAddr::V4(target) = ip else {
        return Outcome::unavailable("ARP requires IPv4");
    };
    #[cfg(windows)]
    {
        let source = context.link.source;
        match blocking(Instant::now() + budget, move || windows_arp(target, source)).await {
            Ok(outcome) => outcome,
            Err(error) => native_error(error),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = budget; // The sequence's deadline kills and drops the command.
        match output(arping_command(
            &context.program,
            context.dialect,
            &context.link,
            target,
        ))
        .await
        {
            Ok(result) if result.status.success() => Outcome {
                mac: reply_mac(&result.stdout),
                ..Outcome::responsive()
            },
            Ok(result) => command_failure(&result),
            Err(error) => Outcome::unavailable(error),
        }
    }
}

pub(super) async fn native_ping(ip: IpAddr, budget: Duration) -> Outcome {
    #[cfg(windows)]
    {
        let IpAddr::V4(target) = ip else {
            return Outcome::unavailable("Native ICMP requires IPv4");
        };
        let deadline = Instant::now() + budget;
        match blocking(deadline, move || {
            windows_ping(target, deadline.saturating_duration_since(Instant::now()))
        })
        .await
        {
            Ok(outcome) => outcome,
            Err(error) => native_error(error),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (ip, budget);
        Outcome::unavailable("Native ICMP is only available on Windows")
    }
}

#[cfg(windows)]
fn windows_arp(target: Ipv4Addr, source: Ipv4Addr) -> Outcome {
    use windows_sys::Win32::NetworkManagement::IpHelper::SendARP;
    // ULONG array, not an unaligned byte buffer. IPAddr uses network-order bytes.
    let mut mac = [0u32; 2];
    let mut length = 6u32;
    let status = unsafe {
        SendARP(
            u32::from_ne_bytes(target.octets()),
            u32::from_ne_bytes(source.octets()),
            mac.as_mut_ptr().cast(),
            &mut length,
        )
    };
    if status != 0 {
        let error = format!(
            "SendARP failed: {}",
            std::io::Error::from_raw_os_error(status as i32)
        );
        return if matches!(status, 31 | 67) {
            Outcome::unresponsive(error)
        } else {
            Outcome::unavailable(error)
        };
    }
    if length != 6 {
        return Outcome::unavailable("SendARP returned an invalid hardware address length");
    }
    let bytes: Vec<_> = mac.into_iter().flat_map(u32::to_ne_bytes).take(6).collect();
    if bytes.iter().all(|byte| *byte == 0) || bytes[0] & 1 != 0 {
        return Outcome::unavailable("SendARP returned an invalid unicast hardware address");
    }
    Outcome {
        mac: Some(bytes.iter().map(|byte| format!("{byte:02x}")).collect::<Vec<_>>().join(":")),
        // The legacy result has no evidence field. Preserve this qualification
        // in the per-attempt diagnostic even though resolution was successful.
        error: Some("ARP resolution evidence: SendARP may use the ARP cache; a fresh reply is not guaranteed".into()),
        ..Outcome::responsive()
    }
}

#[cfg(windows)]
fn windows_ping(target: Ipv4Addr, budget: Duration) -> Outcome {
    use windows_sys::Win32::Foundation::{GetLastError, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::NetworkManagement::IpHelper::{
        IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho, ICMP_ECHO_REPLY,
    };
    struct Handle(HANDLE);
    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe {
                IcmpCloseHandle(self.0);
            }
        }
    }
    let raw = unsafe { IcmpCreateFile() };
    if raw == INVALID_HANDLE_VALUE || raw.is_null() {
        return Outcome::unavailable(format!(
            "IcmpCreateFile failed: {}",
            std::io::Error::last_os_error()
        ));
    }
    let handle = Handle(raw);
    // A typed header guarantees alignment; the extra eight bytes cover an
    // ICMP error as documented by IcmpSendEcho. Request payload is empty.
    #[repr(C)]
    struct Reply {
        header: ICMP_ECHO_REPLY,
        extra: [u8; 8],
    }
    let mut reply = Reply {
        header: ICMP_ECHO_REPLY::default(),
        extra: [0; 8],
    };
    let count = unsafe {
        IcmpSendEcho(
            handle.0,
            u32::from_ne_bytes(target.octets()),
            std::ptr::null(),
            0,
            std::ptr::null(),
            (&mut reply as *mut Reply).cast(),
            std::mem::size_of::<Reply>() as u32,
            budget.as_millis().clamp(1, 30_000) as u32,
        )
    };
    if count == 0 {
        let status = unsafe { GetLastError() };
        return if (11002..=11018).contains(&status) {
            Outcome::unresponsive(format!("ICMP returned IP status {status}"))
        } else {
            Outcome::unavailable(format!(
                "IcmpSendEcho failed: {}",
                std::io::Error::from_raw_os_error(status as i32)
            ))
        };
    }
    native_echo_outcome(
        u32::from_ne_bytes(target.octets()),
        reply.header.Address,
        reply.header.Status,
    )
}

#[cfg(any(windows, test))]
fn native_echo_outcome(target: u32, address: u32, status: u32) -> Outcome {
    if status == 0 && address == target {
        Outcome::responsive()
    } else {
        Outcome::unresponsive(format!(
            "ICMP reply did not establish target reachability (IP status {status})"
        ))
    }
}

/// Read installed command support only; never probe a LAN to report capability.
/// Availability is installation/platform support, not a claim of raw privileges.
pub async fn get_discovery_probe_capabilities() -> DiscoveryProbeCapabilities {
    let ping4 = executable(ping_program(IpAddr::V4(Ipv4Addr::LOCALHOST))).is_some();
    let ping6 = executable(ping_program("::1".parse().expect("literal IPv6"))).is_some();
    let arp_available = if cfg!(windows) {
        true
    } else {
        arping_installation(Instant::now() + Duration::from_millis(500))
            .await
            .is_ok()
    };
    let methods = SINGLES.into_iter().map(|id| {
        let (available, description) = match id {
            "icmp" => (ping4 || ping6, "System ping, automatic IP family. Requires the matching ping executable and OS ping permissions."),
            "icmp4" => (ping4, "System ping, IPv4 only. Installation does not guarantee ping/raw-socket privileges."),
            "icmp6" => (ping6, "System ping, IPv6 only. Installation does not guarantee ping/raw-socket privileges."),
            "icmp-native" => (cfg!(windows), "Windows IPv4 IcmpSendEcho with reply-status validation. OS policy can deny it; native calls drain before returning."),
            "arp" if cfg!(windows) => (true, "Windows IPv4 direct-link SendARP resolution, possibly ARP-cache evidence. No gateway probes. OS calls drain before returning and can exceed the budget."),
            "arp" => (arp_available, "IPv4 direct-link installed iputils/Thomas Habets arping. Requires root/CAP_NET_RAW or permitted BPF access; installation is not a privilege check."),
            "tcp" => (true, "TCP connect or connection refusal proves host response, not an open port. Local OS policy may deny sockets."),
            "udp" => (true, "One empty connected UDP datagram. Only a reply or target port-refusal proves response; silence is inconclusive. Local OS policy may deny sockets."),
            _ => unreachable!(),
        };
        DiscoveryProbeCapability { id: id.into(), available, description: description.into() }
    }).collect();
    DiscoveryProbeCapabilities {
        platform: std::env::consts::OS.into(),
        methods,
    }
}

#[cfg(test)]
mod tests {
    use super::super::{RESPONSIVE, UNAVAILABLE, UNRESPONSIVE};
    use super::*;
    use getifaddrs::{Address, NetworkAddress};

    fn interface(ip: &str, mask: &str) -> Interface {
        Interface {
            name: "test-interface".into(),
            #[cfg(windows)]
            description: String::new(),
            address: Address::V4(NetworkAddress {
                address: ip.parse().unwrap(),
                netmask: Some(mask.parse().unwrap()),
                associated_address: None,
            }),
            flags: InterfaceFlags::UP | InterfaceFlags::RUNNING | InterfaceFlags::BROADCAST,
            index: Some(1),
        }
    }

    #[test]
    fn arp_requires_up_broadcast_direct_link_not_gateway_or_tunnel() {
        let local = interface("192.0.2.10", "255.255.255.0");
        let target = "192.0.2.20".parse().unwrap();
        let link = direct_link(local.clone(), target).unwrap();
        assert_eq!(link.source, "192.0.2.10".parse::<Ipv4Addr>().unwrap());
        assert_eq!(link.prefix, 24);
        for target in [
            "198.51.100.1",
            "192.0.2.0",
            "192.0.2.255",
            "127.0.0.1",
            "224.0.0.1",
            "255.255.255.255",
        ] {
            assert!(
                direct_link(local.clone(), target.parse().unwrap()).is_none(),
                "{target}"
            );
        }
        for flag in [InterfaceFlags::LOOPBACK, InterfaceFlags::POINTTOPOINT] {
            let mut candidate = local.clone();
            candidate.flags.insert(flag);
            assert!(direct_link(candidate, target).is_none());
        }
        for flag in [InterfaceFlags::UP, InterfaceFlags::BROADCAST] {
            let mut candidate = local.clone();
            candidate.flags.remove(flag);
            assert!(direct_link(candidate, target).is_none());
        }
        #[cfg(windows)]
        {
            let mut candidate = local;
            candidate.flags.remove(InterfaceFlags::RUNNING);
            assert!(direct_link(candidate, target).is_none());
        }
        for mask in ["255.0.255.0", "0.0.0.0", "255.255.255.255"] {
            assert!(direct_link(interface("192.0.2.10", mask), target).is_none());
        }
        assert!(direct_link(
            interface("192.0.2.10", "255.255.255.254"),
            "192.0.2.11".parse().unwrap()
        )
        .is_some());
    }

    #[test]
    fn arping_dialects_and_numeric_arguments_are_platform_correct() {
        assert_eq!(
            arping_dialect("ARPing 2.25, by Thomas Habets"),
            Some(ArpingDialect::Habets)
        );
        assert_eq!(
            arping_dialect("-I <device> -s <source>"),
            Some(ArpingDialect::Iputils)
        );
        assert_eq!(arping_dialect("unknown implementation"), None);
        let link = DirectLink {
            name: "native iface;not-a-shell".into(),
            source: "192.0.2.10".parse().unwrap(),
            prefix: 24,
        };
        for (dialect, expected) in [
            (
                ArpingDialect::Iputils,
                vec![
                    "-c",
                    "1",
                    "-I",
                    "native iface;not-a-shell",
                    "-s",
                    "192.0.2.10",
                    "192.0.2.20",
                ],
            ),
            (
                ArpingDialect::Habets,
                vec![
                    "-c",
                    "1",
                    "-i",
                    "native iface;not-a-shell",
                    "-S",
                    "192.0.2.10",
                    "192.0.2.20",
                ],
            ),
        ] {
            let cmd = arping_command(
                Path::new("arping"),
                dialect,
                &link,
                "192.0.2.20".parse().unwrap(),
            );
            let args: Vec<_> = cmd
                .as_std()
                .get_args()
                .map(|arg| arg.to_str().unwrap())
                .collect();
            assert_eq!(args, expected);
        }
        assert_eq!(
            reply_mac("Unicast reply from 192.0.2.20 [02:AB:CD:01:02:03]"),
            Some("02:ab:cd:01:02:03".into())
        );
        assert_eq!(reply_mac("Received 0 replies"), None);
        assert_eq!(reply_mac("ff:ff:ff:ff:ff:ff 00:00:00:00:00:00"), None);
    }

    #[test]
    fn ping_arguments_are_numeric_single_packet_and_canonical() {
        for host in ["127.0.0.1", "2001:0db8::1"] {
            let ip: IpAddr = host.parse().unwrap();
            let cmd = ping_command(Path::new(ping_program(ip)), ip, Duration::from_millis(1234));
            let args: Vec<_> = cmd
                .as_std()
                .get_args()
                .map(|arg| arg.to_str().unwrap())
                .collect();
            assert_eq!(args.last().unwrap(), &ip.to_string());
            #[cfg(windows)]
            assert_eq!(&args[..4], &["-n", "1", "-w", "1234"]);
            #[cfg(not(windows))]
            assert_eq!(&args[..3], &["-n", "-c", "1"]);
        }
    }

    #[test]
    fn windows_ping_requires_positive_echo_not_zero_exit_or_received_count() {
        let v4 = "192.0.2.1".parse().unwrap();
        let v6 = "2001:db8::1".parse().unwrap();
        assert!(windows_echo_evidence(
            "Reply from 192.0.2.1: bytes=32 time<1ms TTL=64",
            v4
        ));
        assert!(windows_echo_evidence(
            "Reply from 2001:db8::1: time=2ms",
            v6
        ));
        assert!(windows_echo_evidence(
            "Reply from 2001:db8::1: time<1ms",
            v6
        ));
        for output in [
            "Resposta de 2001:db8::1: tempo<1ms",
            "Réponse de 2001:db8::1: temps=1,5ms",
            "Antwort von 2001:db8::1: Zeit=2.5ms",
        ] {
            assert_eq!(windows_echo_outcome(output, v6).status, RESPONSIVE);
        }
        assert_eq!(
            windows_echo_outcome("Réponse de 2001:db8::1: format inconnu", v6).status,
            UNAVAILABLE
        );
        assert_eq!(
            windows_echo_outcome("Reply from 2001:db8::1: Destination host unreachable.", v6)
                .status,
            UNRESPONSIVE
        );
        for output in [
            "Reply from 192.0.2.1: Destination host unreachable.",
            "Reply from 2001:db8::1: Destination host unreachable.",
            "Reply from 2001:db8::2: time=1ms",
            "Packets: Sent = 1, Received = 1, Lost = 0",
            "PING: transmit failed. General failure.",
        ] {
            assert!(!windows_echo_evidence(output, v4), "{output}");
            assert!(!windows_echo_evidence(output, v6), "{output}");
        }
    }

    #[test]
    fn native_icmp_checks_both_status_and_target_address() {
        assert_eq!(native_echo_outcome(1, 1, 0).status, RESPONSIVE);
        assert_eq!(native_echo_outcome(1, 1, 11003).status, UNRESPONSIVE);
        assert_eq!(native_echo_outcome(1, 2, 0).status, UNRESPONSIVE);
    }

    #[tokio::test]
    async fn native_timeout_drains_worker_and_holds_single_permit() {
        let permits = Arc::new(Semaphore::new(1));
        let worker_permits = permits.clone();
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let task = tokio::spawn(async move {
            blocking_with_permits(
                worker_permits,
                Instant::now() + Duration::from_millis(100),
                move || {
                    started_tx.send(()).unwrap();
                    release_rx.recv_timeout(Duration::from_secs(3)).unwrap();
                    42
                },
            )
            .await
        });
        started_rx.await.unwrap();
        tokio::time::sleep(Duration::from_millis(130)).await;
        assert!(!task.is_finished(), "timeout must wait for OS completion");
        assert_eq!(
            permits.available_permits(),
            0,
            "permit is owned inside the worker"
        );
        let busy = blocking_with_permits(
            permits.clone(),
            Instant::now() + Duration::from_millis(10),
            || panic!("must not dispatch"),
        )
        .await;
        assert!(busy.unwrap_err().contains("capacity deadline"));
        release_tx.send(()).unwrap();
        assert!(task.await.unwrap().unwrap_err().contains("drained"));
        assert_eq!(permits.available_permits(), 1);
    }

    #[tokio::test]
    async fn native_capacity_waits_and_cancellation_keeps_running_worker_bounded() {
        let permits = Arc::new(Semaphore::new(1));
        let held = permits.clone().acquire_owned().await.unwrap();
        let waiting_permits = permits.clone();
        let waiting = tokio::spawn(async move {
            blocking_with_permits(
                waiting_permits,
                Instant::now() + Duration::from_secs(2),
                || 7,
            )
            .await
        });
        tokio::task::yield_now().await;
        assert!(!waiting.is_finished());
        drop(held);
        assert_eq!(waiting.await.unwrap().unwrap(), 7);

        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let worker_permits = permits.clone();
        let task = tokio::spawn(async move {
            blocking_with_permits(
                worker_permits,
                Instant::now() + Duration::from_secs(2),
                move || {
                    let _ = started_tx.send(());
                    release_rx.recv_timeout(Duration::from_secs(3)).unwrap();
                },
            )
            .await
        });
        started_rx.await.unwrap();
        task.abort();
        let _ = task.await;
        assert_eq!(permits.available_permits(), 0);
        release_tx.send(()).unwrap();
        let available = timeout_at(Instant::now() + Duration::from_secs(1), permits.acquire())
            .await
            .unwrap()
            .unwrap();
        drop(available);
        assert_eq!(permits.available_permits(), 1);
    }

    #[tokio::test]
    async fn capabilities_have_seven_singles_without_network_probes() {
        let result = get_discovery_probe_capabilities().await;
        assert_eq!(result.platform, std::env::consts::OS);
        assert_eq!(
            result
                .methods
                .iter()
                .map(|m| m.id.as_str())
                .collect::<Vec<_>>(),
            SINGLES
        );
        assert!(result.methods.iter().all(|m| !m.description.is_empty()));
        assert_eq!(
            result
                .methods
                .iter()
                .find(|m| m.id == "icmp-native")
                .unwrap()
                .available,
            cfg!(windows)
        );
        let value = serde_json::to_value(result).unwrap();
        assert_eq!(value.as_object().unwrap().len(), 2);
        assert!(value["methods"][0]["available"].is_boolean());
        // Error results from a capacity wait must never be host-down evidence.
        #[cfg(windows)]
        assert_eq!(
            native_error("Native probe capacity deadline expired; no probe sent".into()).status,
            UNAVAILABLE
        );
        #[cfg(not(windows))]
        assert_eq!(
            native_ping("127.0.0.1".parse().unwrap(), Duration::from_millis(1))
                .await
                .status,
            UNAVAILABLE
        );
    }
}
