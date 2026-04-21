mod chaining {
    pub use crate::chaining::*;
}

mod ikev2 {
    pub use crate::ikev2::*;
}

mod ipsec {
    pub use crate::ipsec::*;
}

mod l2tp {
    pub use crate::l2tp::*;
}

mod openvpn {
    pub use crate::openvpn::*;
}

mod pptp {
    pub use crate::pptp::*;
}

mod sstp {
    pub use crate::sstp::*;
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

pub(crate) use inner::*;
