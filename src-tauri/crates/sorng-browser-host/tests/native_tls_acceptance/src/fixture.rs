use crate::{ledger::Outcome, Result, State};
use std::{
    net::SocketAddr,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::oneshot,
};

pub struct Certificates {
    pub root: Vec<u8>,
    pub decoy: Vec<u8>,
    ca: Mutex<rcgen::Certificate>,
    serial: AtomicU64,
}
impl Certificates {
    pub fn generate() -> Result<Self> {
        let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
        let mut params = rcgen::CertificateParams::new(vec![]);
        params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
        let ca = rcgen::Certificate::from_params(params)?;
        Ok(Self {
            root: ca.serialize_der()?,
            decoy: rcgen::generate_simple_self_signed(vec!["accounts.google.com".into()])?
                .serialize_der()?,
            ca: Mutex::new(ca),
            serial: AtomicU64::new(1),
        })
    }
    fn issue(&self) -> std::io::Result<(u64, Vec<u8>, tokio_rustls::TlsAcceptor)> {
        let id = self
            .serial
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| n.checked_add(1))
            .map_err(|_| std::io::Error::other("leaf serial exhausted"))?;
        let mut params = rcgen::CertificateParams::new(vec!["accounts.google.com".into()]);
        params.serial_number = Some(id.into());
        let cert = rcgen::Certificate::from_params(params).map_err(std::io::Error::other)?;
        let leaf = cert
            .serialize_der_with_signer(&self.ca.lock().unwrap())
            .map_err(std::io::Error::other)?;
        let mut config = rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(
                vec![leaf.clone().into(), self.root.clone().into()],
                rustls::pki_types::PrivatePkcs8KeyDer::from(cert.serialize_private_key_der())
                    .into(),
            )
            .map_err(std::io::Error::other)?;
        config.alpn_protocols = vec![b"http/1.1".to_vec()];
        config.session_storage = Arc::new(rustls::server::NoServerSessionStorage {});
        config.send_tls13_tickets = 0;
        Ok((id, leaf, tokio_rustls::TlsAcceptor::from(Arc::new(config))))
    }
}

pub struct Fixture {
    pub address: SocketAddr,
    stop: Option<oneshot::Sender<()>>,
    task: Option<tokio::task::JoinHandle<()>>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        if let Some(task) = &self.task {
            task.abort();
        }
    }
}
struct OutcomeGuard {
    id: u64,
    state: Arc<Mutex<State>>,
    done: bool,
}
impl OutcomeGuard {
    fn finish(&mut self, outcome: Outcome) {
        self.state.lock().unwrap().ledger.finish(self.id, outcome);
        self.done = true;
    }
}
impl Drop for OutcomeGuard {
    fn drop(&mut self) {
        if !self.done {
            self.state
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .ledger
                .finish(self.id, Outcome::Cancelled);
        }
    }
}
impl Fixture {
    pub async fn start(certificates: Arc<Certificates>, state: Arc<Mutex<State>>) -> Result<Self> {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await?;
        let address = listener.local_addr()?;
        let (stop, mut stopped) = oneshot::channel();
        let task = tokio::spawn(async move {
            let mut clients = tokio::task::JoinSet::new();
            loop {
                tokio::select! {
                    _=&mut stopped=>break,
                    accepted=listener.accept()=>{
                        let (stream,_)=match accepted {Ok(pair)=>pair,Err(_)=>{state.lock().unwrap().task_errors+=1;break;}};
                        let (id,leaf,acceptor)=match certificates.issue(){Ok(v)=>v,Err(_)=>{state.lock().unwrap().task_errors+=1;continue;}};
                        if !state.lock().unwrap().ledger.register(id,leaf){continue;}
                        let mut guard=OutcomeGuard{id,state:state.clone(),done:false};
                        let state=state.clone();
                        clients.spawn(async move {
                            let outcome=match tokio::time::timeout(Duration::from_secs(130),serve(stream,acceptor,id,state)).await{
                                Ok(outcome)=>outcome,Err(_)=>Outcome::Timeout,
                            };
                            guard.finish(outcome);
                        });
                    }
                    joined=clients.join_next(),if !clients.is_empty()=>{
                        if joined.is_some_and(|result|result.is_err()){state.lock().unwrap().task_errors+=1;}
                    }
                }
            }
            // Sessions are revoked before stop(). Retain every terminal result;
            // a task requiring forced cancellation cannot pass the validator.
            let drained = tokio::time::timeout(Duration::from_secs(3), async {
                while let Some(result) = clients.join_next().await {
                    if result.is_err() {
                        state.lock().unwrap().task_errors += 1;
                    }
                }
            })
            .await
            .is_ok();
            if !drained {
                clients.abort_all();
                while let Some(result) = clients.join_next().await {
                    if result.is_err() {
                        state.lock().unwrap().task_errors += 1;
                    }
                }
            }
            state.lock().unwrap().collector_drained = true;
        });
        Ok(Self {
            address,
            stop: Some(stop),
            task: Some(task),
        })
    }
    pub async fn stop(mut self) -> Result {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        if let Some(task) = self.task.take() {
            task.await?;
        }
        Ok(())
    }
}
fn observe_bytes(state: &Arc<Mutex<State>>, id: u64, n: usize) {
    let mut s = state.lock().unwrap();
    let revoked = s.revoked;
    s.ledger.bytes(id, n, revoked);
}
async fn serve(
    stream: TcpStream,
    acceptor: tokio_rustls::TlsAcceptor,
    id: u64,
    state: Arc<Mutex<State>>,
) -> Outcome {
    let mut tls = match acceptor.accept(stream).await {
        Ok(tls) => tls,
        Err(_) => return Outcome::TlsError,
    };
    {
        let mut s = state.lock().unwrap();
        s.ledger.handshake(id);
        s.sni_exact &= tls.get_ref().1.server_name() == Some("accounts.google.com");
    }
    let result=async {
        let mut bytes=Vec::new();let mut block=[0u8;4096];
        let (end,len)=loop {
            let n=tls.read(&mut block).await?;
            if n==0{return Ok::<_,std::io::Error>(Outcome::Eof);}
            observe_bytes(&state,id,n);bytes.extend_from_slice(&block[..n]);
            if bytes.len()>32768{return Err(std::io::Error::other("bounded request"));}
            if let Some(pos)=bytes.windows(4).position(|w|w==b"\r\n\r\n"){
                let h=String::from_utf8_lossy(&bytes[..pos]);
                let length=h.lines().find_map(|l|l.to_ascii_lowercase().strip_prefix("content-length:").and_then(|v|v.trim().parse::<usize>().ok())).unwrap_or(0);
                if length>8192{return Err(std::io::Error::other("bounded body"));}break(pos+4,length);
            }
        };
        while bytes.len()<end+len{
            let n=tls.read(&mut block).await?;if n==0{return Err(std::io::Error::other("short body"));}
            observe_bytes(&state,id,n);bytes.extend_from_slice(&block[..n]);
        }
        let header=String::from_utf8_lossy(&bytes[..end]);
        let path=header.lines().next().and_then(|l|l.split_whitespace().nth(1)).unwrap_or("");
        let response={
            let mut state=state.lock().unwrap();state.http_requests+=1;
            if path=="/pulse"{state.pulse_requests+=1;}
            state.proxy_authorization_leaked|=header.to_ascii_lowercase().contains("proxy-authorization:");
            let host=header.lines().find_map(|l|l.split_once(':').filter(|(k,_)|k.eq_ignore_ascii_case("host")).map(|(_,v)|v.trim()));
            state.host_header_exact &= matches!(host,Some("accounts.google.com"|"accounts.google.com:443"));
            let (body,cookie)=if let Some(storage)=crate::storage::response(&state,path,&header,&bytes[end..end+len]){
                storage
            }else if path=="/proof"{
                let mut proof:serde_json::Value=serde_json::from_slice(&bytes[end..end+len]).map_err(std::io::Error::other)?;
                proof["nativeCookieSent"]=header.lines().any(|l|l.split_once(':').is_some_and(|(k,v)|k.eq_ignore_ascii_case("cookie")&&v.contains("tls_fixture=one"))).into();
                state.proof=Some(proof);("{}".to_owned(),String::new())
            }else if path=="/manual" || path=="/v3/signin/identifier"{
                state.initial_cookie_empty=Some(!header.lines().any(|l|l.split_once(':').is_some_and(|(k,v)|k.eq_ignore_ascii_case("cookie")&&!v.trim().is_empty())));
                (include_str!("page.html").to_owned(),"Set-Cookie: tls_fixture=one; Secure; HttpOnly; SameSite=Strict; Path=/\r\n".to_owned())
            }else if path==crate::static_document::PATH && state.static_document.is_some(){
                state.static_document.as_ref().unwrap().lock().unwrap().page_requests+=1;
                (crate::static_document::PAGE.to_owned(),String::new())
            }else{(String::new(),String::new())};
            format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n{cookie}\r\n{body}",body.len())
        };
        tls.write_all(response.as_bytes()).await?;tls.shutdown().await?;Ok(Outcome::Completed)
    }.await;
    result.unwrap_or(Outcome::IoError)
}
