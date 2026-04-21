mod cert_gen {
    pub use crate::cert_gen::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-auth/src/cert_gen_cmds.rs");
}

pub(crate) use inner::*;
