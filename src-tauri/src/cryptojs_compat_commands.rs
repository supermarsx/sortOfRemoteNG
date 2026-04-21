mod cryptojs_compat {
    pub use crate::cryptojs_compat::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-auth/src/cryptojs_compat_cmds.rs");
}

pub(crate) use inner::*;
