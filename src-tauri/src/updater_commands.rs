mod error {
    pub use crate::updater::error::UpdateError;
}

mod service {
    pub use crate::updater::service::UpdaterServiceState;
}

mod types {
    pub use crate::updater::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-updater/src/commands.rs");
}

pub(crate) use inner::*;
