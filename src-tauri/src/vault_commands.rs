mod envelope {
    pub use crate::vault::envelope::*;
}

mod biometrics {
    pub use crate::biometrics::authenticate::verify;
}

mod keychain {
    pub use crate::vault::keychain::*;
}

mod migration {
    pub use crate::vault::migration::*;
}

mod types {
    pub use crate::vault::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-vault/src/commands.rs");
}

pub(crate) use inner::*;
