mod openvpn {
    pub use crate::openvpn::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-vpn/src/openvpn_cmds.rs");
}

pub(crate) use inner::*;
