mod tailscale {
    pub use crate::tailscale::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-vpn/src/tailscale_cmds.rs");
}

pub(crate) use inner::*;
