mod service {
    pub use crate::rustdesk::service::*;
}

mod types {
    pub use crate::rustdesk::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-rustdesk/src/rustdesk/commands.rs");
}

pub(crate) use inner::*;
