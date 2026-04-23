mod chaining {
    pub use crate::chaining::*;
}

mod openvpn {
    pub use crate::openvpn::*;
}

mod tailscale {
    pub use crate::tailscale::*;
}

mod wireguard {
    pub use crate::wireguard::*;
}

mod zerotier {
    pub use crate::zerotier::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-vpn/src/chaining_cmds.rs");
}

#[allow(unused_imports)]
pub(crate) use inner::*;
