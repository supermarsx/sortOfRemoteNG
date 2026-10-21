//! A saved SSH local forward is a byte-stream route behind the owned browser
//! relay. Its private listener is never a Chromium proxy or a website origin.
use super::*;
use crate::ssh::service::{connect_ssh_on_state, disconnect_ssh_on_state};
use crate::ssh::{PortForwardConfig, PortForwardDirection, SshServiceState};
use tauri::Manager;

const UNSUPPORTED: NativeAuthorityError = NativeAuthorityError::RouteUnsupported;

fn unavailable(stage: &'static str) -> NativeAuthorityError {
    NativeAuthorityError::SshRouteUnavailable { stage }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ConnectFailure {
    Dns,
    Transport,
    Refused,
    NetworkUnreachable,
    HostUnreachable,
    Denied,
    AddressUnavailable,
    TransportTimeout,
    Handshake,
    HostKey,
    Authentication,
    Timeout,
    Capacity,
    Cancelled,
    Unknown,
}

impl ConnectFailure {
    fn classify(error: &str) -> Self {
        if error == "SSH connection cancelled" {
            Self::Cancelled
        } else if error.starts_with("SSH_CONNECTION_TIMEOUT:") {
            Self::Timeout
        } else if ["SSH_SESSION_CAPACITY:", "SSH_HANDSHAKE_CAPACITY:", "SSH_CONFIG_CAPACITY:"]
            .iter().any(|prefix| error.starts_with(prefix)) {
            Self::Capacity
        } else if matches!(error, "Failed to resolve SSH establishment endpoint" | "SSH establishment resolver returned no addresses") {
            Self::Dns
        } else if let Some(detail) = error.strip_prefix("Failed to connect to SSH establishment endpoint:") {
            // Only first-party fixed markers survive into renderer diagnostics.
            // Never infer a category from localized OS text or a remote banner.
            match detail.strip_prefix(" [").and_then(|s| s.split_once("] ")).map(|(code, _)| code) {
                Some("connection-refused") => Self::Refused,
                Some("network-unreachable") => Self::NetworkUnreachable,
                Some("host-unreachable") => Self::HostUnreachable,
                Some("permission-denied") => Self::Denied,
                Some("address-unavailable") => Self::AddressUnavailable,
                Some("timed-out") => Self::TransportTimeout,
                _ => Self::Transport,
            }
        } else if error.starts_with("SSH handshake failed:") {
            Self::Handshake
        } else if error == "All authentication methods failed" {
            Self::Authentication
        } else if error == "No event emitter configured for host-key verification"
            || error == "Host key verification failed: unable to determine the home directory for known_hosts"
            || ["SSH_TRUST_UNAVAILABLE[", "Host key verification failed for ", "Host key verification timed out for ", "Failed to create known_hosts handle:", "Failed to lock host-key prompt map:", "Failed to serialize host-key prompt payload:", "Failed to enumerate known_hosts entries:", "Failed to replace existing known_hosts entry:", "Failed to add host key to known_hosts:", "Failed to create known_hosts directory:", "Failed to write known_hosts file:"]
                .iter().any(|prefix| error.starts_with(prefix)) {
            Self::HostKey
        } else {
            Self::Unknown
        }
    }

    fn stage(self) -> &'static str {
        match self {
            Self::Dns => "connect-dns",
            Self::Transport => "connect-transport",
            Self::Refused => "connect-refused",
            Self::NetworkUnreachable => "connect-network-unreachable",
            Self::HostUnreachable => "connect-host-unreachable",
            Self::Denied => "connect-denied",
            Self::AddressUnavailable => "connect-address-unavailable",
            Self::TransportTimeout => "connect-transport-timeout",
            Self::Handshake => "connect-handshake",
            Self::HostKey => "connect-host-key",
            Self::Authentication => "connect-authentication",
            Self::Timeout => "connect-timeout",
            Self::Capacity => "connect-capacity",
            Self::Cancelled => "connect-cancelled",
            Self::Unknown => "connect-unknown",
        }
    }
}

fn connect_error(error: &str) -> NativeAuthorityError {
    let stage = ConnectFailure::classify(error).stage();
    log::warn!(target: "native_browser::session", "Native browser SSH route failed: reason={stage}; review the saved SSH connection, authentication and host-key confirmation; no direct fallback");
    unavailable(stage)
}

struct LocalSpec {
    ssh: Value,
    remote: Authority,
}

fn present(value: Option<&Value>) -> bool {
    value.is_some_and(|v| !v.is_null() && v != "")
}

fn authority(host: &str, port: u16) -> Result<Authority, NativeAuthorityError> {
    let host = if let Some(host) = host.strip_prefix('[') {
        let host = host.strip_suffix(']').ok_or(UNSUPPORTED)?;
        host.parse::<std::net::Ipv6Addr>()
            .map_err(|_| UNSUPPORTED)?;
        host
    } else {
        host
    };
    let formatted = if host.contains(':') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    };
    Authority::parse(&formatted).map_err(|_| UNSUPPORTED)
}

fn selected(
    connection: &Value,
    target: &Authority,
) -> Result<Option<LocalSpec>, NativeAuthorityError> {
    let legacy = connection.pointer("/security/sshTunnel");
    let legacy_enabled = legacy.is_some_and(|v| v.get("enabled") == Some(&Value::Bool(true)));
    let layers = connection
        .pointer("/security/tunnelChain")
        .and_then(Value::as_array);
    let active: Vec<_> = layers
        .into_iter()
        .flatten()
        .filter(|layer| layer.get("enabled") != Some(&Value::Bool(false)))
        .collect();
    let has_ssh = active.iter().any(|layer| {
        matches!(
            layer.get("type").and_then(Value::as_str),
            Some("ssh-tunnel" | "local-forward" | "ssh-jump")
        )
    });
    if !legacy_enabled && !has_ssh {
        return Ok(None);
    }
    // Do not silently discard an upstream route or change its order. Profile
    // expansion currently supports proxy byte streams only.
    if [
        "proxyProfileId",
        "proxyChainId",
        "tunnelProfileId",
        "tunnelChainId",
        "connectionChainId",
    ]
    .iter()
    .any(|key| present(connection.get(key)))
        || connection
            .pointer("/security/proxy")
            .is_some_and(|v| v.get("enabled") != Some(&Value::Bool(false)))
        || connection
            .pointer("/security/openvpn")
            .is_some_and(|v| v.get("enabled") != Some(&Value::Bool(false)))
        || legacy.is_some_and(|v| !legacy_enabled && v.get("enabled") != Some(&Value::Bool(false)))
    {
        return Err(UNSUPPORTED);
    }
    let ssh = if legacy_enabled {
        if !active.is_empty()
            || connection
                .pointer("/security/tunnelChain")
                .is_some_and(|v| !v.is_array())
        {
            return Err(UNSUPPORTED);
        }
        let mut ssh = legacy.unwrap().clone();
        ssh.as_object_mut()
            .ok_or(UNSUPPORTED)?
            .insert("forwardType".into(), "local".into());
        ssh
    } else {
        if active.len() != 1 || active[0].get("enabled") != Some(&Value::Bool(true)) {
            return Err(UNSUPPORTED);
        }
        let layer = active[0];
        if ["tunnelProfileId", "nodeChainConfig"]
            .iter()
            .any(|key| layer.get(key).is_some())
        {
            return Err(UNSUPPORTED);
        }
        // The connection editor labels a single direct-tcpip hop ssh-jump.
        // ProxyJump and local-forward are equivalent for this one-hop case;
        // other mechanisms need a separate adapter and must not be ignored.
        if layer
            .get("sshChainingMethod")
            .is_some_and(|method| !matches!(method.as_str(), Some("proxyjump" | "local-forward")))
        {
            return Err(UNSUPPORTED);
        }
        if let Some(bind) = layer.get("localBindHost") {
            let bind = bind.as_str().ok_or(UNSUPPORTED)?;
            if !bind.is_empty()
                && !bind.eq_ignore_ascii_case("localhost")
                && !bind
                    .parse::<std::net::IpAddr>()
                    .is_ok_and(|ip| ip.is_loopback())
            {
                return Err(UNSUPPORTED);
            }
        }
        if layer
            .get("localBindPort")
            .is_some_and(|v| !v.as_u64().is_some_and(|p| p <= u16::MAX as u64))
        {
            return Err(UNSUPPORTED);
        }
        layer.get("sshTunnel").ok_or(UNSUPPORTED)?.clone()
    };
    if ssh.get("forwardType").and_then(Value::as_str) != Some("local") {
        return Err(UNSUPPORTED);
    }
    let host = match ssh.get("remoteHost") {
        None => target.host(),
        Some(value) => value
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or(UNSUPPORTED)?,
    };
    let port = match ssh.get("remotePort") {
        None => target.port(),
        Some(value) => value
            .as_u64()
            .and_then(|p| u16::try_from(p).ok())
            .filter(|p| *p != 0)
            .ok_or(UNSUPPORTED)?,
    };
    let remote = authority(host, port)?;
    // The mapper handles authentication, not the byte-stream destination.
    // Keep the complete spec for strict rejection of unsupported route fields.
    Ok(Some(LocalSpec { ssh, remote }))
}

struct Actor {
    service: SshServiceState,
    id: String,
    _cleanup: tokio::sync::oneshot::Sender<()>,
}

impl Actor {
    fn new(service: SshServiceState, id: String, lease: NativeOwnerLease) -> Self {
        let (cleanup, released) = tokio::sync::oneshot::channel();
        let cleanup_service = service.clone();
        let cleanup_id = id.clone();
        // Arm cleanup on the command runtime now. Last-owner drop may happen
        // on a CEF callback thread with no Tokio runtime entered.
        tokio::spawn(async move {
            wait_for_actor_release(released, || lease.is_current()).await;
            let _ = disconnect_ssh_on_state(&cleanup_service, &cleanup_id).await;
        });
        Self {
            service,
            id,
            _cleanup: cleanup,
        }
    }
}

async fn wait_for_actor_release(
    mut released: tokio::sync::oneshot::Receiver<()>,
    current: impl Fn() -> bool,
) {
    let mut check = tokio::time::interval(Duration::from_millis(250));
    loop {
        tokio::select! {
            _ = &mut released => return,
            _ = check.tick() => {
                if !current() { return; }
            }
        }
    }
}

async fn connect_while_current<T>(
    work: impl std::future::Future<Output = Result<T, NativeAuthorityError>>,
    current: impl Fn() -> bool,
) -> Result<T, NativeAuthorityError> {
    if !current() {
        return Err(unavailable("owner"));
    }
    let mut check = tokio::time::interval(Duration::from_millis(250));
    tokio::pin!(work);
    loop {
        tokio::select! {
            biased;
            _ = check.tick() => {
                if !current() { return Err(unavailable("owner")); }
            }
            result = &mut work => {
                // A successful result already owns its cleanup guard. If owner
                // revocation raced completion, dropping it closes that actor.
                return if current() { result } else { Err(unavailable("owner")) };
            }
        }
    }
}

pub(super) struct SshRoute {
    actor: Actor,
    forward: String,
    target: Authority,
    remote: Authority,
    endpoint: std::net::SocketAddr,
    lease: NativeOwnerLease,
}

impl SshRoute {
    pub(super) fn health(
        &self,
        session_id: &str,
    ) -> Option<sorng_core::route_health::RouteHealthSnapshot> {
        if !self.lease.is_current() {
            return None;
        }
        let service = self.actor.service.try_lock().ok()?;
        let mut snapshot = service.route_health(&self.actor.id).ok()?;
        snapshot.session_id = session_id.to_owned();
        Some(snapshot)
    }
    async fn checked_endpoint(&self, target: &Authority) -> io::Result<std::net::SocketAddr> {
        if target != &self.target || !self.lease.is_current() {
            return Err(route_error());
        }
        let info = self
            .actor
            .service
            .lock()
            .await
            .get_port_forward_info(&self.actor.id, &self.forward)
            .map_err(|_| route_error())?;
        let config = info.config;
        if !matches!(config.direction, PortForwardDirection::Local)
            || config.local_host != self.endpoint.ip().to_string()
            || config.local_port != self.endpoint.port()
            || authority(&config.remote_host, config.remote_port)
                .ok()
                .as_ref()
                != Some(&self.remote)
            || !self.lease.is_current()
        {
            return Err(route_error());
        }
        Ok(self.endpoint)
    }

    pub(super) async fn dial(&self, target: &Authority) -> io::Result<BoxedStream> {
        dial_verified(|| self.checked_endpoint(target)).await
    }
}

async fn dial_verified<F, Fut>(mut verify: F) -> io::Result<BoxedStream>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = io::Result<std::net::SocketAddr>>,
{
    let endpoint = verify().await?;
    let stream = tokio::net::TcpStream::connect(endpoint)
        .await
        .map_err(|_| route_error())?;
    if verify().await? != endpoint {
        return Err(route_error());
    }
    Ok(Box::new(stream))
}

pub(super) async fn prepare<R: Runtime>(
    window: &WebviewWindow<R>,
    state: &EncryptionState,
    connection: &Value,
    lease: &NativeOwnerLease,
    source: &Url,
    browser_session_id: &str,
) -> Result<Option<Arc<SshRoute>>, NativeAuthorityError> {
    let target = authority(
        source.host_str().ok_or(UNSUPPORTED)?,
        source.port_or_known_default().ok_or(UNSUPPORTED)?,
    )?;
    let Some(spec) = selected(connection, &target)? else {
        return Ok(None);
    };
    let service = window
        .try_state::<SshServiceState>()
        .ok_or_else(|| unavailable("service"))?
        .inner()
        .clone();
    let mut config =
        super::ssh_config::resolve(window, state, lease, connection, &spec.ssh).await?;
    config.host_key_prompt_id = Some(format!("native-browser:{browser_session_id}"));
    lease
        .recheck(window, state)
        .await
        .map_err(|_| unavailable("owner"))?;
    let actor = connect_while_current(
        async {
            let id = connect_ssh_on_state(&service, config)
                .await
                .map_err(|error| connect_error(&error))?;
            // Arm cleanup synchronously before returning success to the lease
            // race. No actor ID may be discarded without its cleanup guard.
            Ok(Actor::new(service, id, lease.clone()))
        },
        || lease.is_current(),
    )
    .await?;
    lease
        .recheck(window, state)
        .await
        .map_err(|_| unavailable("owner"))?;
    let config = PortForwardConfig {
        local_host: "127.0.0.1".into(),
        local_port: 0,
        remote_host: spec.remote.host().into(),
        remote_port: spec.remote.port(),
        direction: PortForwardDirection::Local,
        allow_non_loopback_bind: false,
    };
    let forward = actor
        .service
        .lock()
        .await
        .setup_port_forward(&actor.id, config)
        .await
        .map_err(|_| unavailable("forward"))?;
    let info = actor
        .service
        .lock()
        .await
        .get_port_forward_info(&actor.id, &forward)
        .map_err(|_| unavailable("forward"))?;
    let endpoint =
        std::net::SocketAddr::new(std::net::Ipv4Addr::LOCALHOST.into(), info.config.local_port);
    let route = Arc::new(SshRoute {
        actor,
        forward,
        target,
        remote: spec.remote,
        endpoint,
        lease: lease.clone(),
    });
    route
        .checked_endpoint(&route.target)
        .await
        .map_err(|_| unavailable("forward"))?;
    lease
        .recheck(window, state)
        .await
        .map_err(|_| unavailable("owner"))?;
    Ok(Some(route))
}

#[cfg(test)]
#[path = "origin_browser_ssh_route_tests.rs"]
mod tests;
