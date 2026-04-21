mod service {
    pub use crate::lastpass::service::*;
}

mod types {
    pub use crate::lastpass::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-lastpass/src/lastpass/commands.rs");
}

pub(crate) use inner::*;
