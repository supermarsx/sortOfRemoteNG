mod proxy {
    pub use crate::proxy::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-vpn/src/proxy_cmds.rs");
}

pub(crate) use inner::*;
