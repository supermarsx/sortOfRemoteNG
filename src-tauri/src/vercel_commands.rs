mod vercel {
    pub use crate::vercel::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-cloud/src/vercel_cmds.rs");
}

pub(crate) use inner::*;
