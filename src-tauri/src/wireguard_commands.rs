mod wireguard {
    pub use crate::wireguard::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-vpn/src/wireguard_cmds.rs");
}

pub(crate) use inner::*;
