mod legacy_crypto {
    pub use crate::legacy_crypto::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-auth/src/legacy_crypto_cmds.rs");
}

pub(crate) use inner::*;
