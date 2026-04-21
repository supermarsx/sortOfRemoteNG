mod cloudflare {
    pub use crate::cloudflare::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-cloud/src/cloudflare_cmds.rs");
}

pub(crate) use inner::*;
