mod rlogin {
    pub use crate::rlogin::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-protocols/src/rlogin_cmds.rs");
}

