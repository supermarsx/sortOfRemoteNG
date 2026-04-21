mod ipsec {
    pub use crate::ipsec::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-vpn/src/ipsec_cmds.rs");
}

pub(crate) use inner::*;
