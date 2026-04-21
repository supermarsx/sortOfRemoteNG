mod compute {
    pub use crate::gcp::compute::*;
}

mod config {
    pub use crate::gcp::config::*;
}

mod dns {
    pub use crate::gcp::dns::*;
}

mod functions {
    pub use crate::gcp::functions::*;
}

mod gke {
    pub use crate::gcp::gke::*;
}

mod iam {
    pub use crate::gcp::iam::*;
}

mod logging {
    pub use crate::gcp::logging::*;
}

mod monitoring {
    pub use crate::gcp::monitoring::*;
}

mod pubsub {
    pub use crate::gcp::pubsub::*;
}

mod run {
    pub use crate::gcp::run::*;
}

mod secrets {
    pub use crate::gcp::secrets::*;
}

mod service {
    pub use crate::gcp::service::*;
}

mod sql {
    pub use crate::gcp::sql::*;
}

mod storage {
    pub use crate::gcp::storage::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-gcp/src/commands.rs");
}

pub(crate) use inner::*;
