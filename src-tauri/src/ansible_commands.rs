mod service {
    pub use crate::ansible::service::*;
}

mod types {
    pub use crate::ansible::types::*;
}

#[allow(dead_code)]
mod inner {
    include!("../crates/sorng-ansible/src/commands.rs");
}

pub(crate) use inner::*;
