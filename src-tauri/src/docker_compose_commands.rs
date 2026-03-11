mod service {
    pub use crate::docker_compose::service::*;
}

mod types {
    pub use crate::docker_compose::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-docker-compose/src/commands.rs");
}

