mod history {
    pub use crate::scp::history::*;
}

mod service {
    pub use crate::scp::service::*;
}

mod types {
    pub use crate::scp::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-scp/src/scp/commands.rs");
}

pub(crate) use inner::*;
