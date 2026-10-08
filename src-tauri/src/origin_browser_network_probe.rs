//! Opt-in, exit-early smoke test of the *final app DLL's* socket imports.
//! Smaller CEF fixtures have a different link graph and missed a malformed
//! Winsock delay-load table. No profiles, databases, URLs or saved credentials
//! are opened here. The proxy denies every destination and only binds loopback.

use sorng_protocols::private_forward_proxy::{
    Authority, DialFuture, PrivateForwardProxy, ProxyLimits,
};
use std::{io, sync::Arc, time::Duration};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub(crate) const FLAG: &str = "--sorng-browser-network-probe";
pub(crate) const PASSED: &str = "browser-network-probe: loopback/auth/shutdown passed";

async fn probe() -> io::Result<()> {
    let dialer = Arc::new(|_: Authority| -> DialFuture {
        Box::pin(async { Err(io::Error::other("Probe must never dial a destination")) })
    });
    let mut proxy =
        PrivateForwardProxy::start(dialer, Arc::new(|_| false), ProxyLimits::default()).await?;
    let address = proxy.local_addr();
    if !address.ip().is_loopback() || address.port() == 0 {
        return Err(io::Error::other("Probe listener is not private"));
    }
    let result = async {
        let mut stream = tokio::net::TcpStream::connect(address).await?;
        stream
            .write_all(b"CONNECT denied.invalid:443 HTTP/1.1\r\nHost: denied.invalid:443\r\n\r\n")
            .await?;
        let mut status = [0_u8; 12];
        stream.read_exact(&mut status).await?;
        if &status != b"HTTP/1.1 407" {
            return Err(io::Error::other(
                "Probe proxy did not require authentication",
            ));
        }
        Ok(())
    }
    .await;
    proxy.stop().await?;
    result?;
    if proxy.is_running() || proxy.with_credentials(|_, _| ()).is_some() {
        return Err(io::Error::other(
            "Probe proxy did not revoke its credentials",
        ));
    }
    Ok(())
}

pub(crate) fn run() -> i32 {
    let result = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .and_then(|runtime| {
            runtime.block_on(async {
                tokio::time::timeout(Duration::from_secs(10), probe())
                    .await
                    .map_err(|_| io::Error::other("Probe timed out"))?
            })
        });
    match result {
        Ok(()) => {
            eprintln!("{PASSED}");
            0
        }
        Err(error) => {
            // Error kind only: diagnostic output must not acquire secrets/paths
            // if an underlying OS error later changes its text.
            eprintln!("browser-network-probe: failed ({:?})", error.kind());
            1
        }
    }
}
