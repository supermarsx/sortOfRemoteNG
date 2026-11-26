//! Pipe-only legacy engine: it never receives a destination or a route.
//! This task owns the child, route stream, and bounded transport buffers.
use super::{
    tls_policy::TlsFailure,
    upstream::{ConnectRequest, Established, UpstreamFailure},
    upstream_verify::{admission_input, structural_fatal_with_policy, SystemValidation},
};
use crate::private_forward_proxy::BoxedStream;
use rustls::pki_types::ServerName;
use std::{
    io,
    path::PathBuf,
    pin::Pin,
    process::Stdio,
    task::{Context, Poll},
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, DuplexStream, ReadBuf},
    process::Command,
    sync::{mpsc, oneshot},
};

const RECORD: usize = 16384;
const MAX_EVIDENCE: usize = 1024 * 1024;
type Frame = (u8, Vec<u8>);

pub(crate) fn helper_path() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("SORNG_LEGACY_TLS_HELPER") {
        let path = PathBuf::from(path);
        return path.is_absolute().then_some(path);
    }
    let name = if cfg!(windows) {
        "sorng-legacy-tls.exe"
    } else {
        "sorng-legacy-tls"
    };
    #[cfg(debug_assertions)]
    {
        let development = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../native/legacy-tls/bundle")
            .join(name);
        if development.is_file() {
            return Some(development);
        }
    }
    let root = std::env::current_exe().ok()?.parent()?.to_path_buf();
    [
        root.join("legacy-tls").join(name),
        root.join(name),
        root.join("../Resources/legacy-tls").join(name),
    ]
    .into_iter()
    .find(|p| p.is_file())
}

fn protocol() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, TlsFailure::HelperProtocol)
}

async fn read_frame(input: &mut (impl AsyncRead + Unpin)) -> io::Result<Frame> {
    let tag = input.read_u8().await?;
    let len = input.read_u32().await? as usize;
    if len > if tag == b'H' { MAX_EVIDENCE } else { RECORD } {
        return Err(protocol());
    }
    let mut bytes = vec![0; len];
    input.read_exact(&mut bytes).await?;
    Ok((tag, bytes))
}

fn wire(tag: u8, bytes: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(bytes.len() + 5);
    result.push(tag);
    result.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    result.extend_from_slice(bytes);
    result
}

struct Evidence {
    chain: Vec<Vec<u8>>,
    version: String,
    cipher: String,
}
fn evidence(bytes: &[u8], profile: super::tls_policy::UpstreamTlsProfile) -> io::Result<Evidence> {
    fn number(input: &mut &[u8]) -> io::Result<usize> {
        if input.len() < 4 {
            return Err(protocol());
        }
        let (n, rest) = input.split_at(4);
        *input = rest;
        Ok(u32::from_be_bytes(n.try_into().unwrap()) as usize)
    }
    fn field(input: &mut &[u8], limit: usize) -> io::Result<Vec<u8>> {
        let n = number(input)?;
        if n > limit || n > input.len() {
            return Err(protocol());
        }
        let (v, rest) = input.split_at(n);
        *input = rest;
        Ok(v.to_vec())
    }
    let mut input = bytes;
    let version = String::from_utf8(field(&mut input, 32)?).map_err(|_| protocol())?;
    use super::tls_policy::UpstreamTlsProfile as P;
    let valid = match profile {
        P::Ssl2 => version == "SSLv2",
        P::Ssl3 => version == "SSLv3",
        P::Tls10 => version == "TLSv1",
        P::Tls11 => version == "TLSv1.1",
        P::Legacy => matches!(version.as_str(), "SSLv3" | "TLSv1" | "TLSv1.1" | "TLSv1.2"),
        _ => false,
    };
    if !valid {
        return Err(protocol());
    }
    let cipher = String::from_utf8(field(&mut input, 128)?).map_err(|_| protocol())?;
    if cipher.is_empty()
        || !cipher
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err(protocol());
    }
    let count = number(&mut input)?;
    if !(1..=16).contains(&count) {
        return Err(protocol());
    }
    let mut chain = Vec::with_capacity(count);
    for _ in 0..count {
        chain.push(field(&mut input, 65536)?);
    }
    if !input.is_empty() {
        return Err(protocol());
    }
    Ok(Evidence {
        chain,
        version,
        cipher,
    })
}

fn engine_error(bytes: &[u8]) -> TlsFailure {
    if bytes.len() != 8 {
        return TlsFailure::HelperProtocol;
    }
    let category = u32::from_be_bytes(bytes[..4].try_into().unwrap());
    let value = u32::from_be_bytes(bytes[4..].try_into().unwrap());
    match category {
        0 => TlsFailure::HelperEngine(value),
        1 => TlsFailure::Version,
        2 => TlsFailure::Cipher,
        3 => TlsFailure::SignatureAlgorithm,
        4 => TlsFailure::KeyExchange,
        5 => TlsFailure::Alpn,
        6 => TlsFailure::InvalidHandshake,
        7 => TlsFailure::Decryption,
        8 => TlsFailure::PeerHandshakeAlert,
        9 => TlsFailure::PeerSecurityAlert,
        10 if value <= 255 => TlsFailure::PeerAlert(value as u8),
        11 => TlsFailure::HelperUnavailable,
        _ => TlsFailure::HelperProtocol,
    }
}

/// Drop cancels the pump, closes the routed socket and kills/reaps the helper.
struct HelperStream {
    stream: DuplexStream,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for HelperStream {
    fn drop(&mut self) {
        self.task.abort();
    }
}
impl AsyncRead for HelperStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_read(cx, buf)
    }
}
impl AsyncWrite for HelperStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        bytes: &[u8],
    ) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.stream).poll_write(cx, bytes)
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.stream).poll_shutdown(cx)
    }
}

pub(crate) async fn establish(
    request: ConnectRequest<'_>,
    route: BoxedStream,
    name: ServerName<'static>,
) -> Result<Established, UpstreamFailure> {
    let path = request
        .verifier
        .legacy_helper
        .clone()
        .filter(|p| p.is_file())
        .or_else(helper_path)
        .ok_or(UpstreamFailure::Tls(TlsFailure::HelperUnavailable))?;
    let mut command = Command::new(path);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
                                        // Do not inherit proxy credentials, tokens, TLS configuration, key-log
                                        // paths or loader overrides from the application environment.
    command.env_clear();
    #[cfg(windows)]
    for key in ["SystemRoot", "WINDIR"] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    let mut child = command
        .spawn()
        .map_err(|_| UpstreamFailure::Tls(TlsFailure::HelperUnavailable))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or(UpstreamFailure::Tls(TlsFailure::HelperProtocol))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or(UpstreamFailure::Tls(TlsFailure::HelperProtocol))?;
    let profile = request.verifier.tls_profile;
    let mut config = profile.helper_name().as_bytes().to_vec();
    config.push(0);
    // SNI only; the helper cannot resolve or connect to this name.
    if request
        .authority
        .host()
        .parse::<std::net::IpAddr>()
        .is_err()
    {
        config.extend_from_slice(request.authority.host().as_bytes());
    }
    config.push(0);
    let initial = wire(b'C', &config);
    let (client, plain) = tokio::io::duplex(RECORD * 2);
    let (ready_tx, ready_rx) = oneshot::channel();
    let task = tokio::spawn(async move {
        let (frames_tx, mut frames_rx) = mpsc::channel(2);
        let reader = tokio::spawn(async move {
            loop {
                let next = read_frame(&mut stdout).await;
                let failed = next.is_err();
                if frames_tx.send(next).await.is_err() || failed {
                    break;
                }
            }
        });
        struct Abort(tokio::task::JoinHandle<()>);
        impl Drop for Abort {
            fn drop(&mut self) {
                self.0.abort();
            }
        }
        let _reader = Abort(reader);
        let mut ready = Some(ready_tx);
        let result = pump(
            route,
            plain,
            &mut stdin,
            &mut frames_rx,
            initial,
            &mut ready,
            profile,
        )
        .await;
        if let (Some(tx), Err(error)) = (ready.take(), result) {
            let _ = tx.send(Err(error));
        }
        let _ = child.kill().await;
        let _ = child.wait().await;
    });
    let stream = HelperStream {
        stream: client,
        task,
    };
    let evidence = match tokio::time::timeout(super::upstream::CONNECT_TIMEOUT, ready_rx).await {
        Err(_) => return Err(UpstreamFailure::Tls(TlsFailure::Timeout)),
        Ok(Err(_)) => return Err(UpstreamFailure::Tls(TlsFailure::HelperProtocol)),
        Ok(Ok(Err(error))) => return Err(UpstreamFailure::Tls(error)),
        Ok(Ok(Ok(evidence))) => evidence,
    };
    let slices = evidence.chain.iter().map(Vec::as_slice).collect::<Vec<_>>();
    if let Some(fatal) =
        structural_fatal_with_policy(&slices, request.verifier.allow_weak_certificates)
    {
        return Err(UpstreamFailure::Fatal(fatal));
    }
    let validation = {
        let verifier = request.verifier.clone();
        let chain = evidence.chain.clone();
        tokio::task::spawn_blocking(move || verifier.system_validation(&chain, &name, &[]))
            .await
            .unwrap_or(SystemValidation::NotValid)
    };
    let system_ca_valid =
        admission_input(validation, request.hsts).map_err(UpstreamFailure::Fatal)?;
    let verdict = {
        let _gate = request.trust_gate.lock().await;
        request
            .trust
            .evaluate(super::trust::UpstreamEvidence {
                authority: request.authority.clone(),
                chain_der: evidence.chain,
                system_ca_valid,
                temporary_ok: true,
                tls_version: Some(evidence.version),
                cipher_suite: Some(evidence.cipher),
            })
            .await
    };
    let admission = super::upstream::verdict_admission(verdict, system_ca_valid)?;
    // Use the same trust-derived persistence decision as modern TLS. An
    // allow-once verdict cannot persist; a saved admission may cache responses
    // under the connection binding and the site's HTTP cache policy.
    Ok(Established {
        io: Box::new(stream),
        h2: false,
        admission,
    })
}

async fn pump(
    route: BoxedStream,
    plain: DuplexStream,
    stdin: &mut (impl AsyncWrite + Unpin),
    frames: &mut mpsc::Receiver<io::Result<Frame>>,
    initial: Vec<u8>,
    ready: &mut Option<oneshot::Sender<Result<Evidence, TlsFailure>>>,
    profile: super::tls_policy::UpstreamTlsProfile,
) -> Result<(), TlsFailure> {
    let (mut route_read, mut route_write) = tokio::io::split(route);
    let (mut plain_read, mut plain_write) = tokio::io::split(plain);
    let mut to_child = initial;
    let mut to_network = Vec::new();
    let mut to_plain = Vec::new();
    let mut network_buf = [0; RECORD];
    let mut plain_buf = [0; RECORD];
    let mut writing = false;
    let mut handshaken = false;
    let mut closing = false;
    loop {
        if closing && to_plain.is_empty() {
            return Ok(());
        }
        tokio::select! {
            result=stdin.write(&to_child), if !to_child.is_empty() => {
                let n=result.map_err(|_|TlsFailure::HelperProtocol)?;
                if n==0 {return Err(TlsFailure::HelperProtocol);} to_child.drain(..n);
            }
            result=route_write.write(&to_network), if !to_network.is_empty() => {
                let n=result.map_err(|_|TlsFailure::Reset)?;
                if n==0 {return Err(TlsFailure::Eof);} to_network.drain(..n);
            }
            result=plain_write.write(&to_plain), if !to_plain.is_empty() => {
                let n=result.map_err(|_|TlsFailure::Eof)?;
                if n==0 {return Err(TlsFailure::Eof);} to_plain.drain(..n);
            }
            result=route_read.read(&mut network_buf), if to_child.is_empty() && !closing => {
                let n=result.map_err(|_|TlsFailure::Reset)?;
                if n==0 {return Err(TlsFailure::Eof);} to_child=wire(b'N',&network_buf[..n]);
            }
            result=plain_read.read(&mut plain_buf), if to_child.is_empty() && handshaken && !writing && !closing => {
                let n=result.map_err(|_|TlsFailure::Eof)?;
                if n==0 {return Ok(());} to_child=wire(b'P',&plain_buf[..n]); writing=true;
            }
            frame=frames.recv(), if to_network.is_empty() && to_plain.is_empty() && !closing => {
                let (tag,bytes)=frame.ok_or(TlsFailure::HelperProtocol)?.map_err(|_|TlsFailure::HelperProtocol)?;
                match tag {
                    b'N' if !bytes.is_empty() => to_network=bytes,
                    b'P' if handshaken && !bytes.is_empty() => to_plain=bytes,
                    b'A' if writing && bytes.is_empty() => writing=false,
                    b'H' if !handshaken => {
                        let evidence=evidence(&bytes,profile).map_err(|_|TlsFailure::HelperProtocol)?;
                        handshaken=true;
                        ready.take().ok_or(TlsFailure::HelperProtocol)?.send(Ok(evidence)).map_err(|_|TlsFailure::Eof)?;
                    }
                    b'E' => return Err(engine_error(&bytes)),
                    b'X' if handshaken && bytes.is_empty() => closing=true,
                    _ => return Err(TlsFailure::HelperProtocol),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn oversized_helper_frame_is_rejected_before_allocation() {
        let mut input = &b"H\xff\xff\xff\xff"[..];
        assert!(read_frame(&mut input).await.is_err());
    }
    #[test]
    fn engine_errors_remain_typed() {
        let mut b = vec![];
        b.extend_from_slice(&10u32.to_be_bytes());
        b.extend_from_slice(&70u32.to_be_bytes());
        assert_eq!(engine_error(&b), TlsFailure::PeerAlert(70));
        assert_eq!(engine_error(&[]), TlsFailure::HelperProtocol);
    }

    /// Uses the independently compiled SSL server fixture. Explicitly ignored
    /// in ordinary unit runs because it needs the pinned native helper build.
    #[tokio::test]
    #[ignore = "build-legacy-tls.mjs --test-fixture; set SORNG_LEGACY_TLS_HELPER and SORNG_LEGACY_TLS_FIXTURE"]
    async fn real_legacy_profiles_obey_route_and_certificate_admission() {
        use super::super::{
            tls_policy::UpstreamTlsProfile as P,
            trust::{UpstreamEvidence, UpstreamTrust, UpstreamTrustFuture, UpstreamVerdict},
            upstream_verify::UpstreamVerifierConfig,
        };
        use crate::private_forward_proxy::{Authority, DialFuture, RouteDialer};
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        };
        struct Fixture {
            path: PathBuf,
            profile: P,
            weak: bool,
            requests: Arc<AtomicUsize>,
        }
        impl RouteDialer for Fixture {
            fn dial(&self, authority: Authority) -> DialFuture {
                assert_eq!(authority.to_string(), "localhost:443");
                let path = self.path.clone();
                let profile = self.profile;
                let weak = self.weak;
                let requests = self.requests.clone();
                Box::pin(async move {
                    let root = path.parent().unwrap();
                    let mut command = Command::new(&path);
                    command
                        .args([
                            root.join(if weak {
                                "weak-cert.pem"
                            } else {
                                "test-cert.pem"
                            }),
                            root.join(if weak { "weak-key.pem" } else { "test-key.pem" }),
                        ])
                        .stdin(Stdio::piped())
                        .stdout(Stdio::piped())
                        .stderr(Stdio::null())
                        .kill_on_drop(true);
                    #[cfg(windows)]
                    command.creation_flags(0x08000000);
                    let mut child = command.spawn()?;
                    let mut stdin = child.stdin.take().unwrap();
                    let mut stdout = child.stdout.take().unwrap();
                    stdin
                        .write_all(&wire(
                            b'C',
                            format!("{}\0localhost\0", profile.helper_name()).as_bytes(),
                        ))
                        .await?;
                    let (route, mut encrypted) = tokio::io::duplex(RECORD * 4);
                    let task = tokio::spawn(async move {
                        let (tx, mut rx) = mpsc::channel(2);
                        let reader = tokio::spawn(async move {
                            while let Ok(frame) = read_frame(&mut stdout).await {
                                if tx.send(frame).await.is_err() {
                                    break;
                                }
                            }
                        });
                        let mut b = [0; RECORD];
                        loop {
                            tokio::select! {
                                n=encrypted.read(&mut b) => {
                                    let Ok(n)=n else {break};if n==0{break;}
                                    if stdin.write_all(&wire(b'N',&b[..n])).await.is_err(){break;}
                                }
                                f=rx.recv() => {
                                    let Some((tag,data))=f else {break};
                                    match tag {
                                        b'N' => {if encrypted.write_all(&data).await.is_err(){break;}},
                                        b'P' => {
                                            requests.fetch_add(1,Ordering::SeqCst);
                                            if stdin.write_all(&wire(b'P',b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK")).await.is_err(){break;}
                                        },
                                        b'H' | b'A' => {}, _ => break,
                                    }
                                }
                            }
                        }
                        reader.abort();
                        let _ = child.kill().await;
                        let _ = child.wait().await;
                    });
                    Ok(Box::new(HelperStream {
                        stream: route,
                        task,
                    }) as BoxedStream)
                })
            }
        }
        struct Trust {
            requests: Arc<AtomicUsize>,
            verdict: UpstreamVerdict,
        }
        impl UpstreamTrust for Trust {
            fn evaluate(&self, e: UpstreamEvidence) -> UpstreamTrustFuture {
                assert_eq!(
                    self.requests.load(Ordering::SeqCst),
                    0,
                    "HTTP data before certificate admission"
                );
                assert!(!e.chain_der.is_empty());
                assert!(e.tls_version.is_some());
                assert!(e.cipher_suite.is_some());
                let verdict = self.verdict;
                Box::pin(async move { verdict })
            }
        }
        let helper = PathBuf::from(std::env::var_os("SORNG_LEGACY_TLS_HELPER").expect("helper"));
        let fixture = PathBuf::from(std::env::var_os("SORNG_LEGACY_TLS_FIXTURE").expect("fixture"));
        for (profile, admit, weak, allow_weak) in [
            (P::Ssl2, true, false, false),
            (P::Ssl3, true, false, false),
            (P::Tls10, true, false, false),
            (P::Tls11, true, false, false),
            (P::Legacy, true, false, false),
            (P::Ssl3, false, false, false),
            (P::Tls10, true, true, false),
            (P::Tls10, true, true, true),
            (P::Tls10, false, true, true),
        ] {
            let requests = Arc::new(AtomicUsize::new(0));
            let dialer: Arc<dyn RouteDialer> = Arc::new(Fixture {
                path: fixture.clone(),
                profile,
                weak,
                requests: requests.clone(),
            });
            let trust: Arc<dyn UpstreamTrust> = Arc::new(Trust {
                requests: requests.clone(),
                verdict: if admit {
                    UpstreamVerdict::Admit { persistent: true }
                } else {
                    UpstreamVerdict::Deny
                },
            });
            let mut verifier = UpstreamVerifierConfig::for_tests(&[], &[]);
            verifier.tls_profile = profile;
            verifier.allow_weak_certificates = allow_weak;
            verifier.legacy_helper = Some(helper.clone());
            let authority = Authority::parse("localhost:443").unwrap();
            let gate = tokio::sync::Mutex::new(());
            let result = super::super::upstream::establish(ConnectRequest {
                dialer: &dialer,
                trust: &trust,
                verifier: &verifier,
                authority: &authority,
                tls: true,
                hsts: false,
                offer: super::super::upstream::Offer::Http11Only,
                trust_gate: &gate,
            })
            .await;
            if weak && !allow_weak {
                assert!(matches!(
                    result,
                    Err(UpstreamFailure::Fatal(
                        super::super::trust::UpstreamFatal::WeakKey
                    ))
                ));
                assert_eq!(requests.load(Ordering::SeqCst), 0);
                continue;
            }
            if !admit {
                assert!(matches!(result, Err(UpstreamFailure::Denied)));
                assert_eq!(requests.load(Ordering::SeqCst), 0);
                continue;
            }
            let mut connected = result.unwrap_or_else(|e| panic!("{profile:?}: {e:?}"));
            assert!(!connected.h2);
            assert!(connected.admission.persistent);
            connected
                .io
                .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\n\r\n")
                .await
                .unwrap();
            let mut response = vec![0; 40];
            tokio::time::timeout(
                std::time::Duration::from_secs(10),
                connected.io.read_exact(&mut response),
            )
            .await
            .expect("response timeout")
            .unwrap();
            assert!(response.ends_with(b"OK"));
            assert_eq!(requests.load(Ordering::SeqCst), 1);
        }
    }
}
