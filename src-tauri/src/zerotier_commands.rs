mod zerotier {
    pub use crate::zerotier::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-vpn/src/zerotier_cmds.rs");
}

pub(crate) use inner::*;
