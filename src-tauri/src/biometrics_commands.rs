mod authenticate {
    pub use crate::biometrics::authenticate::{verify, verify_and_derive_key};
}

mod availability {
    pub use crate::biometrics::availability::{check, is_available};
}

mod types {
    pub use crate::biometrics::types::*;
}

// macOS-only: the included `commands.rs` reaches for `super::platform::macos`
// under `#[cfg(target_os = "macos")]` (legacy-migration commands). Mirror the
// other shims so that path resolves to the biometrics crate's platform module.
#[cfg(target_os = "macos")]
mod platform {
    pub use crate::biometrics::platform::macos;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-biometrics/src/commands.rs");
}

pub(crate) use inner::*;
