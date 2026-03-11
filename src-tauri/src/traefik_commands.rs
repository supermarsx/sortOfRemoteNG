mod service {
    pub use crate::traefik::service::*;
}

mod types {
    pub use crate::traefik::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-traefik/src/commands.rs");
}

pub(crate) use inner::*;
