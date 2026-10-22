//! Authenticated RFC9298 Upgrade on the existing private HTTP proxy endpoint.
use super::*;
use crate::private_datagram_proxy::{
    capsule::{encode_datagram, CapsuleDecoder},
    PrivateDatagramFlow,
};

const PREFIX: &str = "/.well-known/masque/udp/";
const PAYLOAD: usize = 1232;

fn target(path: &str) -> Result<Authority, u16> {
    let path = path
        .strip_prefix(PREFIX)
        .and_then(|p| p.strip_suffix('/'))
        .ok_or(400u16)?;
    let (host, port) = path.split_once('/').ok_or(400u16)?;
    // RFC6570 simple path expansion: IPv6 has no brackets and each colon is
    // uppercase %3A. Re-encoding forbids alternate spellings, zones or escapes.
    let decoded = host.replace("%3A", ":");
    let authority = Authority::parse(&if decoded.contains(':') {
        format!("[{decoded}]:{port}")
    } else {
        format!("{decoded}:{port}")
    })
    .map_err(|_| 400u16)?;
    if host != authority.host().replace(':', "%3A") || port != authority.port().to_string() {
        return Err(400);
    }
    Ok(authority)
}

pub(super) fn validate(
    header: &[u8],
    credential_hash: &[u8; 32],
    endpoint: SocketAddr,
) -> Result<Authority, u16> {
    let text = std::str::from_utf8(header).map_err(|_| 400u16)?;
    let mut lines = text.strip_suffix("\r\n\r\n").ok_or(400u16)?.split("\r\n");
    let mut request = lines.next().ok_or(400u16)?.split(' ');
    if request.next() != Some("GET") {
        return Err(400);
    }
    let path = request.next().ok_or(400u16)?;
    if request.next() != Some("HTTP/1.1") || request.next().is_some() {
        return Err(400);
    }
    let mut names = Vec::new();
    let (mut host, mut authorization, mut connection, mut upgrade, mut capsule) =
        (None, None, None, None, None);
    for line in lines {
        let (name, value) = line.split_once(':').ok_or(400u16)?;
        if name.is_empty()
            || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
            || !value.bytes().all(|b| (32..=126).contains(&b))
            || names.len() >= 16
        {
            return Err(400);
        }
        let name = name.to_ascii_lowercase();
        if names.contains(&name) {
            return Err(400);
        }
        let value = value.trim_matches(' ');
        match name.as_str() {
            "host" => host = Some(value),
            "proxy-authorization" => authorization = Some(value),
            "connection" => connection = Some(value),
            "upgrade" => upgrade = Some(value),
            "capsule-protocol" => capsule = Some(value),
            // No origin auth/cookies, HTTP body/framing or unrelated headers
            // can be smuggled into this native-only tunnel protocol.
            _ => return Err(400),
        }
        names.push(name);
    }
    authenticate(authorization, credential_hash)?;
    if host != Some(endpoint.to_string().as_str())
        || !connection.is_some_and(|v| v.eq_ignore_ascii_case("upgrade"))
        || !upgrade.is_some_and(|v| v.eq_ignore_ascii_case("connect-udp"))
        || capsule != Some("?1")
    {
        return Err(400);
    }
    target(path)
}

async fn forward_capsules(
    decoder: &mut CapsuleDecoder,
    mut bytes: &[u8],
    flow: &PrivateDatagramFlow,
) -> io::Result<()> {
    while !bytes.is_empty() {
        let decoded = decoder
            .decode(bytes)
            .map_err(|_| io::Error::other("Datagram capsule rejected"))?;
        bytes = &bytes[decoded.consumed..];
        if let Some(payload) = decoded.datagram {
            flow.send(&payload)
                .await
                .map_err(|_| io::Error::other("Datagram send unavailable"))?;
        }
    }
    Ok(())
}
async fn upload(
    mut input: impl AsyncRead + Unpin,
    early: &[u8],
    flow: &PrivateDatagramFlow,
    limits: ProxyLimits,
) -> io::Result<()> {
    let mut decoder =
        CapsuleDecoder::new(PAYLOAD).map_err(|_| io::Error::other("Datagram codec unavailable"))?;
    let mut buffer = [0; 4096];
    forward_capsules(&mut decoder, early, flow).await?;
    loop {
        let n = tokio::time::timeout(limits.http_idle_timeout, input.read(&mut buffer))
            .await
            .map_err(|_| io::Error::other("Datagram input timed out"))??;
        if n == 0 {
            return decoder
                .finish()
                .map_err(|_| io::Error::other("Datagram stream truncated"));
        }
        forward_capsules(&mut decoder, &buffer[..n], flow).await?;
    }
}
async fn download(
    mut output: impl AsyncWrite + Unpin,
    flow: &PrivateDatagramFlow,
    limits: ProxyLimits,
) -> io::Result<()> {
    loop {
        let payload = flow
            .recv()
            .await
            .map_err(|_| io::Error::other("Datagram receive unavailable"))?;
        let capsule = encode_datagram(&payload, PAYLOAD)
            .map_err(|_| io::Error::other("Datagram response rejected"))?;
        tokio::time::timeout(limits.response_timeout, output.write_all(&capsule))
            .await
            .map_err(|_| io::Error::other("Datagram output timed out"))??;
    }
}
pub(super) async fn relay(
    mut client: TcpStream,
    early: Zeroizing<Vec<u8>>,
    flow: PrivateDatagramFlow,
    limits: ProxyLimits,
) {
    // Even optimistically coalesced capsules stay buffered until admission and
    // the complete101 response have succeeded; no UDP application send occurs
    // during request parsing, authentication, destination checks or socket open.
    if !matches!(tokio::time::timeout(limits.response_timeout, client.write_all(b"HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: connect-udp\r\nCapsule-Protocol: ?1\r\n\r\n")).await, Ok(Ok(()))) { return; }
    let (read, write) = client.split();
    tokio::select! {
        biased;
        _ = upload(read, &early, &flow, limits) => {},
        _ = download(write, &flow, limits) => {},
    }
    // Finishing either direction drops both pending operations, the TCP stream
    // and the owner-bound native UDP flow; no detached relay task survives.
}

#[cfg(test)]
#[path = "connect_udp/tests.rs"]
mod tests;
