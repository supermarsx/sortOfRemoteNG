mod qr {
    pub use crate::qr::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-network/src/qr_cmds.rs");
}

pub(crate) use inner::*;
