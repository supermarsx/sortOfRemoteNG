mod auth {
    pub use crate::onedrive::auth::*;
}

mod error {
    pub use crate::onedrive::error::*;
}

mod service {
    pub use crate::onedrive::service::*;
}

mod types {
    pub use crate::onedrive::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-onedrive/src/onedrive/commands.rs");
}

