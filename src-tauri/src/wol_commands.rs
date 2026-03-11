mod wol {
    pub use crate::wol::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-network/src/wol_cmds.rs");
}

pub(crate) use inner::*;
