mod wmi {
    pub use crate::wmi::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-remote-mgmt/src/wmi_cmds.rs");
}

pub(crate) use inner::*;
