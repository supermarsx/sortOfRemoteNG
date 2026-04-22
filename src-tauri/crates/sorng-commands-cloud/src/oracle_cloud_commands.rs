mod service {
    pub use crate::oracle_cloud::service::*;
}

mod types {
    pub use crate::oracle_cloud::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-oracle-cloud/src/commands.rs");
}

pub(crate) use inner::*;
