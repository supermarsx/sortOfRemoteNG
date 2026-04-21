mod service {
    pub use crate::caddy::service::*;
}

mod types {
    pub use crate::caddy::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-caddy/src/commands.rs");
}

pub(crate) use inner::*;
