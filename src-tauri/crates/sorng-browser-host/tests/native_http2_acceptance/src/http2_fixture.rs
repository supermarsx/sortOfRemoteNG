//! Real framed H2 server. Each accepted stream gets an independent delayed
//! response task while the connection driver continues accepting other streams.
use crate::{case_index, enter, Counters, CASES};
use std::{
    pin::Pin,
    sync::{atomic::Ordering, Arc, Mutex},
    task::{Context, Poll},
    time::{Duration, Instant},
};

pub struct ObservedIo<T> {
    pub inner: T,
    pub owner: Arc<crate::TlsOwner>,
}
impl<T> Drop for ObservedIo<T> {
    fn drop(&mut self) {
        self.owner
            .closed_connections
            .fetch_add(1, Ordering::Relaxed);
    }
}
impl<T: tokio::io::AsyncRead + Unpin> tokio::io::AsyncRead for ObservedIo<T> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        let before = buf.filled().len();
        let result = Pin::new(&mut self.inner).poll_read(cx, buf);
        let read = buf.filled().len() - before;
        if !self.owner.admitted.load(Ordering::Acquire) {
            self.owner
                .before_admission_bytes
                .fetch_add(read, Ordering::Relaxed);
        }
        result
    }
}
impl<T: tokio::io::AsyncWrite + Unpin> tokio::io::AsyncWrite for ObservedIo<T> {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        bytes: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        Pin::new(&mut self.inner).poll_write(cx, bytes)
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

pub async fn serve<T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin>(
    stream: T,
    context: usize,
    connection_id: usize,
    clock: Instant,
    requests: Arc<Mutex<Vec<serde_json::Value>>>,
    counters: Arc<Vec<Counters>>,
) -> std::io::Result<()> {
    let mut connection = h2::server::handshake(stream)
        .await
        .map_err(std::io::Error::other)?;
    let mut tasks = tokio::task::JoinSet::new();
    while let Some(request) = connection.accept().await {
        let (request, mut response) = request.map_err(std::io::Error::other)?;
        if request.method() != http::Method::GET
            || request.uri().authority().is_none_or(|a| {
                !["proxy-first.fixture.test", "alternate.fixture.test"].contains(&a.host())
            })
        {
            return Err(std::io::Error::other(
                "exact fixture GET authority required",
            ));
        }
        let path = request.uri().path().to_owned();
        let authority = request.uri().authority().unwrap().host().to_owned();
        let case = case_index(&path);
        let asset = path.contains("/asset-");
        let start_ms = clock.elapsed().as_secs_f64() * 1000.0;
        if let Some(i) = case {
            enter(&counters[i].active, &counters[i].peak);
        }
        let requests = requests.clone();
        let counters = counters.clone();
        tasks.spawn(async move {
            if let Some(i) = case { tokio::time::sleep(Duration::from_millis(CASES[i].response_ms)).await; }
            let body = if asset {
                "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1\" height=\"1\"/>".to_owned()
            } else {
                let i = case.unwrap_or(0);
                let images = (0..CASES[i].resources).map(|n| {
                    let origin=if crate::cross_authority() && n%2==1 {crate::OTHER_ORIGIN}else{""};
                    format!("<img src=\"{origin}/case-{i}/asset-{n}.svg\">")
                }).collect::<String>();
                let socket=if crate::websocket_check(){"<script>const ws=new WebSocket(location.origin.replace(/^http/,'ws')+'/socket');ws.onopen=()=>ws.send('fixture');ws.onmessage=e=>{if(e.data==='fixture'){const i=new Image();i.src='/wss-ok'}}</script>"}else{""};
                let pulse=if crate::revoke_check(){"<script>setInterval(()=>{const i=new Image();i.src='/pulse?tick='+Date.now()},100)</script>"}else{""};
                format!("<!doctype html><title>marker-{context}-{path}</title><body>{images}{pulse}{socket}</body>")
            };
            let reply = http::Response::builder().status(200)
                .header("content-type",if asset {"image/svg+xml"} else {"text/html"})
                .header("cache-control","no-store").body(()).map_err(std::io::Error::other)?;
            let result = response.send_response(reply,false).and_then(|mut stream|stream.send_data(bytes::Bytes::from(body),true));
            if let Some(i) = case { counters[i].active.fetch_sub(1,Ordering::Relaxed); }
            requests.lock().unwrap().push(serde_json::json!({"alpn":"h2","authority":authority,"connectionId":connection_id,"path":path,"case":case,"asset":asset,"startMs":start_ms,"endMs":clock.elapsed().as_secs_f64()*1000.0,"written":result.is_ok()}));
            result.map_err(std::io::Error::other)
        });
    }
    while let Some(result) = tasks.join_next().await {
        result.map_err(std::io::Error::other)??;
    }
    Ok(())
}
