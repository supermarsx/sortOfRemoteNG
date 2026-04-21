mod meshcentral {
    pub use crate::meshcentral::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-remote-mgmt/src/meshcentral_cmds.rs");
}

pub(crate) use inner::*;
