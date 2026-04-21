mod error {
    pub use crate::rabbitmq::error::*;
}

mod service {
    pub use crate::rabbitmq::service::*;
}

mod types {
    pub use crate::rabbitmq::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-rabbitmq/src/commands.rs");
}

