mod rpc {
    pub use crate::rpc::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-remote-mgmt/src/rpc_cmds.rs");
}

pub(crate) use inner::*;
