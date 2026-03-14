mod service {
    pub use crate::osticket::service::*;
}

mod types {
    pub use crate::osticket::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../../sorng-osticket/src/commands.rs");
}

pub(crate) use inner::*;
