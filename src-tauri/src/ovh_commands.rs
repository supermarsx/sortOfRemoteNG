mod ovh {
    pub use crate::ovh::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-cloud/src/ovh_cmds.rs");
}

