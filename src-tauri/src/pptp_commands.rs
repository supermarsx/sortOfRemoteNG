mod pptp {
    pub use crate::pptp::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-vpn/src/pptp_cmds.rs");
}

pub(crate) use inner::*;
