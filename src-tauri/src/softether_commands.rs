#![cfg(feature = "vpn-softether")]
// Tauri command-handler shim for the SoftEther VPN service.
//
// Threading: all handlers are async and delegate immediately to the
// `SoftEtherService` (a `tokio::sync::Mutex`-wrapped struct). Long-running
// protocol work happens inside the task spawned in
// `SoftEtherService::connect`. The Tauri command thread is never blocked
// on VPN I/O — see `.orchestration/plans/t1.md` "Global threading
// requirement".

mod softether {
    pub use crate::softether::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-vpn/src/softether_cmds.rs");
}

pub(crate) use inner::*;
