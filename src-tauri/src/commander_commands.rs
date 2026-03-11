mod commander {
    pub use crate::commander::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-remote-mgmt/src/commander_cmds.rs");
}

pub(crate) use inner::*;
