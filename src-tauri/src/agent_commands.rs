mod agent {
    pub use crate::agent::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-remote-mgmt/src/agent_cmds.rs");
}

pub(crate) use inner::*;
