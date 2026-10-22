//! Fixed-field SSH establishment observations. No endpoint text or credentials.
use futures::{stream::FuturesUnordered, StreamExt};
use rand::RngCore;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    future::Future,
    io,
    net::SocketAddr,
    sync::{
        atomic::{AtomicU64, AtomicU8, Ordering},
        OnceLock,
    },
    time::{Duration, Instant},
};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SshEstablishmentOrigin {
    #[default]
    Other,
    Terminal,
    NativeBrowser,
}
impl SshEstablishmentOrigin {
    fn label(self) -> &'static str {
        match self {
            Self::Other => "other",
            Self::Terminal => "terminal",
            Self::NativeBrowser => "native-browser",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) enum IpPolicy {
    #[default]
    Auto,
    V4,
    V6,
}
impl IpPolicy {
    pub(super) fn parse(value: &str) -> Result<Self, String> {
        match value {
            "auto" => Ok(Self::Auto),
            "ipv4" => Ok(Self::V4),
            "ipv6" => Ok(Self::V6),
            _ => Err("Invalid SSH IP protocol policy".into()),
        }
    }
    fn label(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::V4 => "ipv4",
            Self::V6 => "ipv6",
        }
    }
    pub(super) fn select(self, addresses: Vec<SocketAddr>) -> Vec<SocketAddr> {
        let mut seen = HashSet::new();
        let selected: Vec<_> = addresses
            .into_iter()
            .filter(|a| match self {
                Self::Auto => true,
                Self::V4 => a.is_ipv4(),
                Self::V6 => a.is_ipv6(),
            })
            .filter(|a| seen.insert(*a))
            .take(64)
            .collect();
        if self != Self::Auto || selected.is_empty() {
            return selected;
        }
        // Preserve OS preference within each family, but let the alternate
        // family participate before a second silent address can occupy both slots.
        let first_v4 = selected[0].is_ipv4();
        let (first, second): (Vec<_>, Vec<_>) =
            selected.into_iter().partition(|a| a.is_ipv4() == first_v4);
        let mut first = first.into_iter();
        let mut second = second.into_iter();
        let mut ordered = Vec::new();
        loop {
            match (first.next(), second.next()) {
                (None, None) => break,
                (a, b) => {
                    ordered.extend(a);
                    ordered.extend(b);
                }
            }
        }
        ordered
    }
}
static NEXT: AtomicU64 = AtomicU64::new(1);
static SALT: OnceLock<Option<[u8; 32]>> = OnceLock::new();
fn salt() -> Option<&'static [u8; 32]> {
    SALT.get_or_init(|| {
        let mut bytes = [0; 32];
        rand::rngs::OsRng
            .try_fill_bytes(&mut bytes)
            .ok()
            .map(|_| bytes)
    })
    .as_ref()
}
fn fingerprint_with(salt: &[u8; 32], host: &str, port: u16) -> String {
    let mut h = Sha256::new();
    h.update(b"ssh-establishment-endpoint-v1");
    h.update(salt);
    let host = host.to_ascii_lowercase();
    h.update((host.len() as u64).to_be_bytes());
    h.update(host.as_bytes());
    h.update(port.to_be_bytes());
    hex::encode(&h.finalize()[..16])
}
fn fingerprint(host: &str, port: u16) -> String {
    salt()
        .map(|s| fingerprint_with(s, host, port))
        .unwrap_or_else(|| "unavailable".into())
}
fn family(address: SocketAddr) -> &'static str {
    if address.is_ipv4() {
        "ipv4"
    } else {
        "ipv6"
    }
}
fn millis(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

pub(super) struct Attempt {
    id: u64,
    origin: AtomicU8,
    route: AtomicU8,
    target: String,
    policy: IpPolicy,
    budget: u64,
    started: Instant,
}
impl Default for Attempt {
    fn default() -> Self {
        Self::new("", 0, IpPolicy::Auto, Duration::ZERO)
    }
}
impl Attempt {
    pub(super) fn new(host: &str, port: u16, policy: IpPolicy, budget: Duration) -> Self {
        Self {
            id: NEXT.fetch_add(1, Ordering::Relaxed),
            origin: AtomicU8::new(0),
            route: AtomicU8::new(0),
            target: fingerprint(host, port),
            policy,
            budget: millis(budget),
            started: Instant::now(),
        }
    }
    pub(super) fn completed(&self, success: bool) {
        self.record(
            "establishment",
            if success { "established" } else { "failed" },
            "none",
            (None, None),
            self.started.elapsed(),
            (0, 0),
        );
    }
    pub(super) fn policy(&self) -> IpPolicy {
        self.policy
    }
    pub(super) fn set_route(&self, config: &super::SshConnectionConfig) {
        // Match actual service branch precedence, including its legacy empty
        // ProxyCommand object branch; diagnostics must not invent a proxy hop.
        let route = if let Some(command) = &config.proxy_command {
            if command.command.is_some() || command.template.is_some() {
                1
            } else if config.mixed_chain.is_some() {
                2
            } else {
                0
            }
        } else if config.mixed_chain.is_some() {
            2
        } else if config.proxy_chain.is_some() {
            3
        } else if config.proxy_config.is_some() {
            4
        } else if !config.jump_hosts.is_empty() {
            5
        } else {
            0
        };
        self.route.store(route, Ordering::Relaxed);
    }
    fn route(&self) -> &'static str {
        match self.route.load(Ordering::Relaxed) {
            1 => "proxy-command",
            2 => "mixed",
            3 => "proxy-chain",
            4 => "proxy",
            5 => "ssh-jump",
            _ => "direct",
        }
    }
    pub(super) fn set_origin(&self, origin: SshEstablishmentOrigin) {
        self.origin.store(origin as u8, Ordering::Relaxed);
    }
    fn caller(&self) -> &'static str {
        match self.origin.load(Ordering::Relaxed) {
            1 => SshEstablishmentOrigin::Terminal.label(),
            2 => SshEstablishmentOrigin::NativeBrowser.label(),
            _ => SshEstablishmentOrigin::Other.label(),
        }
    }
    fn record(
        &self,
        phase: &'static str,
        outcome: &'static str,
        endpoint: &str,
        candidate: (Option<usize>, Option<SocketAddr>),
        elapsed: Duration,
        counts: (usize, usize),
    ) {
        let (candidate, address) = candidate;
        let (count, v4) = counts;
        let address_key = address
            .map(|a| fingerprint(&a.ip().to_string(), a.port()))
            .unwrap_or_else(|| "none".into());
        let kind = address.map(family).unwrap_or("none");
        log::info!(
            target: "ssh::establishment",
            "SSH establishment observed: timestampUnixMs={} attempt={} caller={} route={} target={} endpoint={} policy={} phase={} outcome={} candidate={} address={} family={} candidates={} ipv4={} ipv6={} elapsedMs={} overallMs={} budgetMs={}",
            chrono::Utc::now().timestamp_millis(), self.id, self.caller(), self.route(),
            self.target, endpoint, self.policy.label(), phase, outcome,
            candidate.map_or(-1, |index| index as i64), address_key, kind, count, v4,
            count.saturating_sub(v4), millis(elapsed), millis(self.started.elapsed()), self.budget,
        );
    }
    pub(super) fn resolve(&self, host: &str, port: u16) -> Phase<'_> {
        Phase {
            attempt: self,
            phase: "resolve",
            endpoint: fingerprint(host, port),
            started: Instant::now(),
            finished: false,
        }
    }
    pub(super) fn connecting(&self) -> Phase<'_> {
        Phase {
            attempt: self,
            phase: "connect",
            endpoint: "resolved-candidates".into(),
            started: Instant::now(),
            finished: false,
        }
    }
}
pub(super) struct Phase<'a> {
    attempt: &'a Attempt,
    phase: &'static str,
    endpoint: String,
    started: Instant,
    finished: bool,
}
impl Phase<'_> {
    pub(super) fn finish(&mut self, outcome: &'static str, addresses: &[SocketAddr]) {
        let v4 = addresses.iter().filter(|a| a.is_ipv4()).count();
        self.attempt.record(
            self.phase,
            outcome,
            &self.endpoint,
            (None, None),
            self.started.elapsed(),
            (addresses.len(), v4),
        );
        for (i, address) in addresses.iter().take(8).enumerate() {
            self.attempt.record(
                "candidate",
                "resolved",
                &self.endpoint,
                (Some(i), Some(*address)),
                self.started.elapsed(),
                (addresses.len(), v4),
            );
        }
        self.finished = true;
    }
    fn candidate(
        &self,
        index: usize,
        address: SocketAddr,
        outcome: &'static str,
        elapsed: Duration,
    ) {
        self.attempt.record(
            "tcp-candidate",
            outcome,
            &self.endpoint,
            (Some(index), Some(address)),
            elapsed,
            (0, 0),
        );
    }
}
impl Drop for Phase<'_> {
    fn drop(&mut self) {
        if !self.finished {
            self.attempt.record(
                self.phase,
                "interrupted",
                &self.endpoint,
                (None, None),
                self.started.elapsed(),
                (0, 0),
            );
        }
    }
}
fn outcome(error: &io::Error) -> &'static str {
    match error.kind() {
        io::ErrorKind::ConnectionRefused => "refused",
        io::ErrorKind::TimedOut => "timed-out",
        io::ErrorKind::PermissionDenied => "denied",
        io::ErrorKind::AddrNotAvailable => "address-unavailable",
        _ => "transport-error",
    }
}

/// Only addresses already resolved for the exact configured endpoint participate.
/// Futures own sockets directly; losing candidates are dropped, never detached.
pub(super) async fn connect_candidates<T, F, Fut>(
    addresses: Vec<SocketAddr>,
    mut dial: F,
    phase: &mut Phase<'_>,
    stagger: Duration,
) -> io::Result<T>
where
    F: FnMut(SocketAddr) -> Fut,
    Fut: Future<Output = io::Result<T>>,
{
    let mut pending = FuturesUnordered::new();
    let mut next = addresses.into_iter().enumerate();
    let mut exhausted = false;
    let wrap = |i, address, future: Fut| async move {
        let began = Instant::now();
        (i, address, future.await, began.elapsed())
    };
    if let Some((i, a)) = next.next() {
        pending.push(wrap(i, a, dial(a)));
    } else {
        return Err(io::Error::new(
            io::ErrorKind::AddrNotAvailable,
            "No compatible SSH establishment addresses",
        ));
    }
    let mut launch = tokio::time::Instant::now() + stagger;
    loop {
        tokio::select! {
            biased;
            result = pending.next(), if !pending.is_empty() => {
                let (index, address, result, elapsed) = result.expect("nonempty candidate set");
                match result {
                    Ok(stream) => {
                        phase.candidate(index, address, "connected", elapsed);
                        phase.finish("connected", &[]);
                        return Ok(stream);
                    }
                    Err(error) => {
                        phase.candidate(index, address, outcome(&error), elapsed);
                        if pending.is_empty() {
                            if let Some((index, address)) = next.next() {
                                pending.push(wrap(index, address, dial(address)));
                                launch = tokio::time::Instant::now() + stagger;
                            } else {
                                phase.finish("failed", &[]);
                                return Err(error);
                            }
                        }
                    }
                }
            },
            _ = tokio::time::sleep_until(launch), if !exhausted && pending.len() < 2 => {
                if let Some((index, address)) = next.next() {
                    pending.push(wrap(index, address, dial(address)));
                    launch = tokio::time::Instant::now() + stagger;
                } else {
                    exhausted = true;
                }
            }
        }
    }
}

#[cfg(test)]
#[path = "establishment_transport_tests.rs"]
mod tests;
