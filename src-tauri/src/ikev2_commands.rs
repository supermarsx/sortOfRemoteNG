mod ikev2 {
    pub use crate::ikev2::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-vpn/src/ikev2_cmds.rs");
}

pub(crate) use inner::*;
