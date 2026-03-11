mod scaleway {
    pub use crate::scaleway::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-cloud/src/scaleway_cmds.rs");
}

