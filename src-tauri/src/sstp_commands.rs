mod sstp {
    pub use crate::sstp::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-vpn/src/sstp_cmds.rs");
}

pub(crate) use inner::*;
