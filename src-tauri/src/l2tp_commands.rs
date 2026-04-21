mod l2tp {
    pub use crate::l2tp::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-vpn/src/l2tp_cmds.rs");
}

pub(crate) use inner::*;
