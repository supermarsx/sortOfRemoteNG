mod service {
    pub use crate::oracle_cloud::service::*;
}

mod types {
    pub use crate::oracle_cloud::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-oracle-cloud/src/commands.rs");
}

