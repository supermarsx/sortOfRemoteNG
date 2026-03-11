mod anydesk {
    pub use crate::anydesk::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-remote-mgmt/src/anydesk_cmds.rs");
}

pub(crate) use inner::*;
